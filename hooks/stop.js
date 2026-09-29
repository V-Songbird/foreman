#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { readInput, projectDir } = require("./lib");
const { readEntries, isValidId } = require("../scripts/roadmap");
const { readConfigFile } = require("../scripts/foreman-config");
const { scopePath, OPEN } = require("./codex-task");
const { subagentEntry } = require("./codex-spawn");

// [Foreman: 926] A foreman_<id> subagent's finish arms the check for that
// entry in the scope of the thread that spawned it, as an explicit check there
// would: the coordinator owns the entry's close, so its next Stop reads it.
function armSpawner(root, data) {
  try {
    const mapped = subagentEntry(data);
    const scope = mapped && scopePath(root, data.session_id, mapped.agent);
    if (!scope) return;
    fs.mkdirSync(scope, { recursive: true });
    // [Foreman: 949] "wx" keeps an explicit check's arm from being overwritten.
    fs.writeFileSync(path.join(scope, `${mapped.id}.json`), JSON.stringify({ id: mapped.id, subagent: true }), { encoding: "utf-8", flag: "wx" });
  } catch { /* best effort */ }
}

// [Foreman: 941] A reviewed increment waiting on its reviewer keeps the entry
// in_progress by design, and its latest review note already records that
// blocker. Every follow-up to its foreman_<id> subagent re-arms the check, so
// without this the coordinator's Stop would block once per follow-up.
// [Foreman: 949] Only while that note is the entry's latest line: any later
// note, such as a decision, a lesson or a line of new work, means the entry
// moved on. Each append is one line (roadmap.js appendNote).
function reviewPending(entry) {
  const last = String(entry.notes || "").trim().split("\n").at(-1).trim();
  return /^(?:\d{4}-\d{2}-\d{2}\s+)*(paused|review pending):/.test(last);
}

function main(data = readInput()) {
  if (!["Stop", "SubagentStop"].includes(data.hook_event_name)) return;
  const root = projectDir(data);
  if (readConfigFile(root).config.taskCloseGate !== "block") return;
  // A subagent its own check blocked stops again with stop_hook_active; that
  // finish still arms its spawner. Only the block below honors the flag.
  if (data.hook_event_name === "SubagentStop") armSpawner(root, data);
  if (data.stop_hook_active) return;
  const scope = scopePath(root, data.session_id, data.agent_id || "");
  if (!scope || !fs.existsSync(scope)) return;
  let entries;
  try { entries = readEntries(root); } catch { return; }
  const open = [];
  for (const filename of fs.readdirSync(scope)) {
    if (!filename.endsWith(".json")) continue;
    const id = filename.slice(0, -5);
    if (!isValidId(id)) continue;
    // [Foreman: 949] The review pass applies to a subagent's finish only; an
    // explicit check is deliberate and blocks once, as before 941.
    let subagent = false;
    try { subagent = JSON.parse(fs.readFileSync(path.join(scope, filename), "utf-8")).subagent === true; } catch { /* treated as explicit */ }
    // [Foreman: 760] Any open holder of a duplicated id keeps the check open.
    if (entries.some((e) => e.id === id && OPEN.has(e.status) && !(subagent && reviewPending(e)))) open.push(id);
    // Consume the attempted completion exactly once, including when another
    // tool already satisfied it. A future explicit check can re-arm it.
    try { fs.unlinkSync(path.join(scope, filename)); } catch { /* best effort */ }
  }
  if (!open.length) return;
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `[Foreman] The completion check for ROADMAP.jsonl ${open.join(", ")} is unresolved: an explicit check or the finish of its foreman_<id> subagent armed it. Record the actual result through roadmap.js, preserving awaiting_acceptance when acceptance is required, then run codex-task.js check again. If user input or an external change is required, explain that blocker and leave the entry in_progress; do not invent a completion or perform unapproved work.`,
  }));
}

if (require.main === module) { try { main(); } catch { /* hooks fail open */ } }
module.exports = { main };
