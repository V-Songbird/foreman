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
const { spawnSync } = require("child_process");

const { readEntries, anchorHasId, trailerIdsIn } = require("../scripts/roadmap");
const { readDecisionLog } = require("../scripts/decision-log-config");
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

// --- Decision-log backstop (roadmap entry 092) --------------------------
//
// A separate, opt-in gate that fires only on a `done` close, only when the
// existing open-entry gate above did NOT fire (an entry can't be both open
// and done, so the two never contend in one run). It checks that a closed
// task recorded WHERE its decision lives: either an ADR doc under the
// configured dir, or the forced "none" (decided nothing worth recording).
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

// Combined patch text for the entry's commits, or null on any git failure
// (missing repo, bad sha, git not installed, timeout). Null is the signal
// to treat the anchor sub-check as passed -- infra never blocks completion.
function gitShow(root, shas) {
  let result;
  try {
    result = spawnSync("git", ["show", "--pretty=format:", ...shas], {
      cwd: root,
      encoding: "utf-8",
      timeout: 30000,
    });
  } catch {
    return null;
  }
  if (!result || result.error || result.status !== 0) return null;
  return result.stdout || "";
}

// Commits linked to an entry by a `Foreman: <id>` message trailer — the
// staged close's inverse pointer, where commits[] stays empty on purpose.
// Candidates come from a loose --grep (fixed substring), then each
// message is verified precisely with trailerIdsIn. Null on any git
// failure, [] when no commit names the id — callers distinguish the two.
function trailerShasFor(root, id) {
  let result;
  try {
    result = spawnSync("git", ["log", "--grep=Foreman:", "--format=%h%x00%B%x1e"], {
      cwd: root,
      encoding: "utf-8",
      timeout: 30000,
    });
  } catch {
    return null;
  }
  if (!result || result.error || result.status !== 0) return null;
  const shas = [];
  for (const record of (result.stdout || "").split("\x1e")) {
    const [sha, body] = record.split("\x00");
    if (sha && sha.trim() && body && trailerIdsIn(body).includes(String(id))) {
      shas.push(sha.trim());
    }
  }
  return shas;
}

// The imperative core of a decision-log violation, or null when the entry
// is compliant (doc "none", a doc file plus an anchored commit, or an
// investigation-only close with no commits to audit). Callers wrap this
// core in either the nudge or the block framing.
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
  if (!fs.existsSync(path.resolve(root, doc))) {
    return (
      `ROADMAP.jsonl entry ${id} names decision doc ${doc}, but no file exists there. Create ` +
      `the ADR at ${doc}, or re-close the entry with \`"doc":"none"\` if it decided nothing worth recording.`
    );
  }

  // (3b) An anchor comment must sit at the governed code. An empty commits
  // array is either a staged close (the `Foreman: <id>` trailer links the
  // commit instead of a recorded sha) or an investigation-only close --
  // resolve the trailer first, and only skip when no commit names the id.
  let commits = Array.isArray(entry.commits) ? entry.commits.filter(Boolean) : [];
  if (commits.length === 0) {
    const linked = trailerShasFor(root, id);
    if (linked === null) return null; // git failure -- infra never blocks
    if (linked.length === 0) return null; // investigation-only close -- nothing to audit
    commits = linked;
  }

  const patch = gitShow(root, commits);
  if (patch === null) return null; // git failure -- infra never blocks
  if (anchorHasId(patch, id)) return null;

  return (
    `ROADMAP.jsonl entry ${id} has decision doc ${doc}, but none of its commits carry an ` +
    `anchor comment for it. Add a \`[Foreman: ${id}]\` comment at the code the decision governs, ` +
    `amend the commit to include it, then re-close entry ${id} with that commit's sha.`
  );
}

function dlNudgeMessage(core) {
  return `[Foreman] ${core}`;
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
    const mode = readConfig(root);
    if (mode === "off") return;
    if (baseLatch && !shouldGate(root, baseLatch)) return; // already gated once for this session's task_id
    if (mode === "block") {
      write({ decision: "block", reason: blockReason(id) });
    } else {
      write({ systemMessage: nudgeMessage(id) });
    }
    return;
  }

  // Decision-log backstop -- only a `done` close is auditable for an ADR
  // (dropped/rejected/deferred decided nothing to record).
  if (entry.status !== "done") return;

  const dl = readDecisionLog(root);
  if (!dl.enabled || dl.gate === "off") return; // opt-in; disabled/off -> silent

  const core = decisionLogCore(root, entry, dl.dir);
  if (!core) return; // compliant close

  // Own latch, suffixed off the base key -- fires even after the open gate
  // consumed `session:task`, and itself at most once per session's task_id.
  const dlLatch = baseLatch ? `${baseLatch}:dl` : "";
  if (dlLatch && !shouldGate(root, dlLatch)) return;

  if (dl.gate === "block") {
    write({ decision: "block", reason: dlBlockReason(core) });
  } else {
    write({ systemMessage: dlNudgeMessage(core) });
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
  decisionLogCore,
  dlNudgeMessage,
  dlBlockReason,
  trailerShasFor,
  SCRIPT_PATH,
};
