#!/usr/bin/env node
"use strict";

// [Foreman: 121]
// The one commit routine every Foreman execution mode shares — single-task
// closes, task-split checkpoints, and sprint bookkeeping. It exists so no
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
const { execFileSync } = require("child_process");
const {
  repositoryState,
  repositorySnapshot,
  normalizeCommit,
  isSharedLedger,
  ledgerOnlyDirt,
  touchesOverlap,
} = require("./sprint");
const { commitTrailerFor, isValidId } = require("./roadmap");
// [Foreman: 134] One reading of a commit's Foreman trailer, shared with sprint.
const { trailerLinesIn, hasExactTrailer } = require("./commit-evidence");

const ROADMAP_FILE = "ROADMAP.jsonl";

function projectDir() {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 8 * 1024 * 1024,
  });
}

// -z output, forward-slashed so a Windows checkout compares against the
// same path shape the roadmap stores.
function zsplit(out) {
  return out.split("\0").filter(Boolean).map((file) => file.replaceAll("\\", "/"));
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

// An expected entry is an area hint, exactly as `touches` is: `src/api`
// owns every file beneath it. Same normalized, prefix-aware comparison
// sprint planning uses for collisions, so one rule covers both.
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
    if (!ledger) return { ok: true, dirty: true, reason: state.reason };
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
    // [Foreman: 134] Same strict rule sprint's attestUnit applies, from the one
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
    (file) => isSharedLedger(file) && !(roadmapClose && file === ROADMAP_FILE)
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
  // [Foreman: 184] Ledger files are never this unit's to stage. Unless this
  // finish IS the declared roadmap close, they are left out entirely — not
  // staged, not counted as unexpected — so the coordinator's in_progress
  // flip (or any other ledger dirt) stays in the tree for the close that
  // owns it.
  const changed = roadmapClose ? changedAll : changedAll.filter((file) => !isSharedLedger(file));
  const ledgerExcluded = roadmapClose ? [] : changedAll.filter(isSharedLedger);
  if (!changed.length) return { ok: false, reason: "no_task_changes", baseline };

  const allowed = roadmapClose ? [...expected, ROADMAP_FILE] : expected;
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

  git(root, ["add", "--", ...changed]);
  const staged = stagedSince(root, baseline);
  const strayStaged = options.allowUnexpected
    ? []
    : staged.filter((file) => !isOwned(file, allowed));
  const missing = changed.filter((file) => !staged.includes(file));
  if (strayStaged.length || missing.length) {
    if (staged.length) git(root, ["reset", "-q", "--", ...staged]);
    return {
      ok: false,
      reason: strayStaged.length ? "unexpected_files" : "staging_incomplete",
      baseline,
      expected,
      changed_files: changed,
      ...(strayStaged.length ? { unexpected_files: strayStaged } : {}),
      ...(missing.length ? { missing_files: missing } : {}),
      staged: false,
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
    };
  }

  const messageArgs = id
    ? ["-m", messageTitle, "-m", commitTrailerFor(id)]
    : ["-m", messageTitle];
  git(root, ["commit", "-q", ...messageArgs]);
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

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

const USAGE = `safe-commit.js -- the one task-owned commit path. Prints one
JSON line to stdout: {"ok":true,...} or {"ok":false,...} (exit 1 on a usage
error; a refusal is a successful call reporting ok:false).

  begin     no input. Clean tree -> {ok:true,dirty:false,baseline:{head,state_hash}}.
            Dirty tree -> {ok:true,dirty:true,reason:"..."} and NO baseline:
            offer the user to resolve it first, or continue WITHOUT automated
            commits. Never proceed implicitly. Exception: dirt confined to
            shared-ledger files (a tracked roadmap's own status flip) still
            returns the baseline, with ledger_dirty naming those files.

  finish    --baseline <sha from begin>  [--no-commit] [--allow-unexpected]
            stdin JSON: {id?, expected:[paths...], message_title?, roadmap_close?}
            id: the entry this commit closes -- its canonical "Foreman: <id>"
              trailer is appended. Omit for a checkpoint that owns no entry.
            expected: declared surface, prefix-aware ("src/api" owns every
              file beneath it). Required.
            message_title: commit subject. Required unless --no-commit.
            roadmap_close: true only for the close-in-commit flow, where
              update-status staged:true has already staged ROADMAP.jsonl.
            Refuses (ok:false, nothing staged) when HEAD moved since the
            baseline, when nothing changed, or when a changed file matches
            no expected entry -- unexpected_files names them. Re-run with
            --allow-unexpected only after the user approved those files.
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

function main() {
  const [, , subcommand, ...rest] = process.argv;
  const flags = parseFlags(rest);
  const root = projectDir();
  let result;
  if (subcommand === "begin") {
    result = beginUnit(root);
  } else if (subcommand === "finish") {
    result = finishUnit(root, {
      ...readStdinJSON(),
      baseline: flags.baseline,
      noCommit: flags["no-commit"] === true,
      allowUnexpected: flags["allow-unexpected"] === true,
    });
  } else {
    throw new Error(USAGE);
  }
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
};
