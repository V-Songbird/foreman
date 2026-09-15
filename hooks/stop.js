#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { readInput, projectDir } = require("./lib");
const { readEntries, isValidId } = require("../scripts/roadmap");
const { readConfigFile } = require("../scripts/foreman-config");
const { scopePath, OPEN } = require("./codex-task");

function main(data = readInput()) {
  if (!["Stop", "SubagentStop"].includes(data.hook_event_name) || data.stop_hook_active) return;
  const root = projectDir(data);
  if (readConfigFile(root).config.taskCloseGate !== "block") return;
  const scope = scopePath(root, data.session_id, data.agent_id || "");
  if (!scope || !fs.existsSync(scope)) return;
  let entries;
  try { entries = readEntries(root); } catch { return; }
  const open = [];
  for (const filename of fs.readdirSync(scope)) {
    if (!filename.endsWith(".json")) continue;
    const id = filename.slice(0, -5);
    if (!isValidId(id)) continue;
    const entry = entries.find((e) => e.id === id);
    if (entry && OPEN.has(entry.status)) open.push(id);
    // Consume the attempted completion exactly once, including when another
    // tool already satisfied it. A future explicit check can re-arm it.
    try { fs.unlinkSync(path.join(scope, filename)); } catch { /* best effort */ }
  }
  if (!open.length) return;
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `[Foreman] The explicit completion check for ROADMAP.jsonl ${open.join(", ")} is unresolved. Record the actual result through roadmap.js, preserving awaiting_acceptance when acceptance is required, then run codex-task.js check again. If user input or an external change is required, explain that blocker and leave the entry in_progress; do not invent a completion or perform unapproved work.`,
  }));
}

if (require.main === module) { try { main(); } catch { /* hooks fail open */ } }
module.exports = { main };
