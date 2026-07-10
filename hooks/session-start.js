#!/usr/bin/env node
"use strict";

// SessionStart — surface dangling in_progress roadmap entries.
//
// A destination session marks an entry in_progress and can die without
// closing it (crash, abandoned clipboard paste, killed agent); nothing else
// ever surfaces that, so the entry silently rots until someone happens to
// run a review. One informational line at session start closes that loop.
// Silent whenever there is nothing to say; never fires for subagents
// (SessionStart is a main-session-only event) or on resume/compact (the
// matcher gates to startup|clear — resumed context already knows).

const fs = require("fs");
const path = require("path");

const { readEntries, today } = require("../scripts/roadmap");

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT
  ? path.resolve(process.env.CLAUDE_PLUGIN_ROOT)
  : path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(PLUGIN_ROOT, "scripts", "roadmap.js");

// An entry untouched this long gets its last-activity date called out.
const STALE_DAYS = 3;

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

function daysBetween(fromYmd, toYmd) {
  const ms = new Date(toYmd) - new Date(fromYmd);
  return Number.isFinite(ms) ? Math.floor(ms / 86400000) : 0;
}

function buildMessage(inProgress, todayStr) {
  const items = inProgress.map((e) => {
    const stale =
      e.updated_at && daysBetween(e.updated_at, todayStr) >= STALE_DAYS
        ? `, no activity since ${e.updated_at}`
        : "";
    return `${e.id} ("${e.title}"${stale})`;
  });
  return (
    `[Foreman] Roadmap entries still in_progress: ${items.join(", ")}. ` +
    "Informational only — don't act on this unless the user asks. If one " +
    "of these actually concluded, it can be closed via " +
    `echo '{"id":"<id>","status":"<done|dropped>","commit":"<sha>","notes":"..."}' | node ${SCRIPT_PATH} update-status ` +
    "(commit first if code changed); /foreman:roadmap offers to resume or review."
  );
}

function main() {
  const data = readInput();
  // The matcher already gates to startup|clear; keep a defensive check so a
  // broader matcher edit can't silently make this fire on every compaction.
  if (data.source && data.source !== "startup" && data.source !== "clear") return;

  const root = projectDir(data);
  if (!fs.existsSync(path.join(root, "ROADMAP.jsonl"))) return;

  let entries;
  try {
    entries = readEntries(root);
  } catch {
    return; // corrupt file — a session-start banner is the wrong place to deal with it
  }
  const inProgress = entries.filter((e) => e.status === "in_progress");
  if (!inProgress.length) return;

  // SessionStart accepts raw stdout as context — no JSON envelope needed.
  try {
    process.stdout.write(buildMessage(inProgress, today()));
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

module.exports = { main, buildMessage, daysBetween, STALE_DAYS };
