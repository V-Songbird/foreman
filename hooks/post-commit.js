#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

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
function commitFailed(data) {
  const code = data?.exit_code;
  return typeof code === "number" && code !== 0;
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
          "If they say it's not ready, leave it in_progress — don't mark done."
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

function discoveryBlock() {
  return (
    "[Foreman] Roadmap discovery is enabled for this project. Scan this " +
    "commit's work for CONFIRMED opportunities, bugs, or ideas — not vague " +
    "hunches. If you add one to the roadmap, write it dense using only " +
    "what's already in this session's context (exact paths, line ranges, " +
    "symbol names, the specific behavior observed) — do NOT run extra " +
    "Read/Grep/Bash calls just to enrich the entry, that spends tokens now " +
    "instead of saving them for whoever picks it up later. Before asking " +
    "about it, check it isn't a repeat of something already declined: " +
    `echo '{"title":"...","why":"..."}' | node ${SCRIPT_PATH} check-duplicate ` +
    "— skip it silently if duplicate:true. Otherwise ask the user " +
    "(AskUserQuestion) what to do with it: Add to roadmap / Execute with " +
    "TaskCreate (work it now in this session, tracked) / Execute with a " +
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
    "through it don't get MCP tools. Never act without asking. Say nothing " +
    "if nothing is confirmed."
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
  const freshlyDone = entries.filter((e) => e.status === "done" && e.updated_at === todayStr);
  const config = readConfig(root);

  const blocks = [];
  if (inProgress.length || freshlyDone.length) {
    blocks.push(statusSyncBlock(inProgress, freshlyDone, config.requireVerification));
  }
  if (config.discoverySuggestions) {
    blocks.push(discoveryBlock());
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
  readConfig,
  projectDir,
  statusSyncBlock,
  discoveryBlock,
  SCRIPT_PATH,
};
