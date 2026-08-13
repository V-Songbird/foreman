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
// 2026-07-23 (CLI 2.1.216) and 2026-08-13 (CLI 2.1.228), unchanged both
// times: TaskCompleted accepts the same top-level
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
// hook_additional_context attachments for the first two fields. Both gates
// below therefore offer `off` and `block` only: an advisory mode on this
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

const { readEntries, anchorHasId } = require("../scripts/roadmap");
// [Foreman: 134] Entry-to-commit facts come from the one interpreter, so this
// gate resolves a commit in the same places every other status view does --
// including a submodule, where a root-only lookup found nothing and the anchor
// check silently passed.
const {
  recordedCommits,
  showCommits,
  trailerShasFor,
} = require("../scripts/commit-evidence");
const { readDecisionLog } = require("../scripts/decision-log-config");
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

// --- Decision-log backstop (roadmap entry 092, narrowed by 140) ---------
//
// A separate, opt-in gate that fires only on a `done` close of a
// `kind: "decision"` entry, only when the existing open-entry gate above
// did NOT fire (an entry can't be both open and done, so the two never
// contend in one run). Ordinary implementation work is never asked for a
// decision record -- an entry with no `kind` is a build and closes silently
// here no matter what the decisionLog config says. It checks that a closed
// decision task recorded WHERE its decision lives: either an ADR doc under
// the configured dir, or the forced "none" (decided nothing worth recording).
// When a doc path is named, it also verifies the code carries an anchor
// comment `[Foreman: <id>]` in one of the entry's commits, so the doc and
// the code it governs stay wired together.
//
// Infrastructure never blocks completion: any git failure (not a repo, bad
// sha, git absent) treats the anchor sub-check as passed, and the config
// read is fail-soft (a null/absent config means disabled -> silent).

// The close command that repairs a doc-missing entry. Shows both the doc
// path shape (<dir>/<id>.md) and the "none" escape hatch, mirroring the
// forced choice the roadmap schema enforces.
function dlCloseCommand(id, dir) {
  return (
    `echo '{"id":"${id}","status":"done","doc":"${dir}/${id}.md"}' | node ${SCRIPT_PATH} update-status ` +
    '(or use `"doc":"none"` if this task decided nothing worth an ADR)'
  );
}

// decision-doc-template.md's own italic instruction lines. A doc still
// carrying one is the template copied over and never filled in -- the case
// `fs.existsSync` alone waved through. Pinned against the template file by a
// test, the way check-prompt.js's PLACEHOLDER_FRAGMENTS is pinned against
// prompt-template.md, so a reworded template can't silently retire the check.
//
// Heading-agnostic on purpose: requiring a `## Decision` heading would reject
// a legitimate hand-written ADR and still pass the verbatim copy-paste this
// exists to catch, since the template opens with that very heading.
const TEMPLATE_PROMPTS = [
  "*State the choice made in one short paragraph",
  "*State what forced a choice",
  "*Highest-value section here.",
  "*State what this commits future work to",
];

// The imperative core of a decision-log violation, or null when the entry
// is compliant (doc "none", a doc file plus an anchored commit, or an
// investigation-only close with no commits to audit). The caller wraps this
// core in the block framing.
function decisionLogCore(root, entry, dir) {
  const id = entry.id;
  const doc = entry.doc;

  // (1) No doc field: the close never recorded where the decision lives.
  if (typeof doc !== "string" || doc === "") {
    return (
      `ROADMAP.jsonl entry ${id} is closed but records no decision doc. Record where this ` +
      `task's choice lives, then re-close it: ${dlCloseCommand(id, dir)}.`
    );
  }

  // (2) Forced "none": the task decided nothing worth an ADR -- pass.
  if (doc === "none") return null;

  // (3a) doc names a path: the file must exist under the project root.
  const docPath = path.resolve(root, doc);
  if (!fs.existsSync(docPath)) {
    return (
      `ROADMAP.jsonl entry ${id} names decision doc ${doc}, but no file exists there. Create ` +
      `the ADR at ${doc}, or re-close the entry with \`"doc":"none"\` if it decided nothing worth recording.`
    );
  }

  // (3a-ii) ...and say something. Existence alone passed an empty file and a
  // verbatim copy of decision-doc-template.md, which record no decision at
  // all. Fail-soft like every other read here: an unreadable file is infra,
  // and infra never blocks completion.
  let body = null;
  try {
    body = fs.readFileSync(docPath, "utf-8");
  } catch {
    body = null;
  }
  if (body !== null && (body.trim() === "" || TEMPLATE_PROMPTS.some((p) => body.includes(p)))) {
    return (
      `ROADMAP.jsonl entry ${id} names decision doc ${doc}, but that file is empty or still ` +
      `carries decision-doc-template.md's instruction lines. Write the decision it records, or ` +
      `re-close the entry with \`"doc":"none"\` if it decided nothing worth recording.`
    );
  }

  // (3b) An anchor comment must sit at the governed code. An empty commits
  // array is either a staged close (the `Foreman: <id>` trailer links the
  // commit instead of a recorded sha) or an investigation-only close --
  // resolve the trailer first, and only skip when no commit names the id.
  let commits = recordedCommits(entry);
  if (commits.length === 0) {
    const linked = trailerShasFor(root, id);
    if (linked === null) return null; // git failure -- infra never blocks
    if (linked.length === 0) return null; // investigation-only close -- nothing to audit
    commits = linked;
  }

  const patch = showCommits(root, commits);
  if (patch === null) return null; // git failure -- infra never blocks
  if (anchorHasId(patch, id)) return null;

  return (
    `ROADMAP.jsonl entry ${id} has decision doc ${doc}, but none of its commits carry an ` +
    `anchor comment for it. Add a \`[Foreman: ${id}]\` comment at the code the decision governs, ` +
    `amend the commit to include it, then re-close entry ${id} with that commit's sha.`
  );
}

// Same probe-derived framing as blockReason above: the provenance opener
// (this is Foreman's checkpoint, adjust and retry) plus the "complete it
// again" closer that keeps a driver from reading the block as a refusal.
function dlBlockReason(core) {
  return (
    `[Foreman] This is Foreman's automated roadmap checkpoint, not you declining the ` +
    `completion -- adjust and retry, don't abandon it. ${core} Then mark this task completed ` +
    "again -- completing it again after fixing the record is the correct next step, not a repeat of a denied action."
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
  // handled here; the decision-log check below is only reached for a closed
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

  // Decision-log backstop -- only a `done` close is auditable for an ADR
  // (dropped/rejected/deferred decided nothing to record).
  if (entry.status !== "done") return;

  // ...and only an explicit decision task. Ordinary implementation work never
  // owes a decision record, so no `kind` (a build) means silence here.
  if (entry.kind !== "decision") return;

  const dl = readDecisionLog(root);
  if (!dl.enabled || dl.gate !== "block") return; // opt-in; disabled/off -> silent

  const core = decisionLogCore(root, entry, dl.dir);
  if (!core) return; // compliant close

  // Own latch, suffixed off the base key -- fires even after the open gate
  // consumed `session:task`, and itself at most once per session's task_id.
  const dlLatch = baseLatch ? `${baseLatch}:dl` : "";
  if (dlLatch && !shouldGate(root, dlLatch)) return;

  write({ decision: "block", reason: dlBlockReason(core) });
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
  decisionLogCore,
  TEMPLATE_PROMPTS,
  dlBlockReason,
  trailerShasFor,
  SCRIPT_PATH,
};
