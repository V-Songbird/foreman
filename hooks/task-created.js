#!/usr/bin/env node
"use strict";

// TaskCreated — mechanically mark a roadmap entry in_progress when a task
// is created from its own Foreman handoff prompt.
//
// The TaskCreate destination means "work it in this session", so on this
// path task creation IS work starting — the same moment the assembled
// prompt's embedded instruction asks the destination to mark. This hook
// performs that already-sanctioned transition mechanically instead of
// hoping the prose gets obeyed; the embedded instruction stays as the
// fallback for sessions without Foreman installed (a second same-status
// update is a harmless no-op). Clipboard and background-Agent handoffs
// never call TaskCreate, so they are untouched.
//
// This is the one Foreman hook that writes — through roadmap.js's own
// cmdUpdateStatus (same invariants as every other write), guarded to the
// single transition planned -> in_progress, and only for an entry that
// Foreman's own handoff paragraph named. Anything else: silent no-op.
//
// Input schema (verified empirically 2026-07-10 — undocumented in
// hooks.md): common fields + task_id, task_subject, task_description.

const fs = require("fs");
const path = require("path");

const { readEntries, cmdUpdateStatus } = require("../scripts/roadmap");

// The exact phrase the roadmap skill embeds right after scope_discipline.
// Backticks are optional: descriptions are model-authored (paraphrased),
// so a rewrite that drops them must still mechanize. No looser secondary
// pattern (e.g. bare "entry (\d+)") — false-positive risk against
// arbitrary descriptions.
const ENTRY_MARKER_RE = /ROADMAP\.jsonl entry `?(\d+)`?/;

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

function entryIdFromDescription(description) {
  const m = ENTRY_MARKER_RE.exec(String(description || ""));
  return m ? m[1] : null;
}

function main() {
  const data = readInput();
  if (data.hook_event_name && data.hook_event_name !== "TaskCreated") return;

  const id = entryIdFromDescription(data.task_description);
  if (!id) return;

  const root = projectDir(data);
  if (!fs.existsSync(path.join(root, "ROADMAP.jsonl"))) return;

  let entries;
  try {
    entries = readEntries(root);
  } catch {
    return; // corrupt file — never block or complicate task creation
  }
  const entry = entries.find((e) => e.id === id);
  // Only the sanctioned transition: an entry the picking flow left planned.
  // Never regress done/dropped/deferred, never re-touch in_progress.
  if (!entry || entry.status !== "planned") return;

  try {
    cmdUpdateStatus(root, { id, status: "in_progress" });
  } catch {
    // best effort — the embedded prose instruction remains the fallback
  }
}

if (require.main === module) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}

module.exports = { main, entryIdFromDescription, ENTRY_MARKER_RE };
