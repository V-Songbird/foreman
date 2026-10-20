#!/usr/bin/env node
"use strict";

// [Foreman: 121]
// The one commit routine every Foreman execution mode shares — single-task
// closes and task-split checkpoints. It exists so no
// Foreman flow ever runs `git add -A` again: staging is the primitive's job,
// and the primitive only ever stages what changed after the task started.
//
// Two subcommands bracket a unit of work:
//
//   begin   records the boundary. A clean tree returns its baseline; a dirty
//           one returns dirty:true and NO baseline, which is the mechanical
//           form of "Foreman executes without automated commits here". It
//           never proceeds implicitly and never offers to absorb the dirt.
//   finish  derives what changed since that baseline, refuses anything the
//           caller did not declare, stages exactly the derived set, and
//           (unless --no-commit) commits it and attests the boundary after.
//
// Product principle 4: dirty work is never swept into a Foreman commit.

const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
// [Foreman: 125] One collision rule for planning and for picking — the same
// touchesOverlap next-candidates uses.
const {
  commitTrailerFor,
  isValidId,
  touchesOverlap,
  normalizedTouch,
  ignoredPaths,
  notStagedWarning,
} = require("./roadmap");
// [Foreman: 134] One reading of a commit's Foreman trailer.
const { trailerLinesIn, hasExactTrailer } = require("./commit-evidence");
const { record: recordTrial } = require("./trial-log");

const ROADMAP_FILE = "ROADMAP.jsonl";

const { projectDir, parseFlags, printHelp } = require("./runtime");

// [Foreman: 967] Git through the Codex sandbox's pipe-refusal fallback.
const { runGit } = require("./run-git");

// `options` overrides the defaults: task.js commits with timeout 0, because a
// project's pre-commit hook may run its whole suite.
function git(root, args, options = {}) {
  return runGit(root, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
    // finish runs on the close path; a hung git must not hang it -- same
    // rationale as commit-evidence.js's read timeout.
    timeout: 30000,
    ...options,
  });
}

// [Foreman: 1160] `files` go to git through --pathspec-from-file, so no list
// of paths can outgrow the Windows command-line limit. A temp file rather
// than stdin: run-git's sandbox fallback refuses `input`.
function gitWithPaths(root, args, files, options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-paths-"));
  try {
    const list = path.join(dir, "paths");
    fs.writeFileSync(list, files.join("\0"));
    return git(root, [...args, `--pathspec-from-file=${list}`, "--pathspec-file-nul"], options);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// -z output, forward-slashed so a Windows checkout compares against the
// same path shape the roadmap stores.
function zsplit(out) {
  return out.split("\0").filter(Boolean).map((file) => file.replaceAll("\\", "/"));
}

function gitBuffer(root, args) {
  return runGit(root, args, {
    encoding: "buffer",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function repositoryState(root) {
  try {
    const inside = git(root, ["rev-parse", "--is-inside-work-tree"]).trim();
    if (inside !== "true") return { clean: false, reason: "not_a_git_worktree" };
    const status = git(root, ["status", "--porcelain"]);
    return status.trim()
      ? { clean: false, reason: "working_tree_has_changes" }
      : { clean: true, reason: null };
  } catch (error) {
    return { clean: false, reason: "git_status_unavailable", cause: gitFailureCause(error) };
  }
}

// [Foreman: 967] Why git could not run, bounded: its stderr, or the spawn
// error's code and message when git never started or timed out. A sandbox
// that blocks git then names the block instead of a bare reason.
function gitFailureCause(error) {
  const stderr = String(error.stderr || "").trim();
  return (stderr || [error.code, error.message].filter(Boolean).join(": ")).slice(0, 500);
}

function addHashPart(hash, label, value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  hash.update(`${label}:${buffer.length}\0`);
  hash.update(buffer);
}

function statusFingerprint(root) {
  const hash = crypto.createHash("sha256");
  const porcelain = gitBuffer(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const stagedDiff = gitBuffer(root, ["diff", "--cached", "--binary", "--no-ext-diff"]);
  const unstagedDiff = gitBuffer(root, ["diff", "--binary", "--no-ext-diff"]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .sort();

  addHashPart(hash, "porcelain", porcelain);
  addHashPart(hash, "staged", stagedDiff);
  addHashPart(hash, "unstaged", unstagedDiff);
  for (const relative of untracked) {
    const fullPath = path.join(root, relative);
    const stat = fs.lstatSync(fullPath);
    addHashPart(hash, "untracked-path", relative);
    addHashPart(hash, "untracked-mode", stat.mode);
    addHashPart(
      hash,
      "untracked-content",
      stat.isSymbolicLink()
        ? fs.readlinkSync(fullPath)
        : stat.isFile()
          ? fs.readFileSync(fullPath)
          : `${stat.mode}:${stat.size}`
    );
  }
  return hash.digest("hex");
}

function repositorySnapshot(root) {
  return {
    head: git(root, ["rev-parse", "HEAD"]).trim(),
    state_hash: statusFingerprint(root),
  };
}

function normalizeCommit(root, commit) {
  if (!/^[0-9a-fA-F]{7,64}$/.test(String(commit || ""))) return null;
  try {
    return git(root, ["rev-parse", "--verify", `${commit}^{commit}`]).trim();
  } catch {
    return null;
  }
}

// [Foreman: 202] The two backup shapes roadmap.js's migrateFile writes as
// sibling, untracked files right before an automatic format upgrade. They
// are not the ledger itself, but they are still Foreman's own bookkeeping —
// the user-visible recovery copy of a ledger write — so they get every
// consequence isSharedLedger already carries: carved out of dirt at begin,
// excluded from a unit's staging, forbidden in a worker's own commit.
const LEDGER_BACKUP_RE = /^(?:ROADMAP\.jsonl\.backup-|\.foreman\/archive\.jsonl\.backup-)/;

function isSharedLedger(file) {
  const normalized = file.replaceAll("\\", "/");
  // [Foreman: 132] The archive is the roadmap's other half — same single
  // writer rule, so a worker must not commit it either. safe-commit's
  // roadmap_close carve-out is CLOSE_BOOKKEEPING below: [Foreman: 539] a
  // staged close stages every pending bookkeeping file, the archive included.
  // A project's own CHANGELOG.md is NOT one of
  // Foreman's files and never was — an ordinary edit to it belongs in the
  // task's own commit like any other change.
  // The trial log and its session marker are Foreman's own writes into the
  // project's .foreman directory: a flow records an event mid-unit, so the
  // tree goes dirty through no fault of the user's work. Treated like the
  // ledger, that dirt stops blocking begin and stops being swept into a unit.
  return (
    normalized === "ROADMAP.jsonl"
    || normalized === ".foreman/archive.jsonl"
    || normalized === ".foreman/trial-log.jsonl"
    || normalized === ".foreman/trial-session"
    || LEDGER_BACKUP_RE.test(normalized)
  );
}

// [Foreman: 184] Every path `git status` reports as differing, porcelain -z so
// special characters survive; a rename/copy record carries both sides.
// [Foreman: 539] Untracked files are listed one by one, so a new
// .foreman/archive.jsonl reads as bookkeeping rather than as an unknown
// .foreman/ directory.
function dirtyFiles(root) {
  const tokens = git(root, ["status", "--porcelain", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
  const files = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    files.push(token.slice(3).replaceAll("\\", "/"));
    if (/[RC]/.test(token.slice(0, 2)) && tokens[index + 1] !== undefined) {
      index += 1;
      files.push(tokens[index].replaceAll("\\", "/"));
    }
  }
  return files;
}

// [Foreman: 184] The one distinction begin and the plan gate act on: dirt
// confined to shared-ledger files is Foreman's own bookkeeping (the entry's
// in_progress flip on a tracked roadmap), not someone else's work in the
// tree. Anything else keeps the ordinary dirty refusal.
// [Foreman: 539] What a staged close stages (roadmap.js stageRoadmapFile), so
// a declared roadmap close may carry each of them in its commit.
const CLOSE_BOOKKEEPING = new Set([ROADMAP_FILE, ".foreman/archive.jsonl"]);

function ledgerOnlyDirt(root) {
  const files = dirtyFiles(root);
  return files.length && files.every(isSharedLedger) ? files : null;
}

// Everything that differs from the baseline commit: index and worktree come
// out of one diff (`git diff <commit>` compares the commit to the worktree),
// and files git isn't tracking yet come from ls-files. --no-renames shows
// both sides of a rename, so moving ROADMAP.jsonl can't hide the source path.
function changedSinceBaseline(root, baseline) {
  return [
    ...new Set([
      ...zsplit(git(root, ["diff", "--name-only", "--no-renames", "-z", baseline])),
      ...zsplit(git(root, ["ls-files", "--others", "--exclude-standard", "-z"])),
    ]),
  ].sort();
}

function stagedSince(root, baseline) {
  return zsplit(git(root, ["diff", "--cached", "--name-only", "--no-renames", "-z", baseline]));
}

// Paths that still differ between the index and the worktree: unstaged
// changes to tracked files, plus anything git isn't tracking yet. A `git mv`
// or `git rm` already leaves both sides agreeing, so its paths drop out of
// this set -- which is exactly right, because `git add` on a path that lives
// in neither tree (a rename's old name) hard-fails with "did not match any
// files". Only this set ever needs `git add`; the rest is already staged.
function worktreeDirty(root) {
  return new Set([
    ...zsplit(git(root, ["diff", "--name-only", "--no-renames", "-z"])),
    ...zsplit(git(root, ["ls-files", "--others", "--exclude-standard", "-z"])),
  ]);
}

// [Foreman: 1154] The index file as `git add` is about to find it, so a
// refusal puts the whole index back: the user's staged blobs, intent-to-add
// entries and conflict stages, with no per-path argument list to outgrow.
// A file copy, not `update-index --index-info`: run-git's sandbox fallback
// refuses `input`.
function indexSnapshot(root) {
  const file = path.resolve(root, git(root, ["rev-parse", "--git-path", "index"]).trim());
  if (!fs.existsSync(file)) return { file, content: null };
  return { file, content: fs.readFileSync(file), mtimeMs: fs.statSync(file).mtimeMs };
}

// Written the way git writes it, through index.lock, so a running git that
// holds the lock fails this rather than racing it. The old mtime goes back
// too (floored, so never later): git's racy-entry check compares against it.
// Returns the fields a refusal adds: staged:false once the index is back,
// or what finish left staged when it could not be put back.
function restoreIndex(snapshot, files) {
  const lock = `${snapshot.file}.lock`;
  try {
    // A failed `git add` writes no index: nothing to put back, nothing staged.
    const current = fs.existsSync(snapshot.file) ? fs.readFileSync(snapshot.file) : null;
    if (current === null ? snapshot.content === null : snapshot.content?.equals(current)) return { staged: false };
    if (snapshot.content === null) {
      fs.rmSync(snapshot.file, { force: true });
      return { staged: false };
    }
    // Only a lock this call created is removed: one that already exists is
    // another git's.
    const fd = fs.openSync(lock, "wx");
    try {
      try {
        fs.writeFileSync(fd, snapshot.content);
      } finally {
        fs.closeSync(fd);
      }
      const mtime = Math.floor(snapshot.mtimeMs) / 1000;
      fs.utimesSync(lock, mtime, mtime);
      fs.renameSync(lock, snapshot.file);
    } catch (error) {
      fs.rmSync(lock, { force: true });
      throw error;
    }
    return { staged: false };
  } catch (error) {
    return { left_staged: files, restore_error: error.message };
  }
}

// [Foreman: 410] The paths among `files` that are gitlinks — a submodule's
// pointer in the index. Staging one records whatever commit the submodule
// sits on, so a close whose work lives inside a submodule would land its
// trailer on a superproject commit.
// [Foreman: 1160] ls-files takes no --pathspec-from-file, so the paths go in
// chunks that stay far under the Windows command-line limit, and only exact
// matches count.
function gitlinksIn(root, files) {
  const wanted = new Set(files);
  const links = [];
  for (let i = 0; i < files.length; ) {
    const chunk = [];
    for (let size = 0; i < files.length && size < 16000; i++) {
      chunk.push(files[i]);
      size += files[i].length + 3;
    }
    links.push(
      ...git(root, ["ls-files", "--stage", "-z", "--", ...chunk])
        .split("\0")
        .filter((line) => line.startsWith("160000 "))
        .map((line) => line.slice(line.indexOf("\t") + 1).replaceAll("\\", "/"))
        .filter((file) => wanted.has(file))
    );
  }
  return links;
}

// An expected entry is an area hint, exactly as `touches` is: `src/api`
// owns every file beneath it. Same normalized, prefix-aware comparison
// next-candidates uses for collisions, so one rule covers both.
function isOwned(file, expected) {
  return expected.some((area) => touchesOverlap(file, area));
}

function beginUnit(root) {
  const state = repositoryState(root);
  // No baseline on a dirty tree, deliberately: finish refuses without one,
  // so "work anyway" mechanically means "work without automated commits".
  // [Foreman: 184] One exception: dirt confined to shared-ledger files is
  // Foreman's own bookkeeping — on a tracked roadmap the entry's
  // in_progress flip precedes this call, so refusing it would switch the
  // primitive off for every routine task. finish keeps ledger files out of
  // the unit's staging either way.
  if (!state.clean) {
    const ledger =
      state.reason === "working_tree_has_changes" ? ledgerOnlyDirt(root) : null;
    if (!ledger) {
      return { ok: true, dirty: true, reason: state.reason, ...(state.cause && { cause: state.cause }) };
    }
    return { ok: true, dirty: false, ledger_dirty: ledger, baseline: repositorySnapshot(root) };
  }
  return { ok: true, dirty: false, baseline: repositorySnapshot(root) };
}

function attestCommit(root, options) {
  const { baseline, commit, id, roadmapClose } = options;
  const reasons = [];
  const commitCount = Number.parseInt(
    git(root, ["rev-list", "--count", `${baseline}..${commit}`]).trim(),
    10
  );
  if (commitCount !== 1) reasons.push("unit_did_not_create_exactly_one_commit");
  const parents = git(root, ["rev-list", "--parents", "-n", "1", commit])
    .trim()
    .split(/\s+/)
    .slice(1);
  if (parents.length !== 1 || parents[0] !== baseline) {
    reasons.push("unit_commit_is_not_directly_on_baseline");
  }

  const message = git(root, ["log", "-1", "--format=%B", commit]);
  const trailerLines = trailerLinesIn(message);
  if (id) {
    // [Foreman: 134] The strict reading, from the one
    // definition — an attested unit commit names exactly one entry, its own.
    if (!hasExactTrailer(message, id)) {
      reasons.push("exact_foreman_trailer_missing");
    }
  } else if (trailerLines.length) {
    reasons.push("unexpected_foreman_trailer");
  }

  // A shared ledger in the commit is a worker overreaching — except when
  // this commit IS the roadmap close riding along, which the caller has to
  // declare up front rather than discover afterwards.
  const files = zsplit(git(root, ["diff", "--name-only", "--no-renames", "-z", baseline, commit]));
  const forbiddenFiles = files.filter(
    (file) => isSharedLedger(file) && !(roadmapClose && CLOSE_BOOKKEEPING.has(file))
  );
  if (forbiddenFiles.length) reasons.push("shared_ledger_committed");

  return {
    ok: reasons.length === 0,
    commit_count: commitCount,
    trailer_lines: trailerLines,
    forbidden_files: forbiddenFiles,
    reasons,
  };
}

function finishUnit(root, options) {
  const id = options.id === undefined || options.id === null ? "" : String(options.id);
  // id is optional: a task-split checkpoint owns no roadmap entry, so it
  // gets a titled commit with no trailer. When one is given it must be real.
  if (id && !isValidId(id)) {
    throw new Error("stdin `id` must be a Foreman entry id (three or more digits, zero-padded to at least three)");
  }
  const expected = (Array.isArray(options.expected) ? options.expected : [])
    .map((entry) => String(entry === undefined || entry === null ? "" : entry).trim())
    .filter(Boolean);
  if (!expected.length) {
    throw new Error("stdin `expected` must list at least one owned path or area — an undeclared surface cannot be compared");
  }
  const baseline = normalizeCommit(root, options.baseline);
  if (!baseline) {
    throw new Error("--baseline must name the commit `begin` returned — a dirty begin has no baseline, so this unit commits nothing");
  }
  const roadmapClose = options.roadmap_close === true;
  const messageTitle = String(options.message_title || "").trim();
  if (!options.noCommit && !messageTitle) {
    throw new Error("stdin `message_title` is required unless --no-commit");
  }

  const head = git(root, ["rev-parse", "HEAD"]).trim();
  if (head !== baseline) {
    // Something committed between begin and finish. The delta is no longer
    // this task's alone, so there is nothing safe to stage.
    return { ok: false, reason: "head_moved_since_baseline", baseline, head };
  }

  const changedAll = changedSinceBaseline(root, baseline);
  // [Foreman: 184] Ledger files are never this unit's to stage, with one
  // declared exception: ROADMAP.jsonl itself, on the roadmap close that owns
  // it. Everything else shared-ledger — the archive, and [Foreman: 202] the
  // untracked backup an auto-migration may have left sitting in the tree —
  // is left out in EVERY mode, so a close never rides bookkeeping dirt into
  // its own commit and a plain unit leaves it for whoever owns it.
  // finish itself still stages only ROADMAP.jsonl for a declared close; what
  // the staged close already put in the index is allowed below.
  const bookkeeping = (file) => isSharedLedger(file) && !(roadmapClose && file === ROADMAP_FILE);
  const changed = changedAll.filter((file) => !bookkeeping(file));
  const ledgerExcluded = changedAll.filter(bookkeeping);
  // [Foreman: 1112] A declared close's ROADMAP.jsonl alone is not a task
  // change: the entry's own in_progress flip always leaves it changed.
  if (changed.every(isSharedLedger)) return { ok: false, reason: "no_task_changes", baseline };

  // [Foreman: 410] A gitlink is staged only when `expected` names that exact
  // path. An area hint is not enough — `lib/a.js` overlaps `lib` in both
  // directions — and neither is --allow-unexpected. Nothing is staged yet.
  const unnamedLinks = gitlinksIn(root, changed).filter(
    (file) => !expected.some((area) => normalizedTouch(area) === normalizedTouch(file))
  );
  if (unnamedLinks.length) {
    return {
      ok: false,
      reason: "gitlink_not_expected",
      baseline,
      expected,
      gitlinks: unnamedLinks,
      staged: false,
      error: `${unnamedLinks.join(", ")} is a submodule: commit the work inside it and close the entry with update-status and that commit, or name the exact path in expected to stage its pointer`,
    };
  }

  // [Foreman: 335] A declared roadmap close in a private roadmap: git ignores
  // ROADMAP.jsonl, so neither diff nor ls-files ever lists it, nothing here
  // hands it to `git add`, and the commit carries the task's files alone.
  // The result says so rather than leaving the caller to notice from `files`.
  const ignored = roadmapClose ? ignoredPaths(root, [ROADMAP_FILE]) : [];
  const notice = ignored.length ? { warnings: [notStagedWarning(id, ignored)] } : {};

  const allowed = roadmapClose ? [...expected, ...CLOSE_BOOKKEEPING] : expected;
  const unexpected = changed.filter((file) => !isOwned(file, allowed));
  if (unexpected.length && !options.allowUnexpected) {
    // Nothing is staged yet, so refusing here leaves the index exactly as
    // it was found. The caller shows these files and asks the user.
    return {
      ok: false,
      reason: "unexpected_files",
      baseline,
      expected,
      changed_files: changed,
      unexpected_files: unexpected,
      staged: false,
    };
  }

  // Only the paths that still differ from the index need staging -- a
  // rename's or deletion's already-staged half rides into the commit as it
  // sits, and `git add` never has to be asked about a path that no longer
  // exists in either tree.
  const dirty = worktreeDirty(root);
  const toStage = changed.filter((file) => dirty.has(file));
  // [Foreman: 1154] A refusal below puts back what the user had staged
  // rather than HEAD.
  const before = indexSnapshot(root);
  // [Foreman: 1160] Every git step from `git add` to the commit refuses
  // through here, so none of them throws with finish's staging in the index.
  const failedAfterStaging = (reason, error) => ({
    ok: false,
    reason,
    baseline,
    error: error.stderr ? String(error.stderr).trim() : error.message,
    ...restoreIndex(before, toStage),
  });
  if (toStage.length) {
    try {
      gitWithPaths(root, ["add"], toStage);
    } catch (error) {
      return failedAfterStaging("staging_failed", error);
    }
  }
  // [Foreman: 1140] Bookkeeping already staged when finish runs (by a staged
  // close, or by hand) is not this unit's: it stays staged and out of the
  // commit.
  let stagedAll;
  try {
    stagedAll = stagedSince(root, baseline);
  } catch (error) {
    return failedAfterStaging("staging_failed", error);
  }
  const heldStaged = stagedAll.filter(
    (file) => bookkeeping(file) && !(roadmapClose && CLOSE_BOOKKEEPING.has(file))
  );
  const staged = stagedAll.filter((file) => !heldStaged.includes(file));
  const strayStaged = options.allowUnexpected
    ? []
    : staged.filter((file) => !isOwned(file, allowed));
  const missing = changed.filter((file) => !staged.includes(file));
  // [Foreman: 1154] Staged, then put back to the baseline in the worktree:
  // no diff against the baseline lists it, and the commit would record
  // content the worktree lacks, or, as a pathspec commit, drop it and
  // overwrite the staged blob.
  const restored = staged.filter((file) => !changedAll.includes(file) && !strayStaged.includes(file));
  if (strayStaged.length || missing.length || restored.length) {
    return {
      ok: false,
      reason: strayStaged.length ? "unexpected_files" : "staging_incomplete",
      baseline,
      expected,
      changed_files: changed,
      ...(strayStaged.length ? { unexpected_files: strayStaged } : {}),
      ...(missing.length ? { missing_files: missing } : {}),
      ...(restored.length
        ? {
          restored_files: restored,
          error: `${restored.join(", ")} is staged, but the working tree holds its baseline content: stage the content you want, or unstage it, then run finish again`,
        }
        : {}),
      ...restoreIndex(before, toStage),
    };
  }

  if (options.noCommit) {
    return {
      ok: true,
      committed: false,
      baseline,
      files: staged,
      ...(ledgerExcluded.length ? { ledger_excluded: ledgerExcluded } : {}),
      ...(id ? { trailer: commitTrailerFor(id) } : {}),
      ...notice,
    };
  }

  const messageArgs = id
    ? ["-m", messageTitle, "-m", commitTrailerFor(id)]
    : ["-m", messageTitle];
  // A pathspec commit (--only) records just these paths and leaves the held
  // bookkeeping staged; the worktree matches the index for each of them here.
  // No timeout, as in task.js: a project's pre-commit hook may run its suite.
  try {
    if (heldStaged.length) gitWithPaths(root, ["commit", "-q", ...messageArgs], staged, { timeout: 0 });
    else git(root, ["commit", "-q", ...messageArgs], { timeout: 0 });
  } catch (error) {
    // A rejecting hook leaves HEAD on the baseline. A commit that landed
    // before git failed keeps its index and is attested below.
    let head = baseline;
    try {
      head = git(root, ["rev-parse", "HEAD"]).trim();
    } catch {}
    if (head === baseline) return failedAfterStaging("commit_failed", error);
  }
  const commit = git(root, ["rev-parse", "HEAD"]).trim();
  const attested = attestCommit(root, { baseline, commit, id, roadmapClose });
  return {
    ok: attested.ok,
    ...(attested.ok ? {} : { reason: "post_commit_attestation_failed" }),
    committed: true,
    baseline,
    commit,
    files: staged,
    ...(ledgerExcluded.length ? { ledger_excluded: ledgerExcluded } : {}),
    attested,
    ...notice,
  };
}

function readStdinJSON() {
  let raw;
  try {
    raw = fs.readFileSync(0, "utf-8");
  } catch {
    raw = "";
  }
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

const USAGE = `safe-commit.js -- the one task-owned commit path. Prints one
JSON line to stdout: {"ok":true,...} or {"ok":false,...} (exit 1 on a usage
error; a refusal is a successful call reporting ok:false).

  begin     no input. Clean tree -> {ok:true,dirty:false,baseline:{head,state_hash}}.
            Dirty tree -> {ok:true,dirty:true,reason:"..."} and NO baseline:
            offer the user to resolve it first, or continue WITHOUT automated
            commits. Never proceed implicitly. reason "git_status_unavailable"
            adds cause: git's error text. Exception: dirt confined to
            shared-ledger files (a tracked roadmap's own status flip) still
            returns the baseline, with ledger_dirty naming those files.

  finish    --baseline <sha from begin>  [--no-commit] [--allow-unexpected]
            stdin JSON: {id?, expected:[paths...], message_title?, roadmap_close?}
            id: the entry this commit closes -- its canonical "Foreman: <id>"
              trailer is appended. Omit for a checkpoint that owns no entry.
            expected: declared surface, prefix-aware ("src/api" owns every
              file beneath it). Required.
            message_title: commit subject. Required unless --no-commit.
            roadmap_close: true only for the close-in-commit flow: finish
              stages ROADMAP.jsonl with the task's files, and update-status
              staged:true runs after it to record and stage the close.
              When git ignores ROADMAP.jsonl (a private roadmap), the
              commit carries the task's files alone and warnings says so.
            Refuses (ok:false, nothing staged) when HEAD moved since the
            baseline, when nothing but shared-ledger files changed
            (no_task_changes; a roadmap_close whose only change is
            ROADMAP.jsonl too), or when a changed file matches no expected
            entry -- unexpected_files names them. Re-run with
            --allow-unexpected only after the user approved those files.
            A file staged and then put back to its baseline content in the
            tree is refused as staging_incomplete, named in restored_files.
            A git commit that fails, as when a pre-commit hook refuses,
            is refused as commit_failed.
            A refusal after staging leaves the index as finish found it;
            when it cannot write the index back, left_staged names the
            files finish staged and restore_error says why.
            A changed submodule gitlink is refused as gitlink_not_expected
            unless expected names that exact path; neither an area hint
            nor --allow-unexpected stages one. Work inside a submodule
            commits there and closes with update-status commit:<sha>.
            --no-commit stages and stops, for the close-in-commit flow:
            finish --no-commit, then update-status staged:true, then one
            git commit carrying the returned trailer.

Examples:
  node safe-commit.js begin
  echo '{"id":"121","expected":["scripts","tests"],"message_title":"Add safe commit"}' \\
    | node safe-commit.js finish --baseline 7e720ea
  echo '{"id":"121","expected":["scripts"]}' \\
    | node safe-commit.js finish --baseline 7e720ea --no-commit
`;

// [Foreman: 208] One insertion point, not six. Every refusal this script can
// produce leaves through main(), so the trial record is taken here rather
// than at each `return {ok:false, ...}` — a new refusal added later is
// counted without anyone remembering to add a second call beside it.
//
// A dirty tree is the one refusal that reports `ok: true` (it is a legitimate
// state, not a failure), so it is matched on `dirty` and translated to the
// name TRIALS.md uses. Anything whose reason is not in the closed vocabulary
// is skipped by the writer itself, which is why nothing is filtered here.
function recordInterruption(result, root) {
  if (!result || typeof result !== "object") return;
  const reasonClass = result.dirty === true ? "dirty_tree" : result.ok === false ? result.reason : null;
  if (!reasonClass) return;
  recordTrial("commit_interrupted", { hook: "safe-commit", reason_class: reasonClass }, { root });
}

// The flags each subcommand reads; parseFlags refuses any other.
const SUBCOMMAND_FLAGS = {
  begin: {},
  finish: { baseline: "value", "no-commit": "switch", "allow-unexpected": "switch" },
};

function main() {
  const [, , subcommand, ...rest] = process.argv;
  if (printHelp(process.argv.slice(2), USAGE)) return;
  if (!Object.hasOwn(SUBCOMMAND_FLAGS, subcommand || "")) throw new Error(USAGE);
  const flags = parseFlags(`safe-commit.js ${subcommand}`, SUBCOMMAND_FLAGS[subcommand], rest);
  const root = projectDir();
  let result;
  if (subcommand === "begin") {
    result = beginUnit(root);
  } else {
    result = finishUnit(root, {
      ...readStdinJSON(),
      baseline: flags.baseline,
      noCommit: flags["no-commit"] === true,
      allowUnexpected: flags["allow-unexpected"] === true,
    });
  }
  recordInterruption(result, root);
  process.stdout.write(JSON.stringify(result));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }
}

module.exports = {
  beginUnit,
  finishUnit,
  attestCommit,
  changedSinceBaseline,
  isOwned,
  git,
  stagedSince,
  CLOSE_BOOKKEEPING,
  ROADMAP_FILE,
};
