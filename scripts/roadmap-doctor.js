"use strict";

// The whole structural contract for ROADMAP.jsonl and .foreman/config.json,
// in one place, with two consumers: `roadmap.js doctor` reports (and, with
// --fix, mechanically repairs) what it finds, and roadmap.js's writeEntries
// refuses any mutation whose resulting file would carry a structural error.
// One definition on purpose -- a doctor that checked more than the write
// path enforced is exactly how a file drifts into a shape the CLI can no
// longer parse, rank, or repair.
//
// Severity rule, applied throughout: **error** when a consumer would break
// or have to guess (unknown status, duplicate id, dangling dependency,
// cycle); **warning** when the value is mechanically recoverable, already
// defaulted by every reader, or merely suspicious (a missing
// `planned_touches` array, an unrecognized `source`, two entries that read
// alike). Historical
// entries predate later fields and later rules; they must stay writable, so
// anything a real roadmap legitimately contains is a warning at most.
//
// `repairable: true` marks the findings whose fix is mechanical and has
// exactly one possible outcome. Everything else is reported and left for
// the caller (the skill layer asks the user; these scripts never prompt).

const fs = require("fs");
const path = require("path");
const { isValidDir } = require("./ledger-config");
// The only gate left in the config: hooks/task-completed.js's own, parsed
// inline there. One line here beats a module whose only export it is.
const VALID_GATES = new Set(["off", "block"]);
// [Foreman: 134] The one reading of `commits[]`, shared with every status view.
// [Foreman: 135] trailerShasFor answers "which commits already say Foreman:
// <id>" for a duplicate finding -- fail-soft, and only ever called when a
// duplicate is actually present.
const { recordedCommits, trailerShasFor } = require("./commit-evidence");
const { configPath, OMITTABLE_TAGS } = require("./render-sections");
// ledger.js requires nothing from this module, so there is no cycle to
// defer around -- unlike roadmap.js below.
const ledger = require("./ledger");

// roadmap.js requires this module at load time, so requiring it back up here
// would capture a half-built exports object. Node's module cache makes the
// deferred call a map lookup.
function roadmap() {
  return require("./roadmap");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// The id shape lives in roadmap.js (ID_RE/isValidId) and is read through the
// deferred require below -- the same one definition the `Foreman: <id>`
// trailer and `[Foreman: <id>]` anchor grammars are built from.

// Required and always a plain string with content.
const REQUIRED_TEXT = ["title", "why", "what"];
// Required, and every reader already defaults them -- so a missing one is a
// warning with exactly one sane repair rather than a broken file.
// [Foreman: 130] Both halves of the file surface are required-but-defaulted,
// exactly as the single `touches` array was: absent is a repairable warning,
// present-but-wrong-shape is an error.
const DEFAULTED_FIELDS = {
  depends_on: [],
  planned_touches: [],
  observed_touches: [],
  commits: [],
  notes: "",
};

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidDate(value) {
  return typeof value === "string" && DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function finding(code, severity, ids, message, extra = {}) {
  return { code, severity, ids, message, repairable: false, ...extra };
}

// Same trust boundary validateDoc guards on doc: a planned-surface hint that
// is absolute or escapes the project is not a path any collision check should
// be matching against.
// [Foreman: 187] One definition, shared with the add/correct input gate in
// roadmap.js — the two must agree or a path could pass the door and still be
// flagged here (or the reverse). Deferred require, same as the id shape.
function isUnsafePath(value) {
  return roadmap().isUnsafePath(value);
}

function checkEntry(entry, index, out) {
  if (!isObject(entry)) {
    out.push(finding("invalid_type", "error", [], `line ${index + 1} is not a JSON object`));
    return;
  }
  const {
    STATUSES, SOURCES, KINDS, isValidModel, EFFORTS, validateDoc, isValidId,
    ROADMAP_FORMAT_KEY, CURRENT_ROADMAP_FORMAT, isFormatMeta,
  } = roadmap();
  const id = typeof entry.id === "string" ? entry.id : "";
  const ids = id ? [id] : [];
  const at = id ? `entry ${id}` : `line ${index + 1}`;

  // [Foreman: 129] The format meta line. readEntries consumes it wherever it
  // is legal -- first line, whole-number version this Foreman supports -- so
  // a marker that reaches the validator at all is one no reader will honor:
  // either its version is not a usable number, or it is sitting below an
  // entry where nothing looks for it. One finding, then stop: the rest of
  // the entry checks would bury it under a dozen "has no title" errors for
  // a line that was never an entry.
  if (isFormatMeta(entry)) {
    const version = entry[ROADMAP_FORMAT_KEY];
    out.push(finding(
      "unsupported_schema_version",
      "error",
      [],
      index === 0
        ? `ROADMAP.jsonl declares format version ${JSON.stringify(version)}, which is not a whole number 1 or greater — run "roadmap.js migrate" to restamp it as format ${CURRENT_ROADMAP_FORMAT}`
        : `ROADMAP.jsonl carries a ${ROADMAP_FORMAT_KEY} line below an entry; the version marker is only read as the file's first line — run "roadmap.js migrate" to put it back`,
      { field: ROADMAP_FORMAT_KEY }
    ));
    return;
  }

  if (entry.id === undefined || entry.id === null) {
    out.push(finding("missing_field", "error", [], `line ${index + 1} has no id`, { field: "id" }));
  } else if (typeof entry.id !== "string") {
    out.push(finding("invalid_type", "error", [], `line ${index + 1}: id must be a string`, { field: "id" }));
  } else if (!isValidId(entry.id)) {
    out.push(finding("invalid_id", "error", ids, `${at}: id must be three or more digits, zero-padded to at least three ("001", "999", "1000"), not ${JSON.stringify(entry.id)}`, { field: "id" }));
  }

  for (const field of REQUIRED_TEXT) {
    const value = entry[field];
    if (value === undefined || value === null || value === "") {
      out.push(finding("missing_field", "error", ids, `${at} has no ${field}`, { field }));
    } else if (typeof value !== "string") {
      out.push(finding("invalid_type", "error", ids, `${at}: ${field} must be a string`, { field }));
    }
  }

  for (const [field, empty] of Object.entries(DEFAULTED_FIELDS)) {
    const value = entry[field];
    if (value === undefined || value === null) {
      out.push(finding("missing_field", "warning", ids, `${at} has no ${field}`, { field, repairable: Boolean(ids.length) }));
      continue;
    }
    if (Array.isArray(empty)) {
      if (!Array.isArray(value)) {
        out.push(finding("invalid_type", "error", ids, `${at}: ${field} must be an array`, { field }));
      } else if (value.some((item) => typeof item !== "string" || !item)) {
        out.push(finding("invalid_type", "error", ids, `${at}: every ${field} item must be a non-empty string`, { field }));
      }
    } else if (typeof value !== "string") {
      out.push(finding("invalid_type", "error", ids, `${at}: ${field} must be a string`, { field }));
    }
  }

  // [Foreman: 130] The trust boundary is on the PLANNED half only. That is
  // the hand-written one — a typed absolute path or a `..` escape is exactly
  // the mistake this catches, and `correct` is the repair. observed_touches
  // is whatever `git show --name-only --relative` reported for a commit this
  // repository already contains; flagging git's own output would be reporting
  // the repository as damage, and nothing can repair it from here anyway.
  for (const item of Array.isArray(entry.planned_touches) ? entry.planned_touches : []) {
    if (typeof item === "string" && item && isUnsafePath(item)) {
      out.push(finding("invalid_path", "warning", ids, `${at}: planned_touches "${item}" is absolute or escapes the project`, { field: "planned_touches" }));
    }
  }

  if (entry.status === undefined || entry.status === null) {
    out.push(finding("missing_field", "error", ids, `${at} has no status`, { field: "status" }));
  } else if (!STATUSES.has(entry.status)) {
    out.push(finding("unknown_status", "error", ids, `${at}: status ${JSON.stringify(entry.status)} is not one of ${[...STATUSES].join("|")}`, { field: "status" }));
  }

  if (entry.source === undefined || entry.source === null) {
    out.push(finding("missing_field", "error", ids, `${at} has no source`, { field: "source" }));
  } else if (!SOURCES.has(entry.source)) {
    // Warning, not error: early entries were written before the set closed.
    out.push(finding("unknown_source", "warning", ids, `${at}: source ${JSON.stringify(entry.source)} is not one of ${[...SOURCES].join("|")}`, { field: "source" }));
  }

  for (const field of ["created_at", "updated_at"]) {
    if (entry[field] === undefined || entry[field] === null) {
      out.push(finding("missing_field", "error", ids, `${at} has no ${field}`, { field }));
    } else if (!isValidDate(entry[field])) {
      out.push(finding("invalid_date", "error", ids, `${at}: ${field} ${JSON.stringify(entry[field])} is not a real YYYY-MM-DD date`, { field }));
    }
  }

  if (entry.doc !== undefined) {
    try {
      validateDoc(entry.doc);
    } catch (err) {
      out.push(finding("invalid_doc", "error", ids, `${at}: ${err.message}`, { field: "doc" }));
    }
  }
  if (entry.kind !== undefined && !KINDS.has(entry.kind)) {
    out.push(finding("unknown_kind", "error", ids, `${at}: kind ${JSON.stringify(entry.kind)} is not one of ${[...KINDS].join("|")}`, { field: "kind" }));
  }
  if (entry.model !== undefined && !isValidModel(entry.model)) {
    out.push(finding("unknown_model", "error", ids, `${at}: model must be a non-empty model identifier of at most 128 characters`, { field: "model" }));
  }
  if (entry.effort !== undefined && !EFFORTS.has(entry.effort)) {
    out.push(finding("unknown_effort", "error", ids, `${at}: effort ${JSON.stringify(entry.effort)} is not one of ${[...EFFORTS].join("|")}`, { field: "effort" }));
  }
}

// [Foreman: 132] `resolve(id)` answers "does this id live in the OTHER file"
// (the archive, when validating the roadmap; the roadmap, when validating the
// archive) and hands back that entry. It is consulted only for an id the rows
// themselves do not carry, so a project with no archive never reads one.
function checkGraph(rows, out, resolve) {
  const { reaches, TERMINAL_STATUSES } = roadmap();
  const byId = new Map();
  const counts = new Map();
  for (const entry of rows) {
    if (typeof entry.id !== "string" || !entry.id) continue;
    counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  for (const [id, count] of counts) {
    if (count > 1) {
      out.push(finding("duplicate_id", "error", [id], `id ${id} appears on ${count} lines`, { field: "id" }));
    }
  }

  for (const entry of rows) {
    const id = entry.id;
    if (typeof id !== "string" || !Array.isArray(entry.depends_on)) continue;
    const seen = new Set();
    for (const dep of entry.depends_on) {
      if (typeof dep !== "string" || !dep) continue;
      if (dep === id) {
        out.push(finding("self_dependency", "error", [id], `entry ${id} depends on itself`, { field: "depends_on", repairable: true }));
        continue;
      }
      if (seen.has(dep)) {
        out.push(finding("duplicate_dependency", "warning", [id], `entry ${id} lists dependency ${dep} more than once`, { field: "depends_on", repairable: true }));
        continue;
      }
      seen.add(dep);
      const parent = byId.get(dep) || (resolve ? resolve(dep) : null);
      if (!parent) {
        out.push(finding("missing_dependency", "error", [id], `entry ${id} depends on ${dep}, which does not exist`, { field: "depends_on" }));
        continue;
      }
      // Same predicate update-deps refuses an edge with, applied to edges
      // that are already in the file.
      if (reaches(rows, dep, id)) {
        out.push(finding("dependency_cycle", "error", [id, dep], `entry ${id} depends on ${dep}, which depends back on ${id}`, { field: "depends_on" }));
        continue;
      }
      if (TERMINAL_STATUSES.has(parent.status) && parent.status !== "done" && !TERMINAL_STATUSES.has(entry.status)) {
        out.push(finding("stranded_dependency", "warning", [id], `entry ${id} waits on ${dep}, which is ${parent.status} — it can never become ready without an edge change`, { field: "depends_on" }));
      }
    }
  }

  // [Foreman: 131] Same shape, one status earlier: `awaiting_acceptance`
  // claims the work is finished and checked, so an entry making that claim
  // with nothing recorded is asking the user to accept on trust. A warning,
  // not an error — the entry is still writable and still recoverable.
  for (const entry of rows) {
    if (typeof entry.id !== "string") continue;
    if (entry.status !== "done" && entry.status !== "awaiting_acceptance") continue;
    // [Foreman: 134] Recorded commits, deliberately -- not resolved ones. The
    // doctor runs on every write and in projects with no git at all, so
    // "does this sha still exist" is a question for the views that can afford
    // to ask git (list --ids, survey), never for the write gate.
    if (recordedCommits(entry).length || String(entry.notes || "").trim()) continue;
    out.push(
      entry.status === "done"
        ? finding("terminal_without_evidence", "warning", [entry.id], `entry ${entry.id} is done with no commits and no notes — nothing records what happened`)
        : finding("awaiting_without_evidence", "warning", [entry.id], `entry ${entry.id} is awaiting_acceptance with no commits and no notes — nothing records the work it asks the user to accept`)
    );
  }
}

// The same word-overlap score check-duplicate offers callers before they add
// a task, run over the pairs already on the roadmap. Capped like
// check-duplicate's own match list: this is a heuristic, and an unbounded
// pair list on a large roadmap would cost more context than it saves.
function checkSimilarity(rows, out) {
  const { normalizeWords, jaccard, DUPLICATE_THRESHOLD, MAX_MATCHES } = roadmap();
  const texts = rows
    .filter((entry) => typeof entry.id === "string" && entry.id)
    .map((entry) => ({ id: entry.id, words: normalizeWords(`${entry.title || ""} ${entry.why || ""}`) }));
  const pairs = [];
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      const score = jaccard(texts[i].words, texts[j].words);
      if (score >= DUPLICATE_THRESHOLD) pairs.push({ a: texts[i].id, b: texts[j].id, score });
    }
  }
  pairs
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_MATCHES)
    .forEach((pair) => {
      out.push(finding(
        "similar_titles",
        "warning",
        [pair.a, pair.b],
        `entries ${pair.a} and ${pair.b} overlap ${pair.score.toFixed(2)} on title/why — possible duplicates`
      ));
    });
}

/**
 * Every structural finding for a set of parsed entries.
 * `similarity: false` drops the pairwise duplicate heuristic — the one
 * quadratic pass, and warning-only, so the write gate (which acts on errors
 * alone) skips it rather than paying for it on every mutation.
 * `resolve(id)` (optional) looks an unresolved dependency up in the sibling
 * file, so an active entry may depend on an archived parent.
 */
function validateEntries(entries, options = {}) {
  const out = [];
  entries.forEach((entry, index) => checkEntry(entry, index, out));
  const rows = entries.filter(isObject);
  checkGraph(rows, out, options.resolve);
  if (options.similarity !== false) checkSimilarity(rows, out);
  return out;
}

// [Foreman: 132] The crash window of an archive/restore move: the entry was
// appended to the destination but the source rewrite never landed, so one id
// sits in both files. The message names the repair because the repair is not
// a hand edit — re-running the same move finishes it, since both commands
// treat a byte-identical destination copy as an interrupted move.
function validateAcrossFiles(active, archived) {
  const out = [];
  const activeIds = new Set(
    active.filter((entry) => isObject(entry) && typeof entry.id === "string").map((entry) => entry.id)
  );
  for (const entry of archived) {
    if (!isObject(entry) || typeof entry.id !== "string" || !activeIds.has(entry.id)) continue;
    out.push(finding(
      "duplicate_across_files",
      "error",
      [entry.id],
      `entry ${entry.id} is in both ROADMAP.jsonl and .foreman/archive.jsonl — an archive/restore that was interrupted between the two writes; re-run "roadmap.js archive" (or "restore") for that id to finish the move`
    ));
  }
  return out;
}

// [Foreman: 135]
// The aftermath of a branch merge: two branches independently computed the
// same next id, and the merged file carries both entries. `duplicate_id` (and
// its cross-file twin) already names the collision, but on its own it leaves
// the user to work out by hand which entries collided, what is pointing at
// the id, and which commits already claim it. Those are all facts, so the
// doctor states them; which holder deserves to keep the id is a judgment, so
// it stays the user's (`roadmap.js reassign-id`).
//
// Reached only when a duplicate finding actually exists: the git history scan
// behind the trailer count must never run on a healthy roadmap, and the write
// gate (validateEntries) does not come through here at all.
const DUPLICATE_CODES = new Set(["duplicate_id", "duplicate_across_files"]);
// A count plus the first couple of shas is enough to know where to look; the
// exhaustive list is one `git log --grep` away, and this message is read in a
// hook's context budget.
const MAX_TRAILER_SHAS = 3;

function holdersOf(entries, id, archived) {
  return entries
    .filter((entry) => isObject(entry) && entry.id === id)
    .map((entry) => ({
      title: entry.title,
      status: entry.status,
      created_at: entry.created_at,
      ...(archived ? { archived: true } : {}),
    }));
}

function dependentsOf(entries, id, archived) {
  return entries
    .filter((entry) => (
      isObject(entry) && Array.isArray(entry.depends_on) && entry.depends_on.includes(id)
    ))
    .map((entry) => ({ id: entry.id, ...(archived ? { archived: true } : {}) }));
}

/**
 * Everything one duplicated id costs, across both files: who holds it, what
 * depends on it, and which commits label themselves with it. `trailer_commits`
 * is absent (not zero) when git could not be asked at all -- fail-soft, and
 * "unknown" is not "none".
 */
function describeDuplicate(root, id, active, archived) {
  const shas = trailerShasFor(root, id);
  return {
    holders: [...holdersOf(active, id, false), ...holdersOf(archived, id, true)],
    dependents: [...dependentsOf(active, id, false), ...dependentsOf(archived, id, true)],
    ...(shas
      ? { trailer_commits: shas.slice(0, MAX_TRAILER_SHAS), trailer_commit_count: shas.length }
      : {}),
  };
}

function duplicateMessage(message, id, detail) {
  const holders = detail.holders
    .map((h) => `${JSON.stringify(h.title)} (${h.status}, created ${h.created_at}${h.archived ? ", archived" : ""})`)
    .join(", ");
  const dependents = detail.dependents.length
    ? `depended on by ${detail.dependents.map((d) => `${d.id}${d.archived ? " (archived)" : ""}`).join(", ")}`
    : "nothing depends on it";
  const count = detail.trailer_commit_count;
  const shown = detail.trailer_commits;
  const trailers = shown === undefined
    ? ""
    : `; ${count === 1 ? "1 commit carries" : `${count} commits carry`} "${roadmap().commitTrailerFor(id)}"`
      + (count ? ` (${shown.join(", ")}${count > shown.length ? ", …" : ""})` : "");
  return `${message} — holders: ${holders}; ${dependents}${trailers}`
    + '. Repair with "roadmap.js reassign-id": name the title that keeps the id, every other holder gets a fresh one';
}

/**
 * Duplicate findings, restated with the facts a merge repair needs. Codes,
 * severities and ids are untouched on purpose -- findingKey identity is what
 * lets the write gate tolerate a duplicate the file already had, so enriching
 * a message must never move a finding's identity.
 */
function enrichDuplicates(root, findings, active, archived) {
  if (!findings.some((item) => DUPLICATE_CODES.has(item.code))) return findings;
  return findings.map((item) => {
    if (!DUPLICATE_CODES.has(item.code)) return item;
    const id = item.ids[0];
    const detail = describeDuplicate(root, id, active, archived);
    return { ...item, message: duplicateMessage(item.message, id, detail), detail };
  });
}

const BOOL = { ok: (value) => typeof value === "boolean", expected: "true or false" };
const STRING = { ok: (value) => typeof value === "string" && value !== "", expected: "a non-empty string" };
const ON_FINISH = new Set(["ask", "squash", "merge", "pr", "keep"]);

function oneOf(values) {
  return { ok: (value) => values.has(value), expected: [...values].join(" | ") };
}

// One shape for the ledger group and for the two keys it replaced, so an
// alias can never validate differently from the name it aliases.
const LEDGER_SPEC = {
  spec: {
    enabled: BOOL,
    dir: { ok: isValidDir, expected: 'a relative path with no ".." segments' },
  },
};

// Documented in settings.md; the accepted values come from the modules that
// actually read them, so this table can never drift from the readers.
const CONFIG_SPEC = {
  discoverySuggestions: BOOL,
  usePersona: BOOL,
  // [Foreman: 208] Opt-in, default false. Read by scripts/trial-log.js.
  trialLog: BOOL,
  requireVerification: BOOL,
  // [Foreman: 260] `fableEnabled` is gone with the executing-model question
  // it gated -- Foreman no longer asks which model runs a task -- and now
  // reports as a key this Foreman does not know, the same way
  // `decisionLog.gate` did. init has always written `{}`, so only a project
  // that hand-set it sees the warning.
  taskCloseGate: oneOf(VALID_GATES),
  omitSections: {
    ok: (value) => Array.isArray(value) && value.every((tag) => OMITTABLE_TAGS.has(tag)),
    expected: `an array of ${[...OMITTABLE_TAGS].join(" | ")}`,
  },
  // The ledger. Two keys, default off, every other constant in code — a
  // consumer-less setting is a setting that drifts from its reader.
  ledger: LEDGER_SPEC,
  checkpoints: {
    spec: { baseBranch: STRING, branch: BOOL, onFinish: oneOf(ON_FINISH) },
  },
  // The two keys `ledger` replaced, still read so an opted-in project keeps
  // working untouched. Validated identically; `decisionLog.gate` is gone with
  // the gate it named, and reports as a key this Foreman does not know.
  decisionLog: LEDGER_SPEC,
  areaNotes: LEDGER_SPEC,
};

function checkGroup(prefix, group, spec, out) {
  for (const [key, value] of Object.entries(group)) {
    const field = `${prefix}${key}`;
    const rule = spec[key];
    if (!rule) {
      // Forward compatibility: a newer Foreman's key is not corruption.
      out.push(finding("unknown_config_key", "warning", [], `.foreman/config.json: ${field} is not a setting this Foreman knows`, { field }));
      continue;
    }
    if (rule.spec) {
      if (!isObject(value)) {
        out.push(finding("invalid_config_value", "error", [], `.foreman/config.json: ${field} must be an object`, { field }));
        continue;
      }
      checkGroup(`${field}.`, value, rule.spec, out);
      continue;
    }
    if (!rule.ok(value)) {
      out.push(finding("invalid_config_value", "error", [], `.foreman/config.json: ${field} must be ${rule.expected}, got ${JSON.stringify(value)}`, { field }));
    }
  }
}

// How many record ids a truncated list names before it stops. Long enough to
// point at the problem, short enough that a store with hundreds of dead
// records still produces one readable line.
const NOTES_ID_SAMPLE = 5;

/**
 * Findings for `.foreman/notes.jsonl`. Filesystem only — no git, ever: this
 * runs on every `doctor`, and a per-record history scan would put the cost of
 * the whole store on a command people run casually.
 *
 * Dead and invalid records aggregate into ONE finding each. Reporting them
 * individually would make doctor's output grow with the store forever, which
 * is the same unbounded-output failure the `notes` CLI caps against.
 */
function validateAreaNotes(root) {
  const out = [];
  const { records, error, invalid } = ledger.read(root);

  if (error === "unreadable" || error === "conflict") {
    out.push(finding(
      "notes_unreadable",
      "error",
      [],
      error === "conflict"
        ? `${ledger.NOTES_RELATIVE} still carries merge conflict markers — resolve them by hand; it is append-only, so both sides' lines are keepable`
        : `${ledger.NOTES_RELATIVE} exists but could not be read`
    ));
    return out;
  }
  if (error === "unsupported_format") {
    out.push(finding(
      "notes_unsupported_format",
      "error",
      [],
      `${ledger.NOTES_RELATIVE} declares a format this Foreman does not know — upgrade Foreman rather than editing the file`
    ));
    return out;
  }

  if (invalid) {
    out.push(finding(
      "notes_invalid_record",
      "warning",
      [],
      `${ledger.NOTES_RELATIVE}: ${invalid} line${invalid === 1 ? "" : "s"} could not be read as a record and ${invalid === 1 ? "is" : "are"} skipped`
    ));
  }

  // A record every one of whose files is gone describes code that no longer
  // exists. It is information, not a defect: the store is append-only and
  // pruning is a later, user-approved decision — `roadmap.js note-prune` is
  // that decision's one mechanism, and nothing here performs it.
  const dead = records.filter((record) => ledger.isDead(root, record));
  if (dead.length) {
    const areas = new Set(dead.map((record) => record.area || "."));
    const oldest = dead.map((record) => record.date).filter(Boolean).sort()[0];
    const ids = dead.map((record) => record.entry).filter(Boolean);
    const sample = ids.slice(0, NOTES_ID_SAMPLE).join(", ");
    const more = ids.length > NOTES_ID_SAMPLE ? `, +${ids.length - NOTES_ID_SAMPLE} more` : "";
    out.push(finding(
      "notes_dead_record",
      "info",
      [],
      `${ledger.NOTES_RELATIVE}: ${dead.length} record${dead.length === 1 ? "" : "s"} name only files that no longer exist, `
        + `across ${areas.size} area${areas.size === 1 ? "" : "s"}`
        + (oldest ? `; oldest ${oldest}` : "")
        + (sample ? ` (entries ${sample}${more})` : "")
        + " — clear them with `roadmap.js note-prune`"
    ));
  }

  return out;
}

/** Findings for .foreman/config.json. A missing file is the uninitialized case. */
function validateConfig(root) {
  const out = [];
  let raw;
  try {
    raw = fs.readFileSync(configPath(root), "utf-8");
  } catch (err) {
    if (err && err.code === "ENOENT") return out;
    out.push(finding("unreadable_config", "error", [], `.foreman/config.json could not be read: ${err.message}`));
    return out;
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    // Every reader fails soft to defaults on this, silently in the hooks --
    // which is exactly why it has to be loud somewhere.
    out.push(finding("unreadable_config", "error", [], `.foreman/config.json is not valid JSON: ${err.message}`));
    return out;
  }
  if (!isObject(config)) {
    out.push(finding("unreadable_config", "error", [], ".foreman/config.json must contain a JSON object"));
    return out;
  }
  checkGroup("", config, CONFIG_SPEC, out);
  return out;
}

/**
 * Apply the repairs whose outcome is not a judgment call, in place.
 * `updated_at` deliberately stays untouched: normalizing a container field
 * is not a change to the task, and bumping the date would make a long-closed
 * entry look freshly done to post-commit.js.
 */
function applyRepairs(entries, findings) {
  const byId = new Map();
  for (const entry of entries) {
    if (isObject(entry) && typeof entry.id === "string" && !byId.has(entry.id)) byId.set(entry.id, entry);
  }
  const applied = [];
  for (const item of findings) {
    if (!item.repairable) continue;
    const entry = byId.get(item.ids[0]);
    if (!entry) continue;
    if (item.code === "missing_field" && item.field in DEFAULTED_FIELDS) {
      const empty = DEFAULTED_FIELDS[item.field];
      entry[item.field] = Array.isArray(empty) ? [] : empty;
    } else if (item.code === "self_dependency") {
      entry.depends_on = entry.depends_on.filter((dep) => dep !== entry.id);
    } else if (item.code === "duplicate_dependency") {
      entry.depends_on = [...new Set(entry.depends_on)];
    } else {
      continue;
    }
    applied.push(item);
  }
  return applied;
}

// The host events Foreman's hooks are registered against, read from the
// manifest that registers them so the list cannot drift. If a host omits a
// registered event or the user disables hooks, assistance goes quiet,
// and nothing else would ever say why. So doctor says it, every run, at a
// severity that counts toward neither errors nor warnings — this is a
// disclosure, not a defect.
function hookDependencies() {
  let events;
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "hooks", "hooks.json"), "utf-8")
    );
    events = Object.keys(manifest.hooks || {}).sort();
  } catch {
    return [];
  }
  if (!events.length) return [];
  return [
    finding(
      "hook_dependencies",
      "info",
      [],
      `Foreman's automatic behavior depends on these Codex hook events: ${events.join(", ")}. `
        + "Task lifecycle registration is explicit through hooks/codex-task.js; Codex does not emit "
        + "TaskCreated or TaskCompleted. Hooks must be enabled and trusted. The CLI and skills "
        + "remain usable when a host does not deliver hooks."
    ),
  ];
}

function summarize(findings) {
  return {
    ok: !findings.some((item) => item.severity === "error"),
    findings,
    summary: {
      errors: findings.filter((item) => item.severity === "error").length,
      warnings: findings.filter((item) => item.severity === "warning").length,
    },
  };
}

module.exports = {
  hookDependencies,
  validateEntries,
  validateAcrossFiles,
  enrichDuplicates,
  validateConfig,
  validateAreaNotes,
  applyRepairs,
  summarize,
  CONFIG_SPEC,
  DEFAULTED_FIELDS,
};
