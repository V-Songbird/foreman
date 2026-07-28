#!/usr/bin/env node
"use strict";

// [Foreman: 142] The mechanical half of Foreman's product evidence.
//
// PRODUCT-STRATEGY.md ("Product evidence required") asks for nine numbers
// across recommendation quality and roadmap health. Six of them are already
// in the files Foreman owns; three need a user actually choosing, so they
// come from a trial log (see TRIALS.md) that nothing records yet.
//
// This entry DEFINES the measurements. It records nothing: no skill, hook, or
// script calls this file, and it never writes. Acting on the numbers is later
// work.
//
// Conventions are picks/ranking-replay.js's: plain script, explicit
// `--roadmap` (no default pointing at anyone's live roadmap), one JSON object
// on stdout, exports for the tests. Every derived number comes from
// roadmap.js / roadmap-doctor.js rather than a second implementation here —
// a health report that disagreed with `doctor` would be worse than no report.

const fs = require("fs");
const path = require("path");
const {
  readEntries,
  readArchive,
  readEntriesFrom,
  archivePath,
  today,
  TERMINAL_STATUSES,
} = require("../../scripts/roadmap");
const { validateEntries, validateAcrossFiles } = require("../../scripts/roadmap-doctor");

// "more than 30 days before today" — the same threshold the roadmap skill's
// staleness signal and the handoff profile check already use.
const STALE_DAYS = 30;

// The two note stamps that survive as machine-readable traces. `survey
// (unconfirmed): ` is written by foreman:survey for a finding it could not
// ground; the reassignment line is written by roadmap.js reassign-id. An
// APPLIED correction leaves no trace at all — `correct` rewrites the fields
// in place and stamps nothing — so that half is reported as not_derivable
// rather than guessed at.
const SURVEY_MARKER = "survey (unconfirmed):";
const REASSIGN_MARKER = "id reassigned from ";

const DAY_MS = 86400000;

function daysBetween(fromYmd, toYmd) {
  const ms = new Date(toYmd) - new Date(fromYmd);
  return Number.isFinite(ms) ? Math.floor(ms / DAY_MS) : 0;
}

function isOpen(entry) {
  return !TERMINAL_STATUSES.has(entry.status);
}

function notesOf(entry) {
  return typeof entry.notes === "string" ? entry.notes : "";
}

function idsFrom(findings, codes, keep = () => true) {
  const ids = new Set();
  for (const found of findings) {
    if (!codes.has(found.code)) continue;
    for (const id of found.ids || []) if (keep(id)) ids.add(id);
  }
  return [...ids].sort();
}

const STRANDED_CODES = new Set(["stranded_dependency", "missing_dependency"]);
const UNREPAIRED_CODES = new Set(["duplicate_id", "duplicate_across_files"]);

/**
 * Every metric derivable from the two files alone.
 * `date` is the run date (YYYY-MM-DD) the staleness window is measured
 * against — passed explicitly so a report is reproducible.
 */
function fileMetrics(entries, archived, date) {
  const byId = new Map(archived.filter((e) => e && e.id).map((e) => [e.id, e]));
  // An active entry may legitimately depend on an archived (usually done)
  // parent, so the archive answers ids the active file cannot — otherwise
  // every archived parent would read as a stranded dependency.
  const resolve = (id) => byId.get(id) || null;
  const findings = [
    ...validateEntries(entries, { resolve }),
    ...validateAcrossFiles(entries, archived),
  ];
  const open = new Set(entries.filter(isOpen).map((e) => e.id));

  const stale = entries
    .filter((e) => isOpen(e) && e.updated_at && daysBetween(e.updated_at, date) > STALE_DAYS)
    .map((e) => e.id)
    .sort();

  const breadcrumbs = entries.filter((e) => notesOf(e).includes(SURVEY_MARKER)).map((e) => e.id).sort();

  const duplicatePairs = findings
    .filter((f) => f.code === "similar_titles")
    .map((f) => ({ a: f.ids[0], b: f.ids[1] }));

  const repaired = [...entries, ...archived]
    .filter((e) => notesOf(e).includes(REASSIGN_MARKER))
    .map((e) => e.id)
    .sort();

  const perMonth = {};
  for (const entry of archived) {
    const month = typeof entry.updated_at === "string" ? entry.updated_at.slice(0, 7) : "";
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    perMonth[month] = (perMonth[month] || 0) + 1;
  }

  return {
    stale_entries: { count: stale.length, ids: stale, threshold_days: STALE_DAYS },
    corrections: {
      count: breadcrumbs.length,
      ids: breadcrumbs,
      marker: SURVEY_MARKER,
      // `correct` rewrites title/why/what/kind/planned_touches in place and
      // writes no note, so the count of applied corrections exists only in
      // git history. Reported as absent rather than approximated by the
      // breadcrumb count, which measures something else entirely.
      applied: { count: null, reason: "not_derivable" },
    },
    stranded_dependencies: {
      count: idsFrom(findings, STRANDED_CODES, (id) => open.has(id)).length,
      ids: idsFrom(findings, STRANDED_CODES, (id) => open.has(id)),
    },
    duplicates: { count: duplicatePairs.length, pairs: duplicatePairs },
    archive_growth: {
      active: entries.length,
      archived: archived.length,
      archived_per_month: perMonth,
    },
    merge_repair: {
      repaired: repaired.length,
      ids: repaired,
      outstanding: idsFrom(findings, UNREPAIRED_CODES).length,
    },
  };
}

function loadTrialLog(file) {
  const events = [];
  let malformed = 0;
  for (const raw of fs.readFileSync(file, "utf-8").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      // An append-only log can end mid-line after a crash. One unreadable
      // line must not lose the rest of the trial — it is counted instead.
      malformed += 1;
      continue;
    }
    if (!obj || typeof obj !== "object" || typeof obj.event !== "string") malformed += 1;
    else events.push(obj);
  }
  return { events, malformed };
}

function ratio(hits, total) {
  return total ? Math.round((hits / total) * 10000) / 10000 : null;
}

const NO_LOG = { rate: null, reason: "no_trial_log" };

/**
 * The three usage-dependent rates, over a trial log in TRIALS.md's format.
 * `log` is null when no --trial-log was given: the rates are reported as
 * null with a reason, never as zero.
 */
function trialMetrics(log) {
  if (!log) {
    return {
      recommendation_acceptance: { ...NO_LOG },
      override_rate: { ...NO_LOG },
      hint_success: { ...NO_LOG },
    };
  }
  const count = (name) => log.events.filter((e) => e.event === name).length;
  const accepted = count("pick_accepted");
  const overridden = count("pick_overridden");
  const decisions = accepted + overridden;
  const hints = log.events.filter((e) => e.event === "hint_used");
  const hits = hints.filter((e) => e.hit === true).length;
  // Acceptance and override are computed from their own event counts rather
  // than as 1 - each other: a log where they do not sum to 1 is a log with
  // dropped events, and that has to stay visible.
  const decided = (hits_, extra) =>
    decisions ? { rate: ratio(hits_, decisions), decisions, ...extra } : { rate: null, reason: "no_events" };
  return {
    recommendation_acceptance: {
      ...decided(accepted, { accepted }),
      menus_shown: count("menu_shown"),
    },
    override_rate: decided(overridden, { overridden }),
    hint_success: hints.length
      ? { rate: ratio(hits, hints.length), hints: hints.length, hits }
      : { rate: null, reason: "no_events" },
  };
}

function health(root, options = {}) {
  const date = options.date || today();
  const entries = readEntries(root);
  const archived = options.archive ? readEntriesFrom(options.archive, options.archive) : readArchive(root);
  const log = options.trialLog ? loadTrialLog(options.trialLog) : null;
  const notes = [
    "defines measurements only — nothing in skills/ or hooks/ records any of this",
    "archived_per_month buckets each archived entry by its last updated_at: archiving stamps no date of its own",
    "corrections.applied needs git history — `correct` rewrites fields in place and writes no note",
  ];
  if (log && log.malformed) notes.push(`${log.malformed} trial-log line(s) were unreadable and skipped`);
  return {
    generated_for_date: date,
    metrics: { ...fileMetrics(entries, archived, date), ...trialMetrics(log) },
    notes,
  };
}

function flag(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function resolveExisting(value, label) {
  const absolute = path.resolve(value);
  if (!fs.existsSync(absolute)) throw new Error(`${label} not found: ${absolute}`);
  return absolute;
}

function main() {
  const argv = process.argv.slice(2);
  const roadmap = flag(argv, "roadmap");
  if (!roadmap) {
    throw new Error(
      "usage: roadmap-health.js --roadmap <ROADMAP.jsonl> [--archive <archive.jsonl>] "
        + "[--date YYYY-MM-DD] [--trial-log <trial-log.jsonl>]"
    );
  }
  const absolute = resolveExisting(roadmap, "roadmap");
  const root = path.dirname(absolute);
  const archiveFlag = flag(argv, "archive");
  const trialFlag = flag(argv, "trial-log");
  const date = flag(argv, "date");
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`--date must be YYYY-MM-DD, got ${JSON.stringify(date)}`);
  }
  const archive = archiveFlag ? resolveExisting(archiveFlag, "archive") : undefined;
  const trialLog = trialFlag ? resolveExisting(trialFlag, "trial log") : undefined;
  const result = health(root, { date, archive, trialLog });
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        roadmap: absolute,
        archive: archive || (fs.existsSync(archivePath(root)) ? archivePath(root) : null),
        ...result,
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }
}

module.exports = {
  STALE_DAYS,
  SURVEY_MARKER,
  REASSIGN_MARKER,
  daysBetween,
  fileMetrics,
  loadTrialLog,
  trialMetrics,
  health,
};
