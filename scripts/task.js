#!/usr/bin/env node
"use strict";

// A handoff's entry bookkeeping as two calls, in the shape of
// `roadmap.js step pick`: each prints one JSON line whose `next` names what
// the session does now. Nothing is kept between calls; `start` hands the
// boundary to `finish` through the command it returns in `then`.
//
//   start   opens the entry (planned or deferred -> in_progress; an entry
//           already in_progress is left as it is) and, without
//           --investigation, takes the commit boundary with safe-commit's
//           begin, inside the submodule when every planned file sits in one.
//   finish  stages the files the task owns, closes the entry and commits
//           once with the entry's trailer, in the one form the project
//           needs: the staged close at the root, a commit inside the
//           submodule, or a commit before the close when git ignores
//           ROADMAP.jsonl. It never stages into a tree that held someone
//           else's changes, or after a commit since start: it records the
//           close without staging and returns report_dirty.
//
// Every host's entry paragraph runs this script. The Codex form, which
// Antigravity also takes, opens the entry with hooks/codex-task.js start
// first and checks it with codex-task.js check after the close; it quotes
// the finish command itself instead of reading start's `then`.

const path = require("path");
const fs = require("fs");
const {
  readEntries,
  soleHolder,
  cmdUpdateStatus,
  cmdAnnotate,
  commitTrailerFor,
  ignoredPaths,
  isValidId,
  normalizedTouch,
  submodulePaths,
} = require("./roadmap");
const { beginUnit, finishUnit, attestCommit, isOwned, git, gitFailureCause, stagedSince, CLOSE_BOOKKEEPING, ROADMAP_FILE } = require("./safe-commit");
const { render } = require("./render-sections");
const { record: recordTrial } = require("./trial-log");
const { projectDir, parseFlags, printHelp } = require("./runtime");

// [Foreman: 1139] Every `then` command runs unchanged under sh, bash and
// PowerShell. Single quotes keep `$` literal in all three. A value holding a
// single quote is written as a bare first character followed by single-quoted
// runs, each run of single quotes double-quoted between them: both shells
// then read one argument, whereas PowerShell splits a word that opens with a
// quote. A value whose first character could
// not stand bare keeps the JSON string `step pick` writes.
function shellQuote(value) {
  const text = String(value);
  if (!text.includes("'")) return `'${text}'`;
  if (!/^[\w/]/.test(text)) return JSON.stringify(text);
  return text[0] + text.slice(1).split(/('+)/).map((run, i) => (i % 2 ? `"${run}"` : run && `'${run}'`)).join("");
}
function nodeCommand(file) {
  return `node ${shellQuote(file.replaceAll("\\", "/"))}`;
}
const SELF = nodeCommand(__filename);
const ROADMAP_CMD = nodeCommand(path.join(__dirname, "roadmap.js"));

function quoteArg(value) {
  const text = String(value);
  return /^[\w.:@/-]+$/.test(text) ? text : shellQuote(text);
}

// [Foreman: 410] The submodule every planned path sits inside, as .gitmodules
// spells it, or null. Work there commits in the submodule's own repository,
// where a staged close at the project root would see only the gitlink. A
// surface that is empty, at the root or spread across repositories keeps the
// root close. craft-handoff.js reads the same answer for the checkpoint embed.
function plannedSubmodule(root, touches) {
  const paths = (touches || []).map(normalizedTouch).filter(Boolean);
  if (!paths.length) return null;
  return submodulePaths(root).find((sub) => {
    const base = normalizedTouch(sub);
    return paths.every((file) => file === base || file.startsWith(`${base}/`));
  }) || null;
}

function holder(root, id, sub) {
  if (!isValidId(String(id || ""))) throw new Error(`task.js ${sub} needs --id <entry id>, three or more digits`);
  const entry = soleHolder(readEntries(root), String(id), "ROADMAP.jsonl");
  if (!entry) throw new Error(`no entry ${id} in ROADMAP.jsonl`);
  return entry;
}

// The flags start passes on to the finish command it returns; the entry
// paragraph bakes the same ones into its start command.
function carriedFlags(flags) {
  return [
    flags.investigation ? " --investigation" : "",
    flags.agent ? " --agent" : "",
    flags.orchestrator ? ` --orchestrator ${quoteArg(flags.orchestrator)}` : "",
  ].join("");
}

function finishCommand(id, flags, baseline) {
  return `${SELF} finish --id ${id}${baseline ? ` --baseline ${baseline}` : ""}${carriedFlags(flags)}`;
}

function cmdStart(root, flags) {
  const entry = holder(root, flags.id, "start");
  const id = entry.id;
  if (["planned", "deferred"].includes(entry.status)) {
    cmdUpdateStatus(root, { id, status: "in_progress" });
  } else if (entry.status !== "in_progress") {
    throw new Error(`entry ${id} is ${entry.status}, so there is nothing to start. Ask the user which entry this work belongs to`);
  }
  // An investigation stages and commits nothing, so it takes no boundary.
  if (flags.investigation) return { next: "work", then: finishCommand(id, flags) };
  const sub = plannedSubmodule(root, entry.planned_touches);
  const boundary = beginUnit(sub ? path.join(root, sub) : root);
  if (boundary.dirty) {
    recordTrial("commit_interrupted", { hook: "safe-commit", reason_class: "dirty_tree" }, { root });
    const where = sub ? `submodule ${sub}` : "project";
    // [Foreman: 1112] Only a tree with changes is blamed on someone else's.
    const cause = {
      working_tree_has_changes: `The ${where} already holds changes that are not this task's`,
      not_a_git_worktree: `The ${where} is not a git work tree`,
    }[boundary.reason] || `Git could not read the ${where}'s status`;
    return {
      next: "report_dirty",
      reason: boundary.reason,
      ...(boundary.cause ? { cause: boundary.cause } : {}),
      say: `${cause}, so this run stages and commits nothing; the task's changes stay in the tree for you to commit.`,
      then: finishCommand(id, flags),
    };
  }
  return {
    next: "work",
    baseline: boundary.baseline.head,
    ...(sub ? { submodule: sub } : {}),
    then: finishCommand(id, flags, boundary.baseline.head),
  };
}

// The last paragraph of `message` is a trailer block when every line in it
// reads `Key: value`; the entry's trailer joins it as the final line, with no
// blank line before it, and starts its own block otherwise.
function withTrailer(message, id) {
  const trailer = commitTrailerFor(id);
  const text = String(message).replace(/\s+$/, "");
  if (text.split("\n").pop().trim() === trailer) return text;
  const paragraphs = text.split(/\n[ \t]*\n/);
  const block = paragraphs.length > 1 && paragraphs[paragraphs.length - 1].split("\n").every((line) => /^[A-Za-z0-9-]+: \S/.test(line));
  return `${text}${block ? "\n" : "\n\n"}${trailer}`;
}

// [Foreman: 1171] Returns what is known once the commit may have landed, as
// safe-commit.js finish does: { sha } plus a `warning` when git reported an
// error after the commit landed, or { unreadable } when HEAD cannot be read.
// Throws only when no commit landed (HEAD still on `baseline`).
function commit(cwd, message, baseline) {
  let commitError = null;
  try {
    // No timeout: a project's pre-commit hook may run its whole suite.
    // [Foreman: 1164] No output limit: git sends the hook's output to stderr.
    git(cwd, ["commit", "-q", "-m", message], { timeout: 0, maxBuffer: Infinity });
  } catch (error) {
    commitError = error;
  }
  let sha;
  try {
    sha = git(cwd, ["rev-parse", "HEAD"]).trim();
  } catch (error) {
    if (commitError) throw commitError;
    return { unreadable: gitFailureCause(error) };
  }
  if (commitError && sha === baseline) throw commitError;
  return commitError ? { sha, warning: `git commit reported an error after the commit landed: ${gitFailureCause(commitError)}` } : { sha };
}

// What the session does once the entry is closed.
function acceptance(entry, recorded, unverified, flags) {
  if (recorded !== "awaiting_acceptance") return { next: "closed", status: recorded };
  const id = entry.id;
  if (flags.orchestrator) {
    const who = flags.orchestrator;
    return {
      next: "report_acceptance",
      status: recorded,
      say: flags.agent
        ? `Say in your final message that entry ${id} now needs the orchestrator ${who}'s acceptance, not the user's, before anything new starts.`
        : `Acceptance for this session belongs to the orchestrator ${who}, so don't ask the user: report the evidence and any unverified checks to ${who} and leave entry ${id} awaiting its acceptance. Unless this session is ${who}, don't close it yourself, and start nothing new until it answers.`,
    };
  }
  if (flags.agent) {
    return {
      next: "report_acceptance",
      status: recorded,
      say: `Say in your final message that entry ${id} now needs the user's accept or decline before anything new starts.`,
    };
  }
  const options = [
    ...(unverified.length
      ? [{
          label: "Test it first (Recommended)",
          description: "Check by hand what could not be run here; the entry keeps waiting for your acceptance.",
          do: "Read the `unverified` checks back to the user and stop; the entry stays awaiting_acceptance.",
        }]
      : []),
    {
      label: unverified.length ? "Accept" : "Accept (Recommended)",
      description: "Close the entry as done.",
      then: `echo '${JSON.stringify({ id, status: "done" })}' | ${ROADMAP_CMD} update-status`,
    },
    {
      label: "Review it first",
      description: "Go through what changed; the entry keeps waiting for your acceptance.",
      do: "Walk the user through what changed; the entry stays awaiting_acceptance.",
    },
  ];
  return {
    next: "ask_acceptance",
    status: recorded,
    question: `${entry.title} (${id}) is finished and waits for your acceptance. What next?`,
    options,
    ...(unverified.length ? { unverified } : {}),
  };
}

const STATUSES = ["done", "dropped", "rejected"];

function stringList(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`stdin \`${field}\` must be an array of non-empty strings`);
  }
  return value.map((item) => item.trim());
}

// [Foreman: 1161] The fix text for a refused finishUnit result. When the
// helper could not put the index back, its staging is still there, so the text
// names those files instead of saying nothing was staged.
function refusalFix(unit, sub) {
  const left = unit.left_staged || [];
  // [Foreman: 1168] The restore command names the left paths only, so it
  // leaves any other staging alone. A submodule close stages inside the
  // submodule, so the command runs there with -C. `git restore --staged`
  // fails in a repository with no commit yet (probed: "could not resolve
  // 'HEAD'"), where `git rm --cached` unstages instead.
  const paths = left.map(quoteArg).join(" ");
  const git = sub ? `git -C ${quoteArg(sub)}` : "git";
  const reason = unit.restore_error || "no reason given";
  const how = left.length
    ? `these files are still staged: ${left.join(", ")}. Unstage them with \`${git} restore --staged -- ${paths}\` (\`${git} rm --cached -- ${paths}\` when the repository has no commit yet) before anything else.`
    : "files may still be staged. Run `git status` and unstage them before anything else.";
  const stagedNote = left.length || unit.restore_error ? ` The commit helper could not restore the index (${reason}), so ${how}` : "";
  const missingNote = unit.missing_files ? `finish expected these changed files to be staged and they are not: ${unit.missing_files.join(", ")}.` : "";
  // "Tell the user" appears once in each fix.
  const closing = `Tell the user; nothing was closed.${stagedNote}`;
  const untouched = stagedNote ? ` ${closing}` : " Nothing was staged or closed.";
  const incomplete = [missingNote, unit.restored_files ? `${unit.error}.` : ""].filter(Boolean).join(" ");
  const fixes = {
    unexpected_files: `Show the user these changed files that \`files\` does not list. Add the ones that are this task's to \`files\` and run the close again; with the user's approval of the rest, run it with --allow-unexpected.${missingNote ? ` ${missingNote}` : ""}${untouched}`,
    no_task_changes: `Nothing changed since start. Run the close again without \`files\` to record it without a commit.${untouched}`,
    staging_incomplete: `${incomplete} ${closing}`,
  };
  return fixes[unit.reason] || `${unit.error || unit.reason}. ${missingNote ? `${missingNote} ` : ""}${closing}`;
}

function refusal(root, reason, fields) {
  recordTrial("commit_interrupted", { hook: "safe-commit", reason_class: reason }, { root });
  return { next: "refused", reason, ...fields };
}

function cmdFinish(root, flags, payload) {
  const entry = holder(root, flags.id, "finish");
  const id = entry.id;
  if (entry.status !== "in_progress") {
    throw new Error(`entry ${id} is ${entry.status}, not in_progress, so there is nothing to close. Run task.js start --id ${id} first`);
  }
  const input = payload || {};
  const { status, notes, message, model, effort } = input;
  if (!STATUSES.includes(status)) throw new Error(`stdin \`status\` must be one of ${STATUSES.join("|")}: the status the work earned`);
  const files = flags.investigation ? [] : stringList(input.files, "files");
  const unverified = stringList(input.unverified, "unverified");
  if (files.length && !String(message || "").trim()) throw new Error("stdin `message` is required with `files`: the commit message, without the Foreman trailer");

  const hold = status === "done" && (render(root).requireVerification || Boolean(flags.orchestrator));
  const recorded = hold ? "awaiting_acceptance" : status;
  const close = {
    id,
    status: recorded,
    ...(notes ? { notes } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(effort !== undefined ? { effort } : {}),
  };
  // One annotate per check, so each is one `unverified:` line; a line the
  // entry already carries, as on a rerun, is not written twice.
  const annotate = () => {
    for (const check of unverified) {
      const line = `unverified: ${check}`;
      if (!String(holder(root, id, "finish").notes || "").includes(line)) cmdAnnotate(root, { id, notes: line });
    }
  };
  const after = () => acceptance(entry, recorded, unverified, flags);
  const rerun = (extra = "") => `${finishCommand(id, flags, flags.baseline)}${extra}`;

  // Nothing to stage: an investigation, or a close that changed no file.
  if (!files.length) {
    annotate();
    cmdUpdateStatus(root, close);
    return after();
  }

  const sub = plannedSubmodule(root, entry.planned_touches);
  const cwd = sub ? path.join(root, sub) : root;
  const owned = sub ? files.map((file) => (normalizedTouch(file).startsWith(`${sub}/`) ? normalizedTouch(file).slice(sub.length + 1) : file)) : files;
  // The staged close: a tracked roadmap at the root rides in the task's commit.
  const stagedClose = !sub && ignoredPaths(root, [ROADMAP_FILE]).length === 0;
  // [Foreman: 1078] Someone else's changes in the tree, seen at start (no
  // baseline) or staged in the index since: the close is recorded without
  // touching the index, so nothing of the task's lands in their pending
  // commit, and nothing of theirs in a Foreman one.
  const foreignStaged = () => {
    try {
      return stagedSince(cwd, "HEAD").filter((file) => !isOwned(file, stagedClose ? [...owned, ...CLOSE_BOOKKEEPING] : owned));
    } catch {
      return null;
    }
  };
  const unstaged = (reason, cause, extra = {}) => {
    annotate();
    cmdUpdateStatus(root, { ...close, add_touches: files });
    return {
      next: "report_dirty",
      reason,
      ...extra,
      say: `${cause}, so nothing was staged or committed; the task's changes stay in the tree for you to commit.`,
      after: after(),
    };
  };
  const staged = flags.baseline ? foreignStaged() : null;
  // [Foreman: 1112] No baseline says only that start took no boundary: it
  // found the tree holding changes or unreadable, or this ran by hand.
  if (!flags.baseline) return unstaged("no_baseline", "This close has no --baseline from start to tell the task's changes from anyone else's");
  if (staged === null) return unstaged("git_status_unavailable", "Git could not list the staged changes");
  if (staged.length) return unstaged("index_has_other_changes", `The index already holds staged changes that are not this task's (${staged.join(", ")})`, { staged_files: staged });

  // [Foreman: 1112] roadmap_close lets bookkeeping the index already holds
  // stay staged, as foreignStaged does; without it finish read that as an
  // unexpected file and reset the whole index.
  const unit = finishUnit(cwd, { id, expected: owned, baseline: flags.baseline, noCommit: true, roadmap_close: stagedClose, allowUnexpected: flags["allow-unexpected"] === true });
  // [Foreman: 1078] A commit since start makes the delta no longer this
  // task's alone, so the close is recorded unstaged under its own reason.
  if (unit.reason === "head_moved_since_baseline") {
    recordTrial("commit_interrupted", { hook: "safe-commit", reason_class: unit.reason }, { root });
    return unstaged(unit.reason, `Something was committed since this task started (HEAD moved from ${unit.baseline.slice(0, 7)} to ${unit.head.slice(0, 7)})`, { baseline: unit.baseline, head: unit.head });
  }
  if (!unit.ok) {
    const { ok, reason, ...details } = unit;
    return refusal(root, reason, {
      ...details,
      fix: refusalFix(unit, sub),
      ...(reason === "unexpected_files" ? { then: rerun(" --allow-unexpected") } : {}),
    });
  }

  annotate();
  const text = withTrailer(message, id);
  let closed;
  let made;
  if (stagedClose) {
    // The staged close: ROADMAP.jsonl rides in the task's own commit.
    closed = cmdUpdateStatus(root, { ...close, staged: true });
    try {
      made = commit(cwd, text, unit.baseline);
    } catch (error) {
      return refusal(root, "commit_failed", {
        error: gitFailureCause(error),
        closed: true,
        fix: `The close is recorded and staged with the task's files. Fix what stopped the commit, then commit once with \`git commit\`, with \`${commitTrailerFor(id)}\` as the final line of the message. Then act on after.`,
        // [Foreman: 1112] The close is recorded, so its acceptance step follows.
        after: after(),
      });
    }
  } else {
    // A submodule commit or a git-ignored roadmap: commit first, then record
    // the sha, which roadmap.js resolves inside the submodule.
    try {
      made = commit(cwd, text, unit.baseline);
    } catch (error) {
      return refusal(root, "commit_failed", {
        error: gitFailureCause(error),
        closed: false,
        fix: "The task's files are staged and the entry is still open. Fix what stopped the commit, then run the same close again.",
        then: rerun(),
      });
    }
    // An unreadable HEAD leaves no sha to record; the close is recorded without one.
    closed = cmdUpdateStatus(root, made.sha ? { ...close, commit: made.sha } : close);
  }
  const sha = made.sha;
  const landedWarnings = [...(closed.warnings || []), ...(made.warning ? [made.warning] : [])];
  if (!sha) {
    // [Foreman: 1171] The commit landed, so the close is never rerun.
    return {
      ...after(),
      ...(sub ? { submodule: sub } : {}),
      files: unit.files.map((file) => (sub ? `${sub}/${file}` : file)),
      warnings: [...landedWarnings, `the commit landed, but git could not read HEAD: ${made.unreadable}; its sha is not recorded on the entry`],
    };
  }
  let attested;
  try {
    attested = attestCommit(cwd, { baseline: unit.baseline, commit: sha, id, roadmapClose: stagedClose });
  } catch (error) {
    attested = { ok: false, reasons: [`git could not check it: ${gitFailureCause(error)}`] };
  }
  const warnings = [...landedWarnings, ...(attested.ok ? [] : [`the commit did not pass attestation: ${attested.reasons.join(", ")}`])];
  return {
    ...after(),
    commit: sha,
    ...(sub ? { submodule: sub } : {}),
    files: unit.files.map((file) => (sub ? `${sub}/${file}` : file)),
    ...(warnings.length ? { warnings } : {}),
  };
}

function readStdinJSON() {
  let raw;
  try {
    raw = fs.readFileSync(0, "utf-8");
  } catch {
    raw = "";
  }
  return raw.trim() ? JSON.parse(raw) : {};
}

const USAGE = `task.js -- a handoff's entry bookkeeping, on every host. Each call prints
one JSON line, {"ok":true,"next":"<code>",...}; act on next. Exit 1 on a
usage error, with {"ok":false,"error":"..."}.

  start   --id <id> [--investigation] [--agent] [--orchestrator <name>]
          Marks a planned or deferred entry in_progress (one already
          in_progress stays as it is) and, without --investigation, takes
          the commit boundary, inside the submodule when every planned file
          sits in one.
          next work: do the task; baseline is the boundary (none for an
            investigation).
          next report_dirty: no boundary, because the tree holds someone
            else's changes or git could not read it (reason says which);
            tell the user say, do the work, and the close commits nothing.
          then: the finish command, with the boundary and these flags.

  finish  --id <id> [--baseline <sha>] [--investigation] [--agent]
          [--orchestrator <name>] [--allow-unexpected]
          stdin JSON: {status, files?, message?, notes?, unverified?, model?, effort?}
          status: done|dropped|rejected, what the work earned; done is
            recorded as awaiting_acceptance when requireVerification is on
            or an orchestrator accepts.
          files: the files this task owns, from the project root; staged
            alone, never git add -A. message: the commit message; the
            "Foreman: <id>" trailer is added as its final line.
          unverified: checks only a person can settle, one annotate each.
          next ask_acceptance: question and options for the user; run an
            option's then, or do what its do says.
          next report_acceptance: do what say says.
          next closed: nothing more to record.
          next report_dirty: no --baseline, the index held someone else's
            changes, or HEAD moved since start (reason says which); the
            close is recorded, nothing was staged or committed; tell the
            user say, then act on after.
          next refused: nothing was closed unless closed says so; follow
            fix, and act on after when it is given.
`;

const SUBCOMMAND_FLAGS = {
  start: { id: "value", investigation: "switch", agent: "switch", orchestrator: "value" },
  finish: { id: "value", baseline: "value", investigation: "switch", agent: "switch", orchestrator: "value", "allow-unexpected": "switch" },
};

function main() {
  const [, , sub, ...rest] = process.argv;
  if (printHelp(process.argv.slice(2), USAGE)) return;
  if (!Object.hasOwn(SUBCOMMAND_FLAGS, sub || "")) throw new Error(`task.js takes start or finish${sub ? `, not ${sub}` : ""}. Run task.js --help`);
  const flags = parseFlags(`task.js ${sub}`, SUBCOMMAND_FLAGS[sub], rest);
  const root = projectDir();
  const result = sub === "start" ? cmdStart(root, flags) : cmdFinish(root, flags, readStdinJSON());
  process.stdout.write(JSON.stringify({ ok: true, ...result }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }
}

module.exports = { cmdStart, cmdFinish, refusalFix, plannedSubmodule, carriedFlags, withTrailer, USAGE, SUBCOMMAND_FLAGS };
