#!/usr/bin/env node
"use strict";

// [Foreman: 143] The other half of Foreman's product evidence: what using it
// costs in attention, and whether an interrupted run comes back.
//
// PRODUCT-STRATEGY.md ("Attention and cost", "Execution and recovery") asks
// for seven numbers. Three are already in the files Foreman owns — the roadmap
// records what a task predicted and what it actually touched, and the two
// handoff profiles are fixed text on disk. Four are facts about a person being
// set up, questioned, interrupted, or recovering, so they come from the same
// opt-in trial log roadmap-health.js reads (see TRIALS.md), which nothing
// records yet.
//
// This entry DEFINES the measurements, exactly as 142 did. It records nothing:
// no skill, hook, or script calls this file, and it never writes.
//
// Conventions are roadmap-health.js's, deliberately: explicit `--roadmap` (no
// default pointing at anyone's live roadmap), `--archive` autodetected beside
// it, `--date` for a reproducible report, optional `--trial-log`, one JSON
// object on stdout, exports for the tests. Every derived number is computed
// with roadmap.js's and check-prompt.js's own functions — a second
// implementation of touch matching or of the profile floors would eventually
// disagree with the CLI, and a disagreeing report is worse than no report.

const fs = require("fs");
const path = require("path");
const {
  readEntries,
  readArchive,
  readEntriesFrom,
  archivePath,
  today,
  normalizedTouch,
  touchesOverlap,
  TERMINAL_STATUSES,
} = require("../roadmap");
const {
  readCanonical,
  CONCISE_TRUTH_SENTENCE,
  CLOSURE_EVIDENCE_SENTENCE,
  NO_INVENTION_SENTENCE,
  FIX_CEILING_SENTENCE,
} = require("../check-prompt");
const { loadTrialLog, ratio } = require("./roadmap-health");

// The close-time stamp roadmap.js `driftNote` writes into `notes`. Both
// fragments are needed: a close that also had predicted-but-untouched files
// writes them first, so the unpredicted half is not at the start of the line.
const DRIFT_STAMP = "scope drift —";
const UNPREDICTED_MARKER = "touched but unpredicted:";

// How many entries the accuracy metric names as its worst predictions. Ids
// only — a benchmark report is not a place for anyone's file layout.
const WORST_OFFENDERS = 5;

const NO_LOG = "no_trial_log";
const NO_EVENTS = "no_events";

function notesOf(entry) {
  return typeof entry.notes === "string" ? entry.notes : "";
}

// normalizedTouch first so a duplicate that differs only by separator, case,
// `./` prefix, or trailing slash counts once. touchesOverlap normalizes again
// internally; doing it here is about the deduplication, not the comparison.
function touchSet(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const value = normalizedTouch(raw);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function closedEntries(entries, archived) {
  return [...entries, ...archived].filter(
    (entry) => entry && entry.id && TERMINAL_STATUSES.has(entry.status)
  );
}

// planned vs observed for one closed entry, or null when the pair is
// incomplete. Both halves are needed: an entry that predicted nothing has no
// prediction to score, and one that recorded nothing observed was closed
// without commit evidence, which is a different metric's problem.
function scoreEntry(entry) {
  const planned = touchSet(entry.planned_touches);
  const observed = touchSet(entry.observed_touches);
  if (!planned.length || !observed.length) {
    return {
      id: entry.id,
      skipped: !planned.length && !observed.length
        ? "no_planned_or_observed_touches"
        : !planned.length
          ? "no_planned_touches"
          : "no_observed_touches",
    };
  }
  const unpredicted = observed.filter((o) => !planned.some((p) => touchesOverlap(p, o)));
  const untouched = planned.filter((p) => !observed.some((o) => touchesOverlap(p, o)));
  return {
    id: entry.id,
    planned: planned.length,
    observed: observed.length,
    unpredicted: unpredicted.length,
    // Precision: of what the task actually changed, how much it had predicted.
    // Recall: of what it predicted, how much it actually reached.
    precision: ratio(observed.length - unpredicted.length, observed.length),
    recall: ratio(planned.length - untouched.length, planned.length),
  };
}

function mean(values) {
  return values.length
    ? ratio(values.reduce((sum, value) => sum + value, 0), values.length)
    : null;
}

/**
 * Task-to-commit accuracy: how well each closed entry's `planned_touches`
 * predicted its `observed_touches`, matched with the CLI's own prefix-aware
 * rule so `src/auth` scores as a hit for `src/auth/middleware.ts`.
 */
function accuracyMetric(scored) {
  const usable = scored.filter((s) => !s.skipped);
  const skipped = scored.filter((s) => s.skipped);
  const reasons = {};
  for (const entry of skipped) reasons[entry.skipped] = (reasons[entry.skipped] || 0) + 1;
  // Only entries that actually mispredicted something: a roadmap where every
  // prediction held has no worst offenders, and saying otherwise would name
  // ids for a failure that did not happen.
  const worst = usable
    .filter((s) => s.precision < 1 || s.recall < 1)
    .sort((a, b) => a.precision + a.recall - (b.precision + b.recall) || (a.id < b.id ? -1 : 1))
    .slice(0, WORST_OFFENDERS)
    .map((s) => s.id);
  return {
    entries: usable.length,
    mean_precision: mean(usable.map((s) => s.precision)),
    mean_recall: mean(usable.map((s) => s.recall)),
    worst_offenders: worst,
    skipped: { count: skipped.length, reasons },
  };
}

// The files the CLI itself named as unpredicted at close time, parsed back out
// of the note it stamped. Returns null when this entry carries no such note.
function notedUnpredicted(entry) {
  const files = new Set();
  let stamped = false;
  for (const line of notesOf(entry).split("\n")) {
    if (!line.includes(DRIFT_STAMP) || !line.includes(UNPREDICTED_MARKER)) continue;
    stamped = true;
    const tail = line.slice(line.indexOf(UNPREDICTED_MARKER) + UNPREDICTED_MARKER.length);
    for (const raw of tail.split(";")[0].split(",")) {
      const value = normalizedTouch(raw);
      if (value) files.add(value);
    }
  }
  return stamped ? files.size : null;
}

/**
 * Dirty-file capture: observed minus planned, per closed entry and in
 * aggregate. Corroborated against the CLI's own close-time note where one
 * exists — the note was computed against the prediction as it stood at close,
 * with roadmap.js's one-directional `coversPath`, so a disagreement means the
 * entry was corrected afterwards (or a path shape only `normalizedTouch`
 * reconciles). Both numbers are reported instead of one being trusted.
 */
function dirtyCaptureMetric(scored, closed) {
  const usable = scored.filter((s) => !s.skipped);
  const observed = usable.reduce((sum, s) => sum + s.observed, 0);
  const unpredicted = usable.reduce((sum, s) => sum + s.unpredicted, 0);
  const byId = new Map(usable.map((s) => [s.id, s]));
  const disagreeing = [];
  let notes = 0;
  for (const entry of closed) {
    const noted = notedUnpredicted(entry);
    if (noted === null) continue;
    notes += 1;
    const score = byId.get(entry.id);
    if (!score || score.unpredicted !== noted) disagreeing.push(entry.id);
  }
  return {
    rate: ratio(unpredicted, observed),
    unpredicted_files: unpredicted,
    observed_files: observed,
    entries_with_unpredicted: {
      count: usable.filter((s) => s.unpredicted > 0).length,
      ids: usable.filter((s) => s.unpredicted > 0).map((s) => s.id).sort(),
    },
    drift_notes: { stamped: notes, disagreeing_ids: disagreeing.sort(), marker: UNPREDICTED_MARKER },
  };
}

function words(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Prompt overhead: the fixed guardrail text each handoff profile is required
 * to carry, read out of prompt-template.md through check-prompt.js's own
 * exports so the floors cannot drift from the gate that enforces them.
 *
 * Only text check-prompt compares verbatim is counted. Per-task content
 * (`task_context`, `relevant_files`, `task_rules`) is the same job described
 * the same way in either profile, so it cancels out of the ratio rather than
 * inflating both sides.
 *
 * razor: `tone` and `output_format` are required present in a reinforced
 * handoff but their text is per-task, and the template's defaults sit behind
 * bracketed instruction lines that never reach an assembled prompt — counting
 * them would measure the template's prose, not the handoff's. If those blocks
 * ever become fixed text, add them to `reinforced` below; nothing else changes.
 */
function promptOverhead() {
  const canonical = readCanonical();
  // CLOSURE_EVIDENCE_SENTENCE is deliberately absent from `reinforced`: it
  // rides inside the fixed closing paragraph there, and counting it again
  // would charge the long profile twice for one rule.
  const floors = {
    standard: [
      ["concise_truth_line", CONCISE_TRUTH_SENTENCE],
      ["closure_evidence_line", CLOSURE_EVIDENCE_SENTENCE],
    ],
    reinforced: [
      ["truth_grounding", canonical.truthGrounding],
      ["scope_discipline", canonical.scopeDiscipline],
      ["plan", canonical.plan],
      ["closing_paragraph", canonical.closing],
      ["no_invention_line", NO_INVENTION_SENTENCE],
      ["fix_ceiling_line", FIX_CEILING_SENTENCE],
    ],
  };
  const measured = {};
  for (const [profile, blocks] of Object.entries(floors)) {
    measured[profile] = {
      required_blocks: blocks.length,
      fixed_words: blocks.reduce((sum, [, text]) => sum + words(text), 0),
      blocks: blocks.map(([name]) => name),
    };
  }
  return {
    ...measured,
    word_ratio: ratio(measured.standard.fixed_words, measured.reinforced.fixed_words),
    words_saved: measured.reinforced.fixed_words - measured.standard.fixed_words,
    scope: "fixed guardrail text only — per-task blocks are identical across profiles and cancel out",
  };
}

/**
 * A weak, clearly-labeled stand-in for recovery success while no trial runs:
 * open entries that already have committed work behind them. That is exactly
 * prompt-template.md's mechanical `resumed` signal, and it counts runs that
 * were interrupted — never whether any of them came back, which is the metric.
 */
function interruptedRunProxy(entries) {
  const ids = entries
    .filter((entry) => entry.status === "in_progress")
    .filter(
      (entry) =>
        (Array.isArray(entry.commits) && entry.commits.length > 0) ||
        touchSet(entry.observed_touches).length > 0
    )
    .map((entry) => entry.id)
    .sort();
  return {
    label: "proxy",
    measures: "runs that were interrupted, not recoveries that succeeded",
    interrupted_runs_open: ids.length,
    ids,
  };
}

/** Every metric derivable from the roadmap, its archive, and Foreman's own template. */
function fileMetrics(entries, archived) {
  const closed = closedEntries(entries, archived);
  const scored = closed.map(scoreEntry);
  return {
    task_to_commit_accuracy: accuracyMetric(scored),
    dirty_file_capture: dirtyCaptureMetric(scored, closed),
    prompt_overhead: promptOverhead(),
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : ratio(sorted[mid - 1] + sorted[mid], 2);
}

function tally(events, field) {
  const out = {};
  for (const event of events) {
    const key = typeof event[field] === "string" && event[field] ? event[field] : "unspecified";
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function numbers(events, field) {
  return events.map((e) => e[field]).filter((v) => typeof v === "number" && Number.isFinite(v));
}

const NO_LOG_METRICS = {
  setup_to_first_task: { seconds_median: null, reason: NO_LOG },
  questions_per_task: { per_task: null, reason: NO_LOG },
  commit_interruptions: { per_task: null, reason: NO_LOG },
  recovery_success: { rate: null, reason: NO_LOG },
};

/**
 * The four usage-dependent metrics, over a trial log in TRIALS.md's format.
 * `log` is null when no --trial-log was given: they are reported null with a
 * reason, never as zero.
 *
 * The per-task denominator is 142's own decision count (`pick_accepted` +
 * `pick_overridden`) — a task taken. Nothing in the log marks a task
 * finished, so the denominator is stated in the output rather than implied.
 */
function trialMetrics(log) {
  if (!log) return JSON.parse(JSON.stringify(NO_LOG_METRICS));
  const of = (name) => log.events.filter((e) => e.event === name);
  const decisions = of("pick_accepted").length + of("pick_overridden").length;
  const denominator = "pick_accepted + pick_overridden";
  const perTask = (events, extra) =>
    events.length === 0
      ? { per_task: null, reason: NO_EVENTS, ...extra }
      : decisions
        ? { per_task: ratio(events.length, decisions), decisions, denominator, ...extra }
        : { per_task: null, reason: "no_decisions", denominator, ...extra };

  const firstPicks = of("first_pick");
  const seconds = numbers(firstPicks, "seconds_since_init");
  const sessions = numbers(firstPicks, "sessions_since_init");
  const questions = of("question_asked");
  const interruptions = of("commit_interrupted");
  const recoveries = of("recovery_attempted");
  const succeeded = recoveries.filter((e) => e.success === true).length;
  const byKind = {};
  for (const event of recoveries) {
    const kind = typeof event.kind === "string" && event.kind ? event.kind : "unspecified";
    byKind[kind] = byKind[kind] || { attempts: 0, succeeded: 0 };
    byKind[kind].attempts += 1;
    if (event.success === true) byKind[kind].succeeded += 1;
  }

  return {
    setup_to_first_task: firstPicks.length
      ? {
          // A first pick in a later session than the init carries no seconds,
          // so the two shapes are reported side by side instead of one being
          // converted into the other.
          seconds_median: median(seconds),
          seconds_samples: seconds.length,
          sessions_median: median(sessions),
          sessions_samples: sessions.length,
          initializations: of("init_completed").length,
        }
      : { seconds_median: null, reason: NO_EVENTS, initializations: of("init_completed").length },
    questions_per_task: perTask(questions, { questions: questions.length, by_flow: tally(questions, "flow") }),
    commit_interruptions: perTask(interruptions, {
      interruptions: interruptions.length,
      by_reason: tally(interruptions, "reason_class"),
      by_hook: tally(interruptions, "hook"),
    }),
    recovery_success: recoveries.length
      ? { rate: ratio(succeeded, recoveries.length), attempts: recoveries.length, succeeded, by_kind: byKind }
      : { rate: null, reason: NO_EVENTS },
  };
}

function attentionCost(root, options = {}) {
  const date = options.date || today();
  const entries = readEntries(root);
  const archived = options.archive ? readEntriesFrom(options.archive, options.archive) : readArchive(root);
  const log = options.trialLog ? loadTrialLog(options.trialLog) : null;
  const trial = trialMetrics(log);
  const notes = [
    "defines measurements only — nothing in skills/ or hooks/ records any of this",
    "no metric here has a time window: --date is recorded so a report files next to a roadmap-health run for the same day",
    "accuracy and dirty-file capture cover closed entries carrying BOTH planned_touches and observed_touches; the rest are counted in skipped",
    "recovery_success.proxy counts interrupted runs, not successful recoveries — it is not the metric",
  ];
  if (log && log.malformed) notes.push(`${log.malformed} trial-log line(s) were unreadable and skipped`);
  return {
    generated_for_date: date,
    metrics: {
      ...fileMetrics(entries, archived),
      ...trial,
      recovery_success: { ...trial.recovery_success, proxy: interruptedRunProxy(entries) },
    },
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
      "usage: attention-cost.js --roadmap <ROADMAP.jsonl> [--archive <archive.jsonl>] "
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
  const result = attentionCost(root, { date, archive, trialLog });
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
  DRIFT_STAMP,
  UNPREDICTED_MARKER,
  WORST_OFFENDERS,
  touchSet,
  closedEntries,
  scoreEntry,
  notedUnpredicted,
  promptOverhead,
  interruptedRunProxy,
  fileMetrics,
  trialMetrics,
  attentionCost,
};
