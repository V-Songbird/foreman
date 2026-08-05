#!/usr/bin/env node
"use strict";

// [Foreman: 208] The writer for the opt-in project trial log.
//
// benchmarks/health/TRIALS.md defines the log: what may be recorded, the
// closed vocabulary, and the privacy rules. Until now nothing wrote one, so
// roadmap-health.js and attention-cost.js reported every usage-dependent rate
// as null with reason "no_trial_log". This is the write half.
//
// Two rules shape every line of this file:
//
// 1. **Opt-in and silent.** Nothing is recorded unless the project's
//    .foreman/config.json sets `trialLog: true`. Off is the default and off
//    means the writer does nothing at all — no file created, no directory
//    made, no error.
// 2. **A trial must never be able to break the work.** Every entry point is
//    wrapped: a full disk, a read-only .foreman, a corrupt config, a bad
//    event — none of them may propagate into the roadmap write or the hook
//    that called us. `record()` returns a small result object; it never
//    throws.
//
// The vocabulary check is a real trust boundary, not a formality: the callers
// include hooks and scripts driven by a model, and TRIALS.md's privacy
// guarantee is only worth anything if a free-text value cannot reach the file
// by mistake. Anything not on the list below is refused and nothing is
// written.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readConfigFile } = require("./foreman-config");

const FOREMAN_DIR = ".foreman";
const LOG_FILE = "trial-log.jsonl";
// The per-session token lives beside the log rather than in it: every writer
// is its own short-lived process, so the token has to outlive the process
// that minted it. See mintedSession() for what this deliberately does NOT
// do.
const SESSION_FILE = "trial-session";

// ---- the closed vocabulary, TRIALS.md "Event records", verbatim.
//
// `fields` maps each extra field to its check. A field marked optional is
// absent-or-valid; everything else is required. No event accepts a field
// that is not listed here — an unknown key is a refusal, not a passthrough,
// because a passthrough is exactly how a title or a path would get in.

const int = (v) => Number.isInteger(v) && v >= 0;
const bool = (v) => typeof v === "boolean";
const intOrNull = (v) => v === null || int(v);
const oneOf = (...names) => {
  const set = new Set(names);
  return (v) => typeof v === "string" && set.has(v);
};

const FLOWS = ["init", "pick", "add", "correct", "status", "survey"];
const HOOKS = ["safe-commit", "post-commit", "task-completed"];
// The five refusal names scripts/safe-commit.js already returns, plus the
// requireVerification hold. Names only: never a count of dirty files, never
// which files were unexpected. safe-commit's own `reason` string is prose
// about the user's working tree and is deliberately not what this records.
const REASON_CLASSES = [
  "dirty_tree",
  "head_moved_since_baseline",
  "no_task_changes",
  "unexpected_files",
  "staging_incomplete",
  // TRIALS.md's rule is "the refusal names scripts/safe-commit.js already
  // returns"; its enumeration missed these two, and dropping them would make
  // the metric a floor for no reason.
  "staging_failed",
  "post_commit_attestation_failed",
  "verification_declined",
];
const RECOVERY_KINDS = ["reinit-snapshot", "resume-in-progress", "failed-verification-retry"];

const EVENTS = {
  menu_shown: { candidates: int, hint: bool },
  pick_accepted: { rank: int },
  pick_overridden: { chosen_rank: intOrNull },
  hint_used: { hit: bool },
  session_start: {},
  init_started: {},
  init_completed: { tasks: int },
  first_pick: { seconds_since_init: intOrNull, sessions_since_init: intOrNull },
  question_asked: { flow: oneOf(...FLOWS) },
  commit_interrupted: { hook: oneOf(...HOOKS), reason_class: oneOf(...REASON_CLASSES) },
  recovery_attempted: { kind: oneOf(...RECOVERY_KINDS), success: bool },
};

function projectDir() {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

function foremanDir(root) {
  return path.join(root, FOREMAN_DIR);
}

function logPath(root) {
  return path.join(foremanDir(root), LOG_FILE);
}

// Date only. TRIALS.md: "the day is enough resolution for a rate, and a
// timestamp is one more identifying signal". Local date, never toISOString —
// same rule as roadmap.js's today().
function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * True only when the project has explicitly opted in. A missing file, a
 * corrupt file, and a file without the key all read as off — the one
 * direction a bug here is allowed to fail in.
 */
function enabled(root) {
  return readConfigFile(root).config.trialLog === true;
}

/**
 * The opaque per-session token. Minted with crypto.randomBytes and cached in
 * .foreman/trial-session, so it is derived from nothing: not the project
 * path, not the user, not a session id, not any roadmap id. It identifies
 * nothing outside this log.
 *
 * razor: two Foreman sessions running in one project at the same time share
 * whichever token was written last, so their rows pair as one session. That
 * costs pairing accuracy, never privacy, and the fix (a real per-process
 * session identity) needs a harness-supplied value no script receives today.
 */
function sessionToken(root, { renew = false } = {}) {
  const file = path.join(foremanDir(root), SESSION_FILE);
  if (!renew) {
    try {
      const existing = fs.readFileSync(file, "utf-8").trim();
      if (/^[0-9a-f]{12}$/.test(existing)) return existing;
    } catch {
      // fall through and mint
    }
  }
  const token = crypto.randomBytes(6).toString("hex");
  fs.mkdirSync(foremanDir(root), { recursive: true });
  fs.writeFileSync(file, `${token}\n`);
  return token;
}

/**
 * Validate one event against the closed vocabulary. Returns an error string,
 * or null when the event is legal. Unknown keys are an error on purpose:
 * silently dropping one would let a caller believe it recorded something it
 * did not, and passing one through would defeat the privacy guarantee.
 */
function validate(event, fields) {
  const spec = EVENTS[event];
  if (!spec) return `unknown event ${JSON.stringify(event)}`;
  for (const [key, check] of Object.entries(spec)) {
    if (!(key in fields)) return `${event} requires ${key}`;
    if (!check(fields[key])) return `${event}.${key} is not a legal value: ${JSON.stringify(fields[key])}`;
  }
  for (const key of Object.keys(fields)) {
    if (!(key in spec)) return `${event} does not record ${key} — the vocabulary is closed`;
  }
  return null;
}

/**
 * Append one event. Never throws.
 *
 * Returns {recorded: true, line} when it wrote, {recorded: false, reason}
 * otherwise — "disabled" when the project has not opted in, "invalid" with
 * an `error` when the event failed the vocabulary check, "write_failed" when
 * the filesystem refused. Callers may ignore all of it; the return exists so
 * the tests can see which happened.
 */
function record(event, fields = {}, options = {}) {
  const root = options.root || projectDir();
  try {
    if (!enabled(root)) return { recorded: false, reason: "disabled" };
    const error = validate(event, fields);
    if (error) return { recorded: false, reason: "invalid", error };
    const line = { event, ts: today(), session: sessionToken(root), ...fields };
    fs.mkdirSync(foremanDir(root), { recursive: true });
    fs.appendFileSync(logPath(root), `${JSON.stringify(line)}\n`);
    return { recorded: true, line };
  } catch (err) {
    // A trial is an observation of the work. It must never become a way for
    // the work to fail.
    return { recorded: false, reason: "write_failed", error: err.message };
  }
}

/**
 * Every readable line already in this project's log, oldest first. Malformed
 * lines are skipped rather than counted — the counting reader that reports
 * them is benchmarks/health/roadmap-health.js's loadTrialLog; this one exists
 * only so a writer can ask what it already wrote.
 */
function readEvents(root) {
  try {
    return fs
      .readFileSync(logPath(root), "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((event) => event && typeof event.event === "string");
  } catch {
    return [];
  }
}

/**
 * Record `first_pick` if and only if this project's log holds none yet — a
 * project has exactly one first delivered handoff, ever.
 *
 * `sessions_since_init` counts `session_start` rows logged after the most
 * recent `init_completed`, which is a pure event count and needs no clock.
 *
 * `seconds_since_init` is always null here, and that is not a placeholder.
 * TRIALS.md records dates only, deliberately — "a timestamp is one more
 * identifying signal" — so an elapsed time cannot be derived from the log.
 * It would have to be measured inside the one process that saw both ends,
 * and no process sees both: init is a skill flow, delivery is this script.
 * Reporting null is the honest answer, and attention-cost.js already treats
 * a null as "this pick crossed a boundary the number cannot describe".
 */
function recordFirstPick(options = {}) {
  const root = options.root || projectDir();
  try {
    if (!enabled(root)) return { recorded: false, reason: "disabled" };
    const events = readEvents(root);
    if (events.some((e) => e.event === "first_pick")) {
      return { recorded: false, reason: "already_recorded" };
    }
    const lastInit = events.map((e) => e.event).lastIndexOf("init_completed");
    const sessions =
      lastInit === -1
        ? null
        : events.slice(lastInit).filter((e) => e.event === "session_start").length;
    return record("first_pick", { seconds_since_init: null, sessions_since_init: sessions }, { root });
  } catch (err) {
    return { recorded: false, reason: "write_failed", error: err.message };
  }
}

/**
 * The success half of resume recovery, recorded when a task closes.
 *
 * The honest problem TRIALS.md already names: pairing a recovery to the run
 * it recovered "would need an entry identifier in the log, and no
 * privacy-safe version of that is worth the number". So this does not pair
 * by identity — it pairs by ALTERNATION, which the log's own order already
 * carries. A success is recorded only when the most recent
 * resume-in-progress row is a failure, and writing the success makes the
 * most recent row a success, so the next close is refused until a session
 * start observes still-un-recovered work and writes another failure.
 *
 * Consuming the failure is the whole point. A rule that merely asked
 * "does any failure exist" would turn every later close on the project —
 * including tasks that ran start to finish and were never interrupted — into
 * a recorded recovery, permanently, from the first interruption onward.
 * Session start writes one failure per still-open interrupted entry, so a
 * project with three of them and one close reports one success against four
 * attempts: the per-day view of recovery TRIALS.md describes, not a per-run
 * one.
 */
function recordResumeRecovered(options = {}) {
  const root = options.root || projectDir();
  try {
    if (!enabled(root)) return { recorded: false, reason: "disabled" };
    const resumes = readEvents(root).filter(
      (e) => e.event === "recovery_attempted" && e.kind === "resume-in-progress"
    );
    const last = resumes[resumes.length - 1];
    if (!last || last.success !== false) {
      return { recorded: false, reason: "no_unrecovered_interruption" };
    }
    return record("recovery_attempted", { kind: "resume-in-progress", success: true }, { root });
  } catch (err) {
    return { recorded: false, reason: "write_failed", error: err.message };
  }
}

/**
 * Start a new session's rows. Mints a fresh token so the previous session's
 * rows do not pair with this one's, then records `session_start`. Called by
 * hooks/session-start.js and nowhere else.
 */
function startSession(options = {}) {
  const root = options.root || projectDir();
  try {
    if (!enabled(root)) return { recorded: false, reason: "disabled" };
    sessionToken(root, { renew: true });
  } catch (err) {
    return { recorded: false, reason: "write_failed", error: err.message };
  }
  return record("session_start", {}, { root });
}

function main() {
  const [event, ...rest] = process.argv.slice(2);
  if (!event || event === "--help") {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        usage:
          "trial-log.js <event> ['<json fields>'] — append one event to .foreman/trial-log.jsonl. "
          + "Silent no-op unless .foreman/config.json sets trialLog: true. "
          + `Events: ${Object.keys(EVENTS).join(", ")}.`,
      })
    );
    return;
  }
  let fields = {};
  if (rest[0]) fields = JSON.parse(rest[0]);
  const result = record(event, fields);
  process.stdout.write(JSON.stringify({ ok: result.recorded !== false || result.reason === "disabled", ...result }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}

module.exports = {
  EVENTS,
  FLOWS,
  HOOKS,
  REASON_CLASSES,
  RECOVERY_KINDS,
  LOG_FILE,
  SESSION_FILE,
  enabled,
  logPath,
  readEvents,
  record,
  recordFirstPick,
  recordResumeRecovered,
  startSession,
  sessionToken,
  validate,
};
