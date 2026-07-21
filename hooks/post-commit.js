#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { readEntries, today } = require("../scripts/roadmap");

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT
  ? path.resolve(process.env.CLAUDE_PLUGIN_ROOT)
  : path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(PLUGIN_ROOT, "scripts", "roadmap.js");

const WATCHED_TOOLS = new Set(["Bash", "PowerShell"]);
const SEP = /\s*(?:&&|\|\||[;|\n])\s*/;
const COMMIT_RE = /^\s*git\s+(?:-\S+\s+)*commit\b/i;

function projectDir() {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

function readInput() {
  let raw;
  try {
    raw = fs.readFileSync(0, "utf-8");
  } catch {
    return {};
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function isGitCommit(command) {
  return command.split(SEP).some((part) => COMMIT_RE.test(part));
}

// Confirmed against code.claude.com/docs/en/hooks.md: PostToolUse's Bash
// exit code is a top-level `exit_code` field, not nested under
// tool_response/tool_output (tool_response is stdout text, a string, not an
// object) -- the field this checked before was never real, so this always
// silently failed open. Fail open still, on a genuinely absent field.
//
// An exit-preserving PreToolUse wrapper (hush's preserve-exit-code) forces
// the shell's own exit to 0 and embeds the real code in the output text as
// a marker triplet ([[hush:exit= / N / ]]); PostToolUse hooks across
// plugins run in parallel, so this hook sees that raw marker, never a
// corrected field. When a marker is present it is the truth and the
// top-level 0 is not; absent marker, same field check as before.
const WRAPPED_EXIT_RES = [
  /\[\[hush:exit=\s*(-?\d+)\s*\]\]/, // raw marker triplet (\s* spans the newlines)
  /\[hush: exit (-?\d+)\]/, // compressed form, in case ordering ever changes
];

function wrappedExitCode(data) {
  const r = data?.tool_response;
  const texts =
    typeof r === "string"
      ? [r]
      : r && typeof r === "object"
        ? [r.stdout, r.stderr, r.output].filter((t) => typeof t === "string")
        : [];
  for (const t of texts) {
    for (const re of WRAPPED_EXIT_RES) {
      const m = re.exec(t);
      if (m) return parseInt(m[1], 10);
    }
  }
  return undefined;
}

function commitFailed(data) {
  const wrapped = wrappedExitCode(data);
  if (typeof wrapped === "number") return wrapped !== 0;
  const code = data?.exit_code;
  return typeof code === "number" && code !== 0;
}

// The freshly-done follow-up nudge fires once per entry per day, not on
// every commit of a busy day — a tmpdir state file keyed by project root
// remembers which entries were already mentioned today. Best-effort both
// ways: unreadable state means nudge again (fail open), unwritable state
// means the dedup just doesn't stick.
function freshlyDoneStatePath(root) {
  const safe = crypto.createHash("sha1").update(String(root)).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), `foreman-freshlydone-${safe}.json`);
}

function filterUnnudged(root, ids, todayStr) {
  const p = freshlyDoneStatePath(root);
  let state = { date: todayStr, ids: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (parsed && parsed.date === todayStr && Array.isArray(parsed.ids)) state = parsed;
  } catch {
    // missing or corrupt state — treat as a fresh day
  }
  const unnudged = ids.filter((id) => !state.ids.includes(id));
  if (unnudged.length) {
    try {
      fs.writeFileSync(p, JSON.stringify({ date: todayStr, ids: [...state.ids, ...unnudged] }));
    } catch {
      // best effort
    }
  }
  return new Set(unnudged);
}

function readConfig(root) {
  const p = path.join(root, ".foreman", "config.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    return {
      discoverySuggestions: parsed?.discoverySuggestions === true,
      requireVerification: parsed?.requireVerification === true,
    };
  } catch {
    return { discoverySuggestions: false, requireVerification: false };
  }
}

// Two independent triggers, since a task stops getting any nudge the moment
// it's marked done — real usage showed a same-day follow-up bugfix commit
// (found right after finishing a task, before moving on) silently loses its
// SHA with no signal at all, unlike an in_progress task which still nudges.
// Passing commit also auto-folds that commit's actual changed files into
// touches (roadmap.js runs `git show` itself) — touches is set once, from
// whatever investigation happened before the task started, and nothing
// updates it once real work reveals a wider (or different) footprint.
// add_touches remains for the rare case that needs it (git unavailable, or
// a file touched outside this specific commit) but doesn't need mentioning
// here — passing commit alone already covers the common case.
//
// requireVerification decouples "record the work" from "call it done": data
// (commit/touches) is never worth gating on a human, only the status label
// is — so under the flag, the in_progress branch still records immediately
// but leaves status alone until the user actually confirms it.
function statusSyncBlock(inProgress, freshlyDone, requireVerification) {
  const parts = [];
  if (inProgress.length) {
    const list = inProgress.map((e) => `${e.id} ("${e.title}")`).join(", ");
    if (requireVerification) {
      parts.push(
        `This commit may complete an in-progress ROADMAP.jsonl task (${list}), ` +
          "but requireVerification is on for this project — record the work now, " +
          "don't close it out yet. Run `git rev-parse --short HEAD` for the SHA, then: " +
          `echo '{"id":"<id>","status":"in_progress","commit":"<sha>"}' | node ${SCRIPT_PATH} update-status ` +
          "(keeps commits[]/touches accurate — touches still auto-folds from the " +
          "commit's diff, same as always). Then ask the user (AskUserQuestion) " +
          "whether this is actually verified and working. Only on confirmation, " +
          "close it out: " +
          `echo '{"id":"<id>","status":"done"}' | node ${SCRIPT_PATH} update-status. ` +
          "If they say it's not ready, leave it in_progress — don't mark done. " +
          "If this session has no user to ask (a background agent), leave it " +
          "in_progress too — the user confirms later."
      );
    } else {
      parts.push(
        `This commit may complete an in-progress ROADMAP.jsonl task (${list}). ` +
          "If it does, run `git rev-parse --short HEAD` for the commit SHA, then: " +
          `echo '{"id":"<id>","status":"done","commit":"<sha>"}' | node ${SCRIPT_PATH} update-status. ` +
          "The script computes updated_at, appends the SHA, and auto-folds that " +
          "commit's actual changed files into touches — don't hand-edit the file, " +
          "and no need to list touched files yourself, the script derives them."
      );
    }
  }
  if (freshlyDone.length) {
    const list = freshlyDone.map((e) => `${e.id} ("${e.title}")`).join(", ");
    parts.push(
      `This commit might also be a follow-up fix for a task already marked done ` +
        `earlier today (${list}) — a bugfix right after finishing a task is easy to ` +
        "lose track of, since nothing nudges about a task once it's done. If this " +
        "commit actually relates to one of those, append its SHA rather than " +
        "letting it go unrecorded: run `git rev-parse --short HEAD`, then " +
        `echo '{"id":"<id>","status":"done","commit":"<sha>"}' | node ${SCRIPT_PATH} update-status ` +
        "(same status — this only adds the SHA, and auto-folds this commit's " +
        "changed files into touches; commits[] and touches both only grow, never " +
        "shrink). Most commits won't relate to an already-done task — say nothing " +
        "if this one doesn't."
    );
  }
  return "[Foreman] " + parts.join(" ");
}

// The planned titles ride along as a negative list. check-duplicate stays
// the mechanical backstop, but its word-overlap score can't catch a
// paraphrase of an entry that already covers the same ground — naming them
// is the free half, since main() has already read every entry.
// razor: the whole planned list is inlined; if a backlog ever makes this
// block dominate the hook payload, cap it or drop back to check-duplicate.
function alreadyCovered(entries) {
  const planned = (entries || []).filter((e) => e.status === "planned");
  if (!planned.length) return "";
  const list = planned.map((e) => `${e.id} ("${e.title}")`).join(", ");
  return (
    `These are already on the roadmap as planned: ${list}. Do not propose ` +
    "anything they already cover, even reworded. "
  );
}

function discoveryBlock(entries) {
  return (
    "[Foreman] Roadmap discovery is enabled for this project. " +
    alreadyCovered(entries) +
    "Scan this " +
    "commit's work for CONFIRMED opportunities, bugs, or ideas — not vague " +
    "hunches. If you add one to the roadmap, write it dense using only " +
    "what's already in this session's context (exact paths, line ranges, " +
    "symbol names, the specific behavior observed) — do NOT run extra " +
    "Read/Grep/Bash calls just to enrich the entry, that spends tokens now " +
    "instead of saving them for whoever picks it up later. Before asking " +
    "about it, check it isn't already on the roadmap in any form: " +
    `echo '{"title":"...","why":"..."}' | node ${SCRIPT_PATH} check-duplicate ` +
    "— matches carry each entry's status. A rejected match means the user " +
    "already declined it: skip silently. Any other status (planned/" +
    "in_progress/done/...) means it's already tracked: skip it, or mention " +
    "the existing entry's id if the new observation adds something. Only " +
    "when there's no match, ask the user " +
    "(AskUserQuestion) what to do with it: Add to roadmap / Execute here " +
    "(work it now in this session) / Execute with a " +
    "background Agent (run_in_background: true) / Reject — both Add and " +
    "Reject use the same `add` call, only the status field differs " +
    '("planned" for Add, "rejected" for Reject): ' +
    `echo '{"title":"...","why":"...","what":"...","source":"claude-suggested","status":"planned"}' | node ${SCRIPT_PATH} add. ` +
    "Also scan for the inverse case: work already implemented in this " +
    "commit that goes beyond what any in_progress task's `what` describes — " +
    "scope that grew mid-session (e.g. the user asked for something related " +
    "but separate, and it got built inline), not a future idea. If you find " +
    "one, it's already done, so log and close it in the same breath rather " +
    "than leaving it \"planned\": the same `add` call above, then " +
    `echo '{"id":"<new-id>","status":"done","commit":"<sha>"}' | node ${SCRIPT_PATH} update-status ` +
    "(touches auto-derives from that commit). Ask first (AskUserQuestion: " +
    "Log it / Skip). " +
    "Never call " +
    "mcp__ccd_session__spawn_task — it has a known bug where tasks spawned " +
    "through it don't get MCP tools. Never act without asking. If this " +
    "session has no user to ask (a background agent), skip the suggestions " +
    "entirely. Say nothing if nothing is confirmed."
  );
}

function main() {
  const data = readInput();
  if (!WATCHED_TOOLS.has(data.tool_name)) return;

  const command = (data.tool_input?.command || "").trim();
  if (!command || !isGitCommit(command)) return;
  if (commitFailed(data)) return;

  const root = projectDir();
  if (!fs.existsSync(path.join(root, "ROADMAP.jsonl"))) return;

  let entries;
  try {
    entries = readEntries(root);
  } catch {
    return; // corrupt file — stay silent rather than nudge Claude into writing on top of it
  }

  const todayStr = today();
  const inProgress = entries.filter((e) => e.status === "in_progress");
  const doneToday = entries.filter((e) => e.status === "done" && e.updated_at === todayStr);
  const unnudged = doneToday.length
    ? filterUnnudged(root, doneToday.map((e) => e.id), todayStr)
    : new Set();
  const freshlyDone = doneToday.filter((e) => unnudged.has(e.id));
  const config = readConfig(root);

  const blocks = [];
  if (inProgress.length || freshlyDone.length) {
    blocks.push(statusSyncBlock(inProgress, freshlyDone, config.requireVerification));
  }
  if (config.discoverySuggestions) {
    blocks.push(discoveryBlock(entries));
  }
  if (!blocks.length) return;

  const payload = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: blocks.join("\n\n"),
    },
  };
  try {
    process.stdout.write(Buffer.from(JSON.stringify(payload), "utf-8"));
  } catch {
    // ignore
  }
}

if (require.main === module) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}

module.exports = {
  main,
  isGitCommit,
  commitFailed,
  wrappedExitCode,
  freshlyDoneStatePath,
  filterUnnudged,
  readConfig,
  projectDir,
  statusSyncBlock,
  discoveryBlock,
  SCRIPT_PATH,
};
