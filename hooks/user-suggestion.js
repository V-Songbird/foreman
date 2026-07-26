#!/usr/bin/env node
"use strict";

// UserPromptSubmit — route a suggestion the user voices in conversation
// through the roadmap instead of only acting on it.
//
// post-commit.js already captures what Claude spots in committed work
// (`discoverySuggestions`). The other half — an idea, complaint, or QoL
// gripe the user types mid-session — has no capture path at all: it gets
// worked, or it gets lost, and either way the roadmap never learns it
// happened. This closes that half, and only when the project asks for it:
// `userSuggestions` defaults to false.
//
// Delivery is per user turn on purpose. A rule stated once at session start
// is a rule that gets skimmed past by the time it matters, and the moment
// it matters is exactly the turn the user says the thing.

const fs = require("fs");
const path = require("path");

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT
  ? path.resolve(process.env.CLAUDE_PLUGIN_ROOT)
  : path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(PLUGIN_ROOT, "scripts", "roadmap.js");

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

function projectDir(data) {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd());
}

// Opt-in: anything other than an explicit `true` leaves the hook silent, so a
// missing file, a corrupt one, and a project that never asked all behave the
// same way.
function userSuggestionsEnabled(root) {
  const p = path.join(root, ".foreman", "config.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"))?.userSuggestions === true;
  } catch {
    return false;
  }
}

// razor: no roadmap entries are listed here, unlike post-commit's discovery
// block — this fires every user turn, so the already-covered list would be
// re-sent all session. check-duplicate carries that job instead. Inline the
// list here if duplicate proposals turn out to be common enough to matter.
function suggestionBlock() {
  return (
    "[Foreman] User-suggestion capture is on for this project. If the user's " +
    "message is an idea, a complaint, or an improvement about this project " +
    "rather than a request to do work now, it belongs on the roadmap — " +
    "acting on it alone loses the record of why the change happened. Before " +
    "asking, check it isn't already tracked in any form: " +
    `echo '{"title":"...","why":"..."}' | node ${SCRIPT_PATH} check-duplicate ` +
    "— matches carry each entry's status. A rejected match means the user " +
    "already declined it: skip silently. Any other status means it's tracked " +
    "already: skip it, or mention the existing entry's id if this adds " +
    "something. Only when there's no match, ask the user (AskUserQuestion) " +
    "what to do with it: Add to roadmap / Execute here (work it now in this " +
    "session) / Execute with a background Agent (run_in_background: true) / " +
    "Reject — both Add and Reject use the same `add` call, only the status " +
    'field differs ("planned" for Add, "rejected" for Reject): ' +
    `echo '{"title":"...","why":"...","what":"...","source":"user","status":"planned"}' | node ${SCRIPT_PATH} add. ` +
    "Executing it does not excuse logging it: add the entry first, then work " +
    "it, so the entry carries the commit. Never call " +
    "mcp__ccd_session__spawn_task — it has a known bug where tasks spawned " +
    "through it don't get MCP tools. Never act without asking. Say nothing " +
    "at all when the message is an ordinary request."
  );
}

function main() {
  const data = readInput();
  const root = projectDir(data);
  if (!fs.existsSync(path.join(root, "ROADMAP.jsonl"))) return;
  if (!userSuggestionsEnabled(root)) return;

  // UserPromptSubmit accepts raw stdout as added context — no JSON envelope.
  try {
    process.stdout.write(suggestionBlock());
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

module.exports = { main, suggestionBlock, userSuggestionsEnabled, projectDir };
