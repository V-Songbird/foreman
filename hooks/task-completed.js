#!/usr/bin/env node
"use strict";

// TaskCompleted — the mechanical mirror of task-created.js: instead of
// mechanizing the OPEN transition, this gates the CLOSE. A task completing
// while its named roadmap entry is still open (planned or in_progress) is
// exactly how a real session once closed an entry `done` with uncommitted
// code — the 0.16.2 prose rule ("close the entry, then complete the task")
// can be ignored; this makes it harder to.
//
// Probed 2026-07-14 (headless CLI 2.1.210, brief §2.1/§4 M1): TaskCompleted
// accepts the same top-level {"decision":"block","reason":"..."} shape as
// Stop/SubagentStop — a real block (the TaskUpdate call itself returns
// success:false, updatedFields:[], with the reason as its error text, not a
// system-reminder). hookSpecificOutput.additionalContext is NOT delivered
// on this event (confirmed: an emitting run left zero trace anywhere in the
// transcript) — so nudge mode uses the universal `systemMessage` field
// instead. No harness-side retry after a block was observed (one firing per
// task_id across all probe runs); a haiku driver that saw a genuine block
// still described the completion as successful in its own prose despite
// quoting the reason verbatim, so the reason text below is written as an
// imperative instruction sequence rather than a description.
//
// This hook never writes to ROADMAP.jsonl — task-created.js stays the only
// writing hook. It only reads (readEntries) and, at most, emits a nudge or
// a block.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { readEntries } = require("../scripts/roadmap");
const { ENTRY_MARKER_RE, entryIdFromDescription } = require("./task-created");

const OPEN_STATUSES = new Set(["planned", "in_progress"]);
const GATE_MODES = new Set(["off", "nudge", "block"]);

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

function readConfig(root) {
  const p = path.join(root, ".foreman", "config.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    const v = parsed?.taskCloseGate;
    return GATE_MODES.has(v) ? v : "nudge";
  } catch {
    return "nudge"; // absent config, or corrupt -- same safe default
  }
}

// Once-only-per-task latch, same shape as post-commit.js's freshlyDone
// dedupe: unreadable/missing state means "never gated yet" (fail open
// toward gating again, the least-surprising choice), an unwritable state
// just means the dedup doesn't stick for a later run. Keyed by
// session_id+task_id, not task_id alone -- TaskCreate's task_id is a small
// per-session counter that restarts at 1 in every fresh session, so a
// bare task_id would let an unrelated session's task inherit an already-
// latched id and skip the gate.
function latchStatePath(root) {
  const safe = crypto.createHash("sha1").update(String(root)).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), `foreman-taskclosegate-${safe}.json`);
}

function shouldGate(root, taskId) {
  const p = latchStatePath(root);
  let state = { ids: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (parsed && Array.isArray(parsed.ids)) state = parsed;
  } catch {
    // missing or corrupt state -- treat as never gated
  }
  if (state.ids.includes(taskId)) return false;
  try {
    fs.writeFileSync(p, JSON.stringify({ ids: [...state.ids, taskId] }));
  } catch {
    // best effort -- worst case this task_id gates again next time
  }
  return true;
}

function closeCommand(id) {
  return (
    `echo '{"id":"${id}","status":"done","commit":"<sha>"}' | node ${SCRIPT_PATH} update-status ` +
    "(or `annotate` findings instead, for an investigation-only close with no commit)"
  );
}

function nudgeMessage(id) {
  return (
    `[Foreman] ROADMAP.jsonl entry ${id} is still open. Close it before finishing: ${closeCommand(id)}.`
  );
}

function blockReason(id) {
  return (
    `[Foreman] This is Foreman's automated roadmap checkpoint, not you declining the ` +
    `completion -- adjust and retry, don't abandon it. ROADMAP.jsonl entry ${id} is still ` +
    `open. First, close it: ${closeCommand(id)}. Then mark this task completed again -- ` +
    "completing it again after closing the entry is the correct next step, not a repeat of a denied action."
  );
}

function write(payload) {
  try {
    process.stdout.write(Buffer.from(JSON.stringify(payload), "utf-8"));
  } catch {
    // ignore
  }
}

function main() {
  const data = readInput();
  if (data.hook_event_name && data.hook_event_name !== "TaskCompleted") return;

  const id = entryIdFromDescription(data.task_description);
  if (!id) return; // no marker -- stays composable with any other plugin gating this event

  const root = projectDir(data);
  if (!fs.existsSync(path.join(root, "ROADMAP.jsonl"))) return;

  let entries;
  try {
    entries = readEntries(root);
  } catch {
    return; // corrupt file -- never block or complicate task completion
  }
  const entry = entries.find((e) => e.id === id);
  if (!entry || !OPEN_STATUSES.has(entry.status)) return;

  const mode = readConfig(root);
  if (mode === "off") return;

  const taskId = String(data.task_id || "");
  const latchId = taskId ? `${String(data.session_id || "")}:${taskId}` : "";
  if (latchId && !shouldGate(root, latchId)) return; // already gated once for this session's task_id

  if (mode === "block") {
    write({ decision: "block", reason: blockReason(id) });
  } else {
    write({ systemMessage: nudgeMessage(id) });
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
  entryIdFromDescription,
  ENTRY_MARKER_RE,
  readConfig,
  shouldGate,
  latchStatePath,
  nudgeMessage,
  blockReason,
  SCRIPT_PATH,
};
