#!/usr/bin/env node
"use strict";

// TaskCompleted — the mechanical mirror of task-created.js: instead of
// mechanizing the OPEN transition, this gates the CLOSE. A task completing
// while its named roadmap entry is still open (planned or in_progress) is
// exactly how a real session once closed an entry `done` with uncommitted
// code — the 0.16.2 prose rule ("close the entry, then complete the task")
// can be ignored; this makes it harder to.
//
// Probed 2026-07-14 (headless CLI 2.1.210, brief §2.1/§4 M1) and re-probed
// 2026-07-23 (CLI 2.1.216), 2026-08-13 (CLI 2.1.228), 2026-08-21 (CLI
// 2.1.238) and 2026-08-25 (CLI 2.1.241), unchanged every time:
// TaskCompleted accepts the same top-level
// {"decision":"block","reason":"..."} shape as Stop/SubagentStop — a real
// block (the TaskUpdate call itself returns success:false, updatedFields:[],
// with the reason as its own tool_result text, not a system-reminder). No
// harness-side retry after a block was observed (one firing per task_id
// across all probe runs); a haiku driver that saw a genuine block still
// described the completion as successful in its own prose despite quoting
// the reason verbatim, so the reason text below is written as an imperative
// instruction sequence rather than a description.
//
// That block is the ONLY output channel this event has. The 2026-07-23
// re-probe emitted, on TaskCompleted, `systemMessage`,
// `hookSpecificOutput.additionalContext`, plain stdout and stderr: every one
// left zero trace — no transcript attachment of any kind, no tool-result
// text, no model mention — while the same hook on SessionStart,
// UserPromptSubmit, PostToolUse and Stop produced hook_system_message and
// hook_additional_context attachments for the first two fields. The gate
// below therefore offers `off` and `block` only: an advisory mode on this
// event cannot reach anyone, so it is not offered rather than shipped
// silent. Do not add another output field here expecting it to arrive.
//
// This hook never writes to ROADMAP.jsonl — task-created.js stays the only
// writing hook. It only reads (readEntries) and, at most, emits a block.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { readInput, projectDir } = require("./lib");
const crypto = require("crypto");

const { readEntries } = require("../scripts/roadmap");
// [Foreman: 134] Entry-to-commit facts come from the one interpreter, so this
// gate resolves a commit in the same places every other status view does --
// including a submodule, where a root-only lookup found nothing.
const { trailerShasFor } = require("../scripts/commit-evidence");
const { readConfigFile } = require("../scripts/foreman-config");
const { record: recordTrial, recordResumeRecovered } = require("../scripts/trial-log");
const { ENTRY_MARKER_RE, entryIdFromDescription } = require("./task-created");

// [Foreman: 131] `awaiting_acceptance` is deliberately NOT gated here, even
// though it is an open status everywhere dependency and archive logic asks.
// This gate exists to stop work from disappearing UNRECORDED — its block text
// orders the session to close the entry `done`, which is exactly the move
// `awaiting_acceptance` exists to withhold until the user says yes. An
// awaiting entry is already recorded (status, commit, notes), so blocking
// would demand an unauthorized close, and would deadlock every session with
// no user to ask — background agents and any unattended runner's own
// fold-back, both of which leave entries awaiting on purpose. The doctor's
// `awaiting_without_evidence` warning covers the one case this gate would
// otherwise catch: an awaiting entry with nothing recorded at all.
const OPEN_STATUSES = new Set(["planned", "in_progress"]);
const GATE_MODES = new Set(["off", "block"]);

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT
  ? path.resolve(process.env.CLAUDE_PLUGIN_ROOT)
  : path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(PLUGIN_ROOT, "scripts", "roadmap.js");

function readConfig(root) {
  // Absent config, or corrupt -- same safe default: readConfigFile hands
  // back {} for both, and this hook's event has no channel to warn on.
  const v = readConfigFile(root).config.taskCloseGate;
  return GATE_MODES.has(v) ? v : "off";
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
  if (!entry) return;

  const taskId = String(data.task_id || "");
  const baseLatch = taskId ? `${String(data.session_id || "")}:${taskId}` : "";

  // Existing open-entry gate -- keeps precedence. An open entry is fully
  // handled here; the trial-log record below is only reached for a closed
  // entry, so the two never both fire in one run.
  if (OPEN_STATUSES.has(entry.status)) {
    if (readConfig(root) !== "block") return;
    if (baseLatch && !shouldGate(root, baseLatch)) return; // already gated once for this session's task_id
    // [Foreman: 208] The close was held and the decision handed back — an
    // interruption from the user's side of the work, which is what
    // attention-cost.js's commit_interruptions counts. The refusal NAME
    // only, never the entry or what was in it.
    recordTrial("commit_interrupted", { hook: "task-completed", reason_class: "verification_declined" }, { root });
    write({ decision: "block", reason: blockReason(id) });
    return;
  }

  // [Foreman: 208] The success half of resume recovery. A terminal entry
  // carrying commits or observed files is finished work; whether finishing it
  // counts as a RECOVERY is decided inside recordResumeRecovered, from
  // whether the log already saw this project's work sitting un-recovered on
  // an earlier day. A task that ran start to finish in one go is not a
  // recovery and must not inflate the rate.
  if ((entry.commits || []).length > 0 || (entry.observed_touches || []).length > 0) {
    recordResumeRecovered({ root });
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
  blockReason,
  trailerShasFor,
  SCRIPT_PATH,
};
