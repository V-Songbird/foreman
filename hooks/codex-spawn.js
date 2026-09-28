#!/usr/bin/env node
"use strict";

// Codex only (hooks/codex-hooks.json). [Foreman: 926] A subagent that carries
// an entry's handoff is named `foreman_<id>`, so its finish can be tied back
// to that entry. Codex shows the name only at the spawn: PreToolUse on
// `collaborationspawn_agent` sees `tool_input.task_name`, but SubagentStart and
// SubagentStop carry only `agent_id` and the subagent's rollout path. The
// rollout's first record (`session_meta`) names the subagent's `agent_path`,
// which ends in its task_name. That record is an internal Codex format, not a
// documented hook field: when it is unreadable or changes shape, nothing maps
// and the close check falls back to explicit `codex-task.js check` calls.

const fs = require("fs");
const path = require("path");
const { readInput, projectDir } = require("./lib");
const { readEntries, ID_PATTERN } = require("../scripts/roadmap");

const SPAWN_TOOL = "collaborationspawn_agent";
const TASK_NAME_RE = new RegExp(`^foreman_(${ID_PATTERN})$`);
// The first record also holds the base instructions, so it can run to tens of
// kilobytes; a first line longer than this is not a record this reads.
const MAX_META_BYTES = 4 * 1024 * 1024;

// PreToolUse: a task_name that starts with "foreman" must be exactly
// foreman_<id> for an entry in this roadmap. Codex 0.157.1 hands the hook the
// spawn message encrypted, so a handoff cannot be told from a helper: every
// other name passes, and the handoff wording carries the naming rule.
function main(data = readInput()) {
  if (data.tool_name !== SPAWN_TOOL) return;
  const name = String((data.tool_input || {}).task_name || "");
  if (!name.startsWith("foreman")) return;
  const root = projectDir(data);
  // A project that never ran init has no entries to reserve names for.
  if (!fs.existsSync(path.join(root, "ROADMAP.jsonl"))) return;
  const match = TASK_NAME_RE.exec(name);
  let entries;
  try { entries = readEntries(root); } catch { return; }
  if (match && entries.some((e) => e.id === match[1])) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Foreman: task_name "${name}" is reserved for roadmap handoffs and must be exactly foreman_<id>, naming an entry in ROADMAP.jsonl. Spawn again with the handed-off entry's name, or with a name that does not start with "foreman".`,
    },
  }));
}

function firstRecord(file) {
  const fd = fs.openSync(file, "r");
  try {
    const chunks = [];
    const buffer = Buffer.alloc(64 * 1024);
    for (let read = 0, n; read < MAX_META_BYTES && (n = fs.readSync(fd, buffer, 0, buffer.length, read)) > 0; read += n) {
      const end = buffer.subarray(0, n).indexOf(10);
      chunks.push(Buffer.from(buffer.subarray(0, end < 0 ? n : end)));
      if (end >= 0) return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// SubagentStop: the entry a foreman_<id> subagent worked on, and the scope of
// the thread that spawned it: "" for the main thread, whose id is the
// session's, or the spawning subagent's id, which its shell sees as
// CODEX_THREAD_ID (codex-task.js currentScope).
function subagentEntry(data) {
  if (!data.agent_transcript_path) return null;
  let record;
  try { record = firstRecord(data.agent_transcript_path); } catch { return null; }
  const meta = record && record.type === "session_meta" ? record.payload || {} : {};
  const match = TASK_NAME_RE.exec(String(meta.agent_path || "").split("/").pop());
  if (!match) return null;
  const parent = String(meta.parent_thread_id || "");
  return { id: match[1], agent: parent && parent !== data.session_id ? parent : "" };
}

if (require.main === module) { try { main(); } catch { /* hooks fail open */ } }
module.exports = { main, subagentEntry };
