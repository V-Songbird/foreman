#!/usr/bin/env node
"use strict";

// SessionStart — surface open roadmap entries (in_progress, and work left
// awaiting_acceptance), plus an archive offer once terminal entries pile up.
//
// A destination session marks an entry in_progress and can die without
// closing it (crash, abandoned clipboard paste, killed agent); nothing else
// ever surfaces that, so the entry silently rots until someone happens to
// run a review. An awaiting_acceptance entry rots the same way for the
// opposite reason — it is finished and nobody has said yes. One
// informational line at session start closes both loops. A second, separate
// line offers the archive flow once done/dropped/rejected entries pile up —
// that flow exists but nothing else ever suggests using it.
// Silent whenever there is nothing to say; never fires for subagents
// (SessionStart is a main-session-only event) or on resume/compact (the
// matcher gates to startup|clear — resumed context already knows).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { readInput, projectDir, pluginDir } = require("./lib");
const crypto = require("crypto");

const { readEntries, today, TERMINAL_STATUSES } = require("../scripts/roadmap");
const { record: recordTrial, startSession: startTrialSession } = require("../scripts/trial-log");

const PLUGIN_ROOT = pluginDir();
const SCRIPT_PATH = path.join(PLUGIN_ROOT, "scripts", "roadmap.js");

// An entry untouched this long gets its last-activity date called out.
const STALE_DAYS = 3;

// razor: fixed ceiling, no config key — add one only once a user asks for it.
const ARCHIVE_OFFER_THRESHOLD = 20;

function daysBetween(fromYmd, toYmd) {
  const ms = new Date(toYmd) - new Date(fromYmd);
  return Number.isFinite(ms) ? Math.floor(ms / 86400000) : 0;
}

// [Foreman: 131] `awaiting_acceptance` entries are surfaced here too, tagged
// so the two never blur: an in_progress entry may have died mid-work, an
// awaiting one is finished and waiting on THIS user. Without them the state
// would be the one open state nothing ever mentions — the opposite of why it
// exists.
function buildMessage(open, todayStr) {
  const items = open.map((e) => {
    const stale =
      e.updated_at && daysBetween(e.updated_at, todayStr) >= STALE_DAYS
        ? `, no activity since ${e.updated_at}`
        : "";
    const waiting = e.status === "awaiting_acceptance" ? ", awaiting your acceptance" : "";
    return `${e.id} ("${e.title}"${waiting}${stale})`;
  });
  return (
    `[Foreman] Roadmap entries still open: ${items.join(", ")}. ` +
    "Informational only — don't act on this unless the user asks. If one " +
    "of these actually concluded, it can be closed via " +
    `echo '{"id":"<id>","status":"<done|dropped>","commit":"<sha>","notes":"..."}' | node "${SCRIPT_PATH}" update-status ` +
    "(commit first if code changed); ask Foreman to resume, accept, or review."
  );
}

// [Foreman: 180] Terminal entries (done/dropped/rejected) never get archived
// on their own — nothing else ever suggests it, so a mature roadmap just
// keeps accumulating them. One offer line, gated on a fixed count, closes
// that loop the same way the open-entries line does.
function buildArchiveOffer(count) {
  return (
    `[Foreman] ${count} finished entries are still in the active roadmap — ` +
    "ask Foreman to archive the done ones to keep reads lean."
  );
}

// [Foreman: 200] Nothing observes whether the user acted on the archive
// offer in chat — a decline or an ignore looks identical to Foreman, so
// without this it re-asks every single session forever once the threshold
// is crossed. A tmpdir state file (same sha1-of-root keying as
// post-commit.js's freshly-done dedup) remembers the last date it fired;
// best-effort both ways: unreadable state means offer again (fail open),
// unwritable state means the dedup just doesn't stick.
function archiveOfferStatePath(root) {
  const safe = crypto.createHash("sha1").update(String(root)).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), `foreman-archiveoffer-${safe}.json`);
}

// razor: fixed ceiling, no config key — add one only once a user asks for it.
const ARCHIVE_OFFER_RENUDGE_DAYS = 7;

function shouldOfferArchive(root, todayStr) {
  const p = archiveOfferStatePath(root);
  let lastDate;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    // An unparseable stored date must fail open the same as a missing file —
    // daysBetween's NaN guard returns 0, and `0 < RENUDGE_DAYS` would
    // otherwise suppress the offer forever without ever rewriting it.
    if (parsed && typeof parsed.date === "string" && Number.isFinite(new Date(parsed.date).getTime())) {
      lastDate = parsed.date;
    }
  } catch {
    // missing or corrupt state — fail open, offer again
  }
  if (lastDate && daysBetween(lastDate, todayStr) < ARCHIVE_OFFER_RENUDGE_DAYS) return false;
  try {
    fs.writeFileSync(p, JSON.stringify({ date: todayStr }));
  } catch {
    // best effort
  }
  return true;
}

function main(data = readInput()) {
  // The matcher already gates to startup|clear; keep a defensive check so a
  // broader matcher edit can't silently make this fire on every compaction.
  if (data.source && data.source !== "startup" && data.source !== "clear") return;

  const root = projectDir(data);
  if (!fs.existsSync(path.join(root, "ROADMAP.jsonl"))) return;

  // [Foreman: 208] Mint this session's trial token and record its start
  // BEFORE any of the silent returns below. This event is the denominator
  // for sessions_since_init, so it must not depend on whether there happened
  // to be an open entry worth mentioning — or on the roadmap being readable.
  // Silent no-op unless the project opted in; never throws.
  startTrialSession({ root });

  let entries;
  try {
    entries = readEntries(root);
  } catch {
    return; // corrupt file — a session-start banner is the wrong place to deal with it
  }
  const open = entries.filter(
    (e) => e.status === "in_progress" || e.status === "awaiting_acceptance"
  );

  // [Foreman: 208] The failure half of resume recovery: an `in_progress`
  // entry that already carries commits or observed files is work that was
  // interrupted and has NOT come back yet. One row per such entry per
  // startup, which is why TRIALS.md calls this a per-day view of recovery
  // rather than a per-run one. The success half is task-completed.js's.
  //
  // `awaiting_acceptance` is deliberately excluded even though it is an open
  // status here and always carries commits: that work HAS come back and is
  // waiting on the user's yes. Counting it would report an un-recovered run
  // on every session start of a project that simply has something to accept.
  for (const entry of open) {
    if (entry.status !== "in_progress") continue;
    const started = (entry.commits || []).length > 0 || (entry.observed_touches || []).length > 0;
    if (started) {
      recordTrial("recovery_attempted", { kind: "resume-in-progress", success: false }, { root });
    }
  }
  const terminalCount = entries.filter((e) => TERMINAL_STATUSES.has(e.status)).length;

  const todayStr = today();
  const parts = [];
  if (open.length) parts.push(buildMessage(open, todayStr));
  if (terminalCount >= ARCHIVE_OFFER_THRESHOLD && shouldOfferArchive(root, todayStr)) {
    parts.push(buildArchiveOffer(terminalCount));
  }
  if (!parts.length) return;

  // SessionStart accepts raw stdout as context — no JSON envelope needed.
  try {
    process.stdout.write(parts.join("\n"));
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

module.exports = {
  main,
  buildMessage,
  buildArchiveOffer,
  daysBetween,
  STALE_DAYS,
  ARCHIVE_OFFER_THRESHOLD,
  archiveOfferStatePath,
  shouldOfferArchive,
  ARCHIVE_OFFER_RENUDGE_DAYS,
};
