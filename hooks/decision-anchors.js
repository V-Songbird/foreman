#!/usr/bin/env node
"use strict";

// PostToolUse — makes decision-log anchors (`[Foreman: 019]` comments, see
// scripts/roadmap.js's anchorIdsIn) active retrieval: touching an anchored
// file surfaces its ADR doc(s) at that exact moment, so the constraint is
// read before it's violated instead of discovered after.
//
// Fires on every Read/Edit/Write regardless of decisionLog.enabled -- once
// an anchor comment exists in a codebase it should stay findable even in a
// project that has since turned the authoring mode off. Only `dir` (default
// docs/foreman) is taken from decision-log-config.
//
// Silence is the overwhelmingly common path (fires on every Read) and must
// be near-free: no anchors, no matching doc file, or an unreadable/missing/
// binary target all produce zero stdout bytes, not just an empty block.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { anchorIdsIn } = require("../scripts/roadmap");
const { readDecisionLog } = require("../scripts/decision-log-config");

const WATCHED_TOOLS = new Set(["Read", "Edit", "Write"]);
const MAX_BYTES = 512 * 1024;

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

// Reads at most the first MAX_BYTES of `filePath`. null on anything that
// isn't a readable regular file (missing, directory, permission-denied) --
// the caller treats null as "exit silently", same bucket as binary/unreadable.
function readCapped(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(MAX_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, MAX_BYTES, 0);
    return buf.toString("utf-8", 0, bytesRead);
  } catch {
    return null; // e.g. EISDIR
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
}

// Relative doc path for display, forward-slash regardless of how `dir` or
// the OS path separator is spelled.
function relDocPath(dir, id) {
  const segs = String(dir).split(/[\\/]+/).filter(Boolean);
  segs.push(`${id}.md`);
  return segs.join("/");
}

function contextMessage(relPaths) {
  return (
    `This file carries decision docs (${relPaths.join(", ")}) -- read them ` +
    "before changing what they govern."
  );
}

// Once-per-session-per-file-per-id-set latch, same shape as task-completed's
// shouldGate: unreadable/missing state means "never emitted yet" (fail open
// toward emitting again), an unwritable state just means the dedupe doesn't
// stick for a later run.
function latchStatePath(root) {
  const safe = crypto.createHash("sha1").update(String(root)).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), `foreman-decisionanchors-${safe}.json`);
}

function shouldEmit(root, key) {
  const p = latchStatePath(root);
  let state = { keys: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (parsed && Array.isArray(parsed.keys)) state = parsed;
  } catch {
    // missing or corrupt state -- treat as never emitted
  }
  if (state.keys.includes(key)) return false;
  try {
    fs.writeFileSync(p, JSON.stringify({ keys: [...state.keys, key] }));
  } catch {
    // best effort -- worst case this emits again next time
  }
  return true;
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
  if (data.hook_event_name && data.hook_event_name !== "PostToolUse") return;
  if (!WATCHED_TOOLS.has(data.tool_name)) return;

  const filePath = data.tool_input && data.tool_input.file_path;
  if (!filePath) return;

  const root = projectDir(data);
  const target = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);

  const content = readCapped(target);
  if (content === null) return;

  const ids = anchorIdsIn(content);
  if (!ids.length) return;

  const { dir } = readDecisionLog(root);
  const keptIds = [];
  const relPaths = [];
  for (const id of ids) {
    let isFile = false;
    try {
      isFile = fs.statSync(path.join(root, dir, `${id}.md`)).isFile();
    } catch {
      // no doc for this id -- stray/unrelated bracket text, never surfaced
    }
    if (isFile) {
      keptIds.push(id);
      relPaths.push(relDocPath(dir, id));
    }
  }
  if (!keptIds.length) return;

  const sortedIds = [...keptIds].sort();
  const sessionId = String(data.session_id || "");
  const latchKey = `${sessionId}:${target}:${sortedIds.join(",")}`;
  if (!shouldEmit(root, latchKey)) return;

  write({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: contextMessage(relPaths),
    },
  });
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
  readCapped,
  relDocPath,
  contextMessage,
  latchStatePath,
  shouldEmit,
  MAX_BYTES,
};
