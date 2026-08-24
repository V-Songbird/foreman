#!/usr/bin/env node
"use strict";

// [Foreman: 062] Standalone CLI contract: this file is plain Node and must
// stay runnable with no harness present. CLAUDE_PROJECT_DIR is optional and
// falls back to cwd; no other harness dependency is permitted here. Pinned by
// tests/standalone.test.js, which spawns it with every CLAUDE_* variable
// deleted.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { withRoadmapLock } = require("./roadmap-lock");
// [Foreman: 208] The opt-in trial log. Its record() is a silent no-op unless
// the project turned it on, and it never throws — a trial is an observation
// of the work and must never become a way for the work to fail.
const { record: recordTrial } = require("./trial-log");
const ledger = require("./ledger");
const { readLedger } = require("./ledger-config");
const noteStaleness = require("./note-staleness");
const {
  validateEntries,
  validateAcrossFiles,
  enrichDuplicates,
  validateConfig,
  validateAreaNotes,
  hookDependencies,
  applyRepairs,
  summarize,
} = require("./roadmap-doctor");
// [Foreman: 134] One interpreter for entry-to-commit facts, shared with the
// doctor, the close gate, safe-commit and the survey flow.
const {
  filesFromGit,
  recordedCommits,
  evidenceSummary,
  trailerShasFor,
} = require("./commit-evidence");

function projectDir() {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

function roadmapPath(root) {
  return path.join(root, "ROADMAP.jsonl");
}

// [Foreman: 132]
// Terminal entries move here so the active file stays the working set and
// stops growing forever. Same line format, same format marker, same CLI —
// only the path differs, so `archive.jsonl` is inspectable with the same eyes
// (and the same parser) as the roadmap itself. It sits beside config.json
// rather than at the project root: it is history, not the plan.
const ARCHIVE_LABEL = ".foreman/archive.jsonl";

function archivePath(root) {
  return path.join(root, ".foreman", "archive.jsonl");
}

// [Foreman: 129]
// The file's format version, declared by an OPTIONAL meta line
// `{"foreman_roadmap_format":1}` as the first line. Absence means 1, so
// every roadmap written before this marker existed stays valid with no
// migration at all. Every write stamps the line from now on (see
// writeEntries), so any mutated roadmap becomes explicitly versioned.
//
// The marker is recognized by SHAPE, not position: the format key and no
// `id`, so it can never be mistaken for an entry (and an entry can never be
// mistaken for it). readEntries consumes it only where it is legal — first
// line, whole-number version this Foreman supports. Any other marker falls
// through as a row, so `doctor` reports it and `migrate` repairs it, rather
// than being silently ignored.
const ROADMAP_FORMAT_KEY = "foreman_roadmap_format";
const CURRENT_ROADMAP_FORMAT = 2;

function isFormatMeta(value) {
  return (
    Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && ROADMAP_FORMAT_KEY in value
    && value.id === undefined
  );
}

// [Foreman: 130]
// Format 1 -> 2: one `touches` array carried both an editable prediction and
// a commit-derived history, so a close could only ever grow it and a
// collision check could not tell forecast from footprint. It becomes two
// fields: `planned_touches` (the prediction, replaceable by `correct`) and
// `observed_touches` (append-only, derived at close).
//
// Purely mechanical, and deliberately no git: everything a v1 entry recorded
// was reached through the one array, and nothing in the file says which paths
// came from the guess and which from a commit. Guessing would invent history,
// so the whole array becomes the prediction (which `correct` can fix) and the
// observed half starts empty, filled by the next close. `commits[]` remains
// the ground truth either way.
//
// Idempotent by shape: an entry with no `touches` key is already upgraded and
// passes through untouched, so migrate can run over a file readEntries has
// already normalized.
function splitTouches(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry) || !("touches" in entry)) {
    return entry;
  }
  const upgraded = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === "planned_touches" || key === "observed_touches") continue;
    if (key !== "touches") {
      upgraded[key] = value;
      continue;
    }
    // In place, so the field keeps its column in the line.
    upgraded.planned_touches = Array.isArray(value) ? value : [];
    upgraded.observed_touches = Array.isArray(entry.observed_touches) ? entry.observed_touches : [];
  }
  return upgraded;
}

// Upgrade steps between adjacent formats, in order. `migrate` is the only
// thing that writes the result; readEntries applies the same steps IN MEMORY
// so every read-only command works on an unmigrated file.
const UPGRADE_STEPS = [
  { from: 1, to: 2, fn: (entries) => entries.map(splitTouches) },
];

// Every step at or above the file's own version, in order — so a format-1
// file walks the whole chain and a current one walks none.
function upgradeEntries(entries, from) {
  let out = entries;
  for (const step of UPGRADE_STEPS) {
    if (step.from >= from) out = step.fn(out);
  }
  return out;
}

// Plain words, and it names the fix: a file from a newer Foreman cannot be
// parsed by guesswork, so every CLI surface stops here with one message
// instead of misreading entries whose rules this version does not know.
function unsupportedFormatError(version, label) {
  const err = new Error(
    `${label} is format version ${JSON.stringify(version)}, but this Foreman understands `
      + `format version ${CURRENT_ROADMAP_FORMAT}. Upgrade the Foreman plugin, or run `
      + `"roadmap.js migrate" with the newer Foreman that wrote this file.`
  );
  err.code = "FOREMAN_ROADMAP_FORMAT_UNSUPPORTED";
  err.found = version;
  err.supported = CURRENT_ROADMAP_FORMAT;
  return err;
}

// One parser for both files — the archive is the same JSONL with the same
// marker, so it gets the same reader rather than a second implementation.
function readEntriesFrom(file, label) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf-8").split("\n");
  const entries = [];
  // Absence means 1, same rule the marker has always had.
  let format = 1;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      throw new Error(`${label} line ${i + 1} is not valid JSON: ${err.message}`);
    }
    // First non-blank line only — a marker further down declares nothing.
    if (isFormatMeta(obj) && !entries.length) {
      const version = obj[ROADMAP_FORMAT_KEY];
      if (Number.isInteger(version) && version >= 1) {
        if (version > CURRENT_ROADMAP_FORMAT) throw unsupportedFormatError(version, label);
        format = version;
        return;
      }
    }
    entries.push(obj);
  });
  // [Foreman: 130] Reading an older format is normalization, not migration:
  // callers always see the current entry shape, and the FILE is untouched.
  // That keeps every read-only command (list, next-candidates, doctor, the
  // hooks) working on an unmigrated roadmap. [Foreman: 130] A write is what
  // finally rewrites the file, migrating it first, with a backup — see
  // migrateIfNeeded.
  return upgradeEntries(entries, format);
}

// [Foreman: 132] ACTIVE entries only, and deliberately unchanged in shape:
// every existing caller (list, next-candidates, the hooks, the replay harness)
// excludes archived work by construction instead of remembering to filter.
function readEntries(root) {
  return readEntriesFrom(roadmapPath(root), "ROADMAP.jsonl");
}

function readArchive(root) {
  return readEntriesFrom(archivePath(root), ARCHIVE_LABEL);
}

// An id's entry in the OTHER file, for the places where a dependency may
// legitimately live across the boundary (an active entry waiting on an
// archived, usually done, parent). Reads at most once per command, and only
// when an id actually failed to resolve locally — the normal project with no
// archive never pays for a second file read.
function otherFileResolver(read) {
  let byId = null;
  return (id) => {
    if (!byId) byId = new Map(read().filter((entry) => entry && entry.id).map((entry) => [entry.id, entry]));
    return byId.get(id) || null;
  };
}

function archiveResolver(root) {
  return otherFileResolver(() => readArchive(root));
}

function activeResolver(root) {
  return otherFileResolver(() => readEntries(root));
}

// [Foreman: 130] The version this file declares, or 1 when it declares none.
// A marker that is malformed or below an entry declares nothing either — no
// reader honors it — so it reads as 1 exactly like an absent one, and
// readEntriesFrom's own accounting says the same. The two must agree: the
// write gate compares this against the version the reader normalized FROM,
// and a disagreement would let one file be silently rewritten into the new
// shape with no backup behind it.
// Only ever called on text readEntries has already accepted, so a version
// beyond CURRENT cannot reach here.
const IMPLICIT_ROADMAP_FORMAT = 1;

function declaredFormat(text) {
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      const version = isFormatMeta(obj) ? obj[ROADMAP_FORMAT_KEY] : undefined;
      return Number.isInteger(version) && version >= 1 ? version : IMPLICIT_ROADMAP_FORMAT;
    } catch {
      return IMPLICIT_ROADMAP_FORMAT;
    }
  }
  return IMPLICIT_ROADMAP_FORMAT;
}

// A finding's identity, so a write can tell "this violation was already in
// the file" from "this mutation just created it".
function findingKey(item) {
  return `${item.code}|${item.field || ""}|${item.ids.join(",")}`;
}

// The structural errors already sitting in the file on disk. A mutation is
// refused for what it would break, never for damage it inherited: an entry
// that predates a rule, or that a hand-edit through the Bash escape hatch
// corrupted, must still be closable — and some of that damage has no
// mechanical repair, so treating it as a write barrier would strand the
// entire roadmap instead of the one bad line. `doctor` is what reports it.
// Read under the caller's mutation lock, before the rename, so this is the
// same pre-image the mutation was computed from.
function existingErrorKeys(read, resolve) {
  try {
    return validateEntries(read(), { similarity: false, resolve })
      .filter((item) => item.severity === "error")
      .map(findingKey);
  } catch {
    return [];
  }
}

// parse-before-write + parse-after-write invariants, enforced here instead of by prose.
// Temp-file-then-rename so a crash mid-write leaves the old file intact —
// same directory, so the rename can't cross filesystems.
//
// Every mutation lands here, so this is where the full structural contract
// (not merely "each line is valid JSON") is enforced: a write that would
// introduce a structural error is refused before the temp file is created.
// Per-field validation in the commands above cannot cover this — it sees one
// argument, never the resulting whole-file graph.
// [Foreman: 129] The exact bytes of a roadmap holding these entries: the
// format meta line first, then one line per entry. Shared with `migrate`, so
// "is this file already current?" is answered by comparing text rather than
// by a second reimplementation of the layout.
function serializeEntries(entries) {
  return [
    JSON.stringify({ [ROADMAP_FORMAT_KEY]: CURRENT_ROADMAP_FORMAT }),
    ...entries.map((e) => JSON.stringify(e)),
  ].join("\n") + "\n";
}

// [Foreman: 132] Both files write through here — same gate, same temp-file
// rename, same marker — so the archive can never drift into a shape the
// roadmap's own reader would refuse. `read` supplies the file's pre-image
// (the errors it already carried, which stay allowed) and `resolve` looks
// dependencies up in the sibling file.
function writeEntriesTo(file, label, entries, read, resolve) {
  // The meta line is this function's to write, never carried inside
  // `entries`. A marker readEntries refused to consume (malformed version,
  // or not the first line) is dropped here — the stamped line below is its
  // repair, and it keeps the invariant exactly one marker, always first.
  const rows = entries.filter((entry) => !isFormatMeta(entry));
  const allowed = new Set(existingErrorKeys(read, resolve));
  const blocking = validateEntries(rows, { similarity: false, resolve })
    .filter((item) => item.severity === "error" && !allowed.has(findingKey(item)));
  if (blocking.length) {
    const detail = blocking.slice(0, 3).map((item) => `${item.code}: ${item.message}`).join("; ");
    throw new Error(
      `refusing to write ${label} — the result would violate the roadmap contract `
        + `(${blocking.length} error${blocking.length === 1 ? "" : "s"}): ${detail}`
        + `. Run "roadmap.js doctor" for the full report`
    );
  }
  const text = serializeEntries(rows);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, text, "utf-8");
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw err;
  }
  readEntriesFrom(file, label); // throws if the write somehow produced malformed JSONL
}

// [Foreman: 130] The one place a write can tell "this file is still an older
// format" — every mutation lands in writeEntries/writeArchive. Reading an old
// file is fine (readEntriesFrom normalizes it). A file that does not exist
// yet (or is empty) has nothing to migrate, so a first write is never
// blocked or backed up.
function fileFormat(file) {
  if (!fs.existsSync(file)) return CURRENT_ROADMAP_FORMAT;
  const text = fs.readFileSync(file, "utf-8");
  return text.trim() ? declaredFormat(text) : CURRENT_ROADMAP_FORMAT;
}

// [Foreman: 130] Rewriting an older file used to be refused outright, naming
// `migrate` as the fix — but every roadmap Foreman ever wrote before the
// marker existed IS format 1, so that refusal fired on the very first
// mutation after every existing install upgraded, with no skill in the loop
// to explain it. Writing one now migrates it first instead: the same
// backup-then-rewrite `migrate` performs (via migrateFile, defined below,
// which this forward-references — safe, since function declarations are
// hoisted and nothing calls this before the module has fully loaded), run
// automatically under the same mutation lock the write already holds. Format
// 1 covers absence AND a malformed/misplaced marker (both read as 1 — see
// declaredFormat), so a damaged marker self-heals on the next mutation too,
// exactly as an explicit `migrate` would fix it. `migrate` stays available
// for a caller who wants the upgrade done up front, with nothing else
// changing.
function migrateIfNeeded(root) {
  const rp = roadmapPath(root);
  const ap = archivePath(root);
  const roadmap = fileFormat(rp) < CURRENT_ROADMAP_FORMAT
    ? migrateFile(rp, () => readEntries(root), (entries) =>
        writeEntries(root, entries, archiveResolver(root), { migrating: true }))
    : null;
  const archive = fileFormat(ap) < CURRENT_ROADMAP_FORMAT
    ? migrateFile(ap, () => readArchive(root), (entries) =>
        writeArchive(root, entries, { migrating: true }))
    : null;
  if (!roadmap && !archive) return undefined;
  return {
    ...(roadmap ? { from: roadmap.from, to: CURRENT_ROADMAP_FORMAT, backup: roadmap.backup } : {}),
    ...(archive ? { archive: { from: archive.from, backup: archive.backup } } : {}),
  };
}

// `migrating: true` is migrate's (and migrateIfNeeded's) own write — the one
// rewrite allowed to start from an older file, and the only one that took a
// backup first. Both return the migration facts (or undefined when the file
// was already current) so the caller can fold `migrated` into its own
// result instead of it happening invisibly.
function writeEntries(root, entries, resolve = archiveResolver(root), options = {}) {
  const migrated = options.migrating ? undefined : migrateIfNeeded(root);
  writeEntriesTo(roadmapPath(root), "ROADMAP.jsonl", entries, () => readEntries(root), resolve);
  return migrated;
}

function writeArchive(root, entries, options = {}) {
  const migrated = options.migrating ? undefined : migrateIfNeeded(root);
  writeEntriesTo(archivePath(root), ARCHIVE_LABEL, entries, () => readArchive(root), activeResolver(root));
  return migrated;
}

// The one definition of an id's shape, for every script and hook that parses
// one: three OR MORE digits, zero-padded to at least three -- `001`..`999`,
// then `1000`, `1001`, ... Above 999 the canonical form carries no leading
// zero, so `01000` is not an id (and neither is `07` or `7`). The 4-and-up
// alternative comes first so a global scan over `1000` yields one id and not
// a truncated `100`.
const ID_PATTERN = "(?:[1-9]\\d{3,}|\\d{3})";
const ID_RE = new RegExp(`^${ID_PATTERN}$`);

function isValidId(value) {
  return ID_RE.test(String(value === undefined || value === null ? "" : value));
}

// Numeric max + 1, then padded -- so 999 is followed by 1000, not by a
// lexicographic neighbour. Existing ids are never re-padded.
function nextId(entries) {
  let max = 0;
  for (const e of entries) {
    const n = parseInt(e.id, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1).padStart(3, "0");
}

// Local date, not UTC — post-commit.js compares updated_at against "today"
// for its freshly-done window, and a near-midnight local commit would fall
// outside it if this stamped the UTC date.
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Anchor comment format pointing code at the entry that governs it: `[Foreman: 019]`
// or multi-id `[Foreman: 019, 034]` -- ID_PATTERN ids, comma-separated,
// spaces around the comma optional. Exported so the close gate and the anchor
// tripwire hook share one definition instead of two regexes drifting apart. A
// digit run that is not a valid id (`0199`, `07`) fails the whole bracketed
// match rather than partially matching -- deliberate.
const DECISION_ANCHOR_RE = new RegExp(
  `\\[Foreman:\\s*${ID_PATTERN}(?:\\s*,\\s*${ID_PATTERN})*\\s*\\]`,
  "g"
);
const ID_SCAN_RE = new RegExp(ID_PATTERN, "g");

// All ids named across every anchor comment in `text`, deduped,
// first-seen order. String.prototype.matchAll clones the regex per call,
// so the shared `g` flag's lastIndex never leaks across calls or into
// other consumers of DECISION_ANCHOR_RE.
function anchorIdsIn(text) {
  if (!text) return [];
  const ids = [];
  const seen = new Set();
  for (const match of String(text).matchAll(DECISION_ANCHOR_RE)) {
    for (const id of match[0].match(ID_SCAN_RE) || []) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

// True when some anchor comment in `text` names this exact id (string
// comparison -- callers pass the same zero-padded id shape entries use).
function anchorHasId(text, id) {
  return anchorIdsIn(text).includes(String(id));
}

// Commit-message trailer linking a commit to the entry it closes:
// `Foreman: 042` (or multi-id `Foreman: 041, 042`) as its own line. This
// is the inverse pointer a staged close relies on -- a commit can never
// contain its own sha, but it can name the entry id, which is known
// before committing. Same ID_PATTERN grammar as the decision anchors,
// unbracketed because trailers follow git's `Key: value` shape.
const COMMIT_TRAILER_RE = new RegExp(
  `^Foreman:\\s*${ID_PATTERN}(?:\\s*,\\s*${ID_PATTERN})*\\s*$`,
  "gm"
);

function commitTrailerFor(id) {
  return `Foreman: ${id}`;
}

// All ids named across every trailer line in `text` (a commit
// message), deduped, first-seen order. matchAll clones the regex, so the
// shared `g` flag's lastIndex never leaks across calls.
function trailerIdsIn(text) {
  if (!text) return [];
  const ids = [];
  const seen = new Set();
  for (const match of String(text).matchAll(COMMIT_TRAILER_RE)) {
    for (const id of match[0].match(ID_SCAN_RE) || []) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

// [Foreman: 131]
// `awaiting_acceptance` means the implementation finished AND its checks ran:
// only the user's acceptance is missing. It exists because active work, failed
// verification, and finished-but-unapproved work all used to read `in_progress`,
// so the roadmap could not say which one it was. It is one status value, not a
// review lifecycle: nothing schedules, assigns, or approves through it.
//
// Canonical path: planned → in_progress → awaiting_acceptance → done, with
// awaiting_acceptance → in_progress as the recovery path when the user says
// it is not ready. Only two rules are mechanical (see CREATE_STATUSES below
// and cmdNextCandidates' filter); everything else — a planned→done fast
// close, a reopen — keeps working exactly as before, deliberately.
const STATUSES = new Set([
  "planned",
  "in_progress",
  "awaiting_acceptance",
  "deferred",
  "done",
  "dropped",
  "rejected",
]);
const SOURCES = new Set(["user", "claude-suggested"]);
// Statuses nothing is waiting on any more: the entry will not move again, so
// a dependent of a dropped/rejected one is stranded rather than blocked.
// `awaiting_acceptance` is deliberately NOT here: the user can still send it
// back, so it neither archives nor satisfies a dependent that needs it done.
const TERMINAL_STATUSES = new Set(["done", "dropped", "rejected"]);
// A newly created entry only ever starts as planned or rejected — nothing
// gets created already in_progress/deferred/done/dropped, those are
// transitions applied later via update-status.
const CREATE_STATUSES = new Set(["planned", "rejected"]);

// kind declares a task's purpose: "build" (implement a slice — the default,
// so it's omitted from the entry) or "decision" (resolve an open question,
// producing a recorded decision, not code). Only "decision" is ever stored;
// an entry with no kind is a build, the same omit-when-default shape as doc.
// The pick flow reads it to hand a decision entry a "decide, don't build"
// rule — grounded in a measured ~33% baseline over-execution rate on
// decision-shaped entries without it.
const KINDS = new Set(["build", "decision"]);

// [Foreman: 102]
// What actually executed the entry, self-reported at close time. Neither is
// observable: hook input carries no model, and the Agent tool takes no effort
// argument, so effort is whatever the executing session was already set to.
// Closed sets rather than free strings — the corpus is only comparable if the
// labels are; extend the set when a new model or effort tier ships.
const MODELS = new Set(["haiku", "sonnet", "opus", "fable"]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

// Soft caps, not hard limits — every entry gets re-read on every `list`,
// so a wall-of-text why/notes multiplies cost across every future call.
// Dense means specific (exact paths/symbols), not exhaustive prose.
const WHY_WARN_CHARS = 240;
const WHAT_WARN_CHARS = 400;
// notes is the durable home for full findings (see roadmap-schema.md), not
// a one-line breadcrumb — a dense paragraph of specific findings routinely
// runs into the thousands of chars. This still catches the real failure
// mode: a wholesale serialized-JSON-blob dump.
const NOTES_APPEND_WARN_CHARS = 3000;
const NOTES_WARN_HINT = "a dense finding, not a wall of narrative or a serialized blob";

// Menu rows cross the context boundary before the user has chosen a task, so
// keep their only prose field bounded even when an older entry predates (or
// ignored) the soft warning above. The selected entry is fetched in full
// through `list --ids` after the choice.
function menuExcerpt(text, maxChars = WHY_WARN_CHARS) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}

// notes accumulates across sessions, so each append gets its own dated line.
// updated_at only says the entry moved, never which note moved it, and a
// bare separator collapsed N sessions of findings into one run-on string.
// The newline survives writeEntries' JSON.stringify as an escape, so the
// one-line-per-entry invariant holds. Pre-existing "; "-joined history is
// left alone — no migration.
// [Foreman: 178] One append is exactly one line, which is what makes the
// leading date stamp mean "the script wrote this". A caller's own text is
// free-form and reaches here through JSON, so an embedded `\n` would arrive
// as a real newline and let one `annotate` smuggle in a second line that
// looks mechanically written — including a forged `correction applied:` or
// `id reassigned from ` stamp the health report then counts as real. Folded
// to spaces here rather than guarded at each reader: the invariant belongs to
// the writer.
function appendNote(existing, note) {
  const line = `${today()} ${String(note).replace(/\s*[\r\n]+\s*/g, " ")}`;
  return existing ? `${existing}\n${line}` : line;
}

function fieldWarnings(fields) {
  const warnings = [];
  for (const [name, text, max, hint] of fields) {
    if (text && text.length > max) {
      warnings.push(
        `${name} is ${text.length} chars — aim for under ${max} (${hint || "roughly 1-2 sentences"}). ` +
          "Dense means specific (exact paths/symbols), not an exhaustive essay."
      );
    }
  }
  return warnings;
}

// `doc` is an optional pointer, not a free-text field: exactly "none" (this
// task recorded nothing outside the ledger) or a relative .md path into the
// project's documents dir. Same trust boundary as depends_on ids/
// touches paths -- an absolute path or a `..` escape could point outside
// the project. path.win32.isAbsolute is checked alongside posix's (it's
// always available regardless of host OS) so a Windows-shaped drive-letter
// or backslash-rooted path can't sneak past a check written only for `/`.
function validateDoc(doc) {
  if (doc === "none") return;
  if (typeof doc !== "string" || !doc.endsWith(".md")) {
    throw new Error('doc must be "none" or a relative path ending in .md');
  }
  if (path.win32.isAbsolute(doc) || path.posix.isAbsolute(doc)) {
    throw new Error("doc must be a relative path -- no leading slash or drive letter");
  }
  if (doc.split(/[\\/]/).includes("..")) {
    throw new Error('doc must not contain ".." path segments');
  }
}

// kind is a forced choice like doc: "build" or "decision". "build" is the
// default and never stored (the entry simply has no kind key), so only
// "decision" ever reaches the file — same omit-when-default contract callers
// already know from doc.
function validateKind(kind) {
  if (!KINDS.has(kind)) {
    throw new Error(`kind must be one of ${[...KINDS].join("|")}`);
  }
}

// model/effort are forced choices like kind, but recorded only on
// update-status: an entry being added hasn't run yet, so there is nothing to
// report. Both stay unwritten unless passed -- an entry with no model key ran
// on something nobody recorded, which is different from running on a default.
function validateRan(name, value, allowed) {
  if (!allowed.has(value)) {
    throw new Error(`${name} must be one of ${[...allowed].join("|")}`);
  }
}

// [Foreman: 130] The one reader for a planned-surface argument, shared by
// `add` and `correct`. `planned_touches` is canonical and `touches` is
// accepted as an alias for it (skills, examples and muscle memory all still
// send the old key; when both are given the canonical one wins).
// `observed_touches` is refused outright: it is derived from the closing
// commit, so accepting a hand-written one would let a caller forge history.
// [Foreman: 187] Same trust boundary the doctor warns on, enforced at the
// door: a planned path that is absolute or escapes the project is refused at
// write time instead of persisting behind a warning. The doctor's
// invalid_path warning stays for entries that predate this gate.
function isUnsafePath(value) {
  return (
    path.win32.isAbsolute(value)
    || path.posix.isAbsolute(value)
    || value.split(/[\\/]/).includes("..")
  );
}

function plannedTouchesInput(payload, command) {
  const given = payload || {};
  if (given.observed_touches !== undefined) {
    throw new Error(
      `observed_touches is not a ${command} input — it is derived mechanically from the closing `
        + "commit's diff (or the index, on a staged close). Pass planned_touches to change the prediction"
    );
  }
  const value = given.planned_touches !== undefined ? given.planned_touches : given.touches;
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error("planned_touches must be an array of paths");
  }
  if (Array.isArray(value)) {
    const unsafe = value.filter((item) => typeof item === "string" && item && isUnsafePath(item));
    if (unsafe.length) {
      throw new Error(
        `planned_touches must stay inside the project — refusing absolute or escaping path(s): ${unsafe.join(", ")}`
      );
    }
  }
  return value;
}

function cmdAdd(root, payload) {
  return withRoadmapLock(root, () => cmdAddUnlocked(root, payload));
}

function cmdAddUnlocked(root, payload) {
  const {
    title,
    why,
    what,
    source,
    status,
    depends_on,
    notes,
    doc,
    kind,
    ids_after,
  } = payload || {};
  // [Foreman: 130] `planned_touches` is the field; `touches` is kept as an
  // INPUT alias because every skill, example and habit still types it. The
  // stored entry only ever has the new fields — the alias is a doorway, not
  // a second schema.
  const planned = plannedTouchesInput(payload, "add");
  if (!title || !why || !what) {
    throw new Error("add requires title, why, what");
  }
  if (!SOURCES.has(source)) {
    throw new Error(`source must be one of ${[...SOURCES].join("|")}`);
  }
  const entryStatus = status || "planned";
  if (!CREATE_STATUSES.has(entryStatus)) {
    throw new Error(`add status must be one of ${[...CREATE_STATUSES].join("|")}`);
  }
  if (doc !== undefined) validateDoc(doc);
  if (kind !== undefined) validateKind(kind);
  const entries = readEntries(root);
  const exact = entries.find((entry) => entry.title === title);
  if (exact) {
    return { entry: exact, deduped: true };
  }
  // [Foreman: 132] Archived entries stay part of the history this command
  // answers for: an add replaying a task that was already finished and
  // archived returns that entry rather than creating a second one, and the
  // ids it holds are still spent (see nextId below).
  const archived = readArchive(root);
  const archivedExact = archived.find((entry) => entry.title === title);
  if (archivedExact) {
    return { entry: archivedExact, deduped: true, archived: true };
  }
  const known = [...entries, ...archived];
  // Same trust boundary update-deps already guards: an id that doesn't
  // resolve strands the entry out of next-candidates permanently — the
  // guard hook denies the hand-edit repair and depends_on only ever grows.
  // An archived (usually done) parent is a legitimate dependency, so the
  // archive counts as resolved here too.
  // Self-reference and cycles stay unreachable here: id comes from nextId,
  // so it isn't in entries yet and nothing can reference it.
  const deps = Array.isArray(depends_on) ? depends_on : [];
  const knownIds = new Set(known.map((e) => e.id));
  const unknown = deps.filter((dep) => !knownIds.has(dep));
  if (unknown.length) throw new Error(`unknown depends_on id(s): ${unknown.join(", ")}`);
  // Over BOTH files: reissuing an archived id would point every commit
  // trailer and `[Foreman: <id>]` anchor that names it at a different task.
  let id = nextId(known);
  // [Foreman: 188] An overwrite re-init discards the old file, but its
  // trailers and anchors persist in git history. ids_after names the old
  // generation's highest id so numbering continues past it instead of
  // reissuing ids that history still points at.
  if (ids_after !== undefined) {
    if (!isValidId(ids_after)) {
      throw new Error("ids_after must be a Foreman entry id (three or more digits, zero-padded to at least three)");
    }
    const floor = parseInt(ids_after, 10) + 1;
    if (parseInt(id, 10) < floor) id = String(floor).padStart(3, "0");
  }
  const date = today();
  const entry = {
    id,
    title,
    why,
    what,
    status: entryStatus,
    source,
    depends_on: deps,
    planned_touches: Array.isArray(planned) ? planned : [],
    // Mechanical history, never seeded at creation: nothing has been touched
    // yet, and only a close may add to it.
    observed_touches: [],
    commits: [],
    created_at: date,
    updated_at: date,
    notes: notes || "",
    // omitted entirely when not given -- not backfilled, not defaulted
    ...(doc !== undefined ? { doc } : {}),
    // only a "decision" kind is stored; "build" (or unset) leaves no key
    ...(kind === "decision" ? { kind } : {}),
  };
  entries.push(entry);
  const migrated = writeEntries(root, entries, otherFileResolver(() => archived));
  const warnings = fieldWarnings([
    ["why", why, WHY_WARN_CHARS],
    ["what", what, WHAT_WARN_CHARS],
  ]);
  const result = migrated ? { entry, migrated } : { entry };
  return warnings.length ? { ...result, warnings } : result;
}

// Best-effort: git already has the definitive file list for a commit, more
// accurate than asking Claude to recall it from memory. Never throws — a
// missing git binary, a non-git project, or an unknown sha all just mean no
// auto-derived paths for this call, same fail-soft spirit as commitFailed().
// --relative scopes paths to `root`, matching how `touches` is interpreted
// elsewhere (project-root-relative, not repo-root-relative in a subfolder checkout).
// [Foreman: 110]
// ROADMAP.jsonl lives at the project root, but in a submodule layout the
// commit being closed lives inside a submodule, invisible to the root repo.
// Without this fallback a close from a submodule derives nothing at all:
// `touches` never grows and scope drift never computes. Read from .gitmodules
// so no submodule has to be initialized for the lookup to work.
function submodulePaths(root) {
  try {
    const out = execFileSync(
      "git",
      ["config", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"],
      { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    );
    return out
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[1])
      .filter(Boolean);
  } catch {
    return [];
  }
}

// [Foreman: 134] The root-then-each-submodule walk this derivation always did
// now lives in commit-evidence.js, so every other view that asks git about a
// Foreman commit resolves it in the same places rather than assuming the root.
// Fail-soft throughout: a missing git binary, a non-git project, or an unknown
// sha all just mean no derived paths.
function gitFilesIn(root, args, keep) {
  return filesFromGit(root, args, keep);
}

function filesTouchedByCommit(root, sha) {
  return gitFilesIn(root, ["show", "--pretty=format:", "--name-only", "--relative", sha], Boolean);
}

// The staged-close twin of filesTouchedByCommit: the index instead of a
// landed commit, so a close can derive touches BEFORE the commit exists
// and ride inside it. Same fail-soft contract. ROADMAP.jsonl itself is
// dropped — the close is about to stage it, and it isn't task footprint.
// `.foreman/notes.jsonl` is dropped for the same reason ROADMAP.jsonl is, and
// for one more: a staged close that is later abandoned leaves the notes file
// in the index, where the NEXT close would fold it into observed_touches and
// keep it there permanently.
function filesStagedIn(root) {
  return gitFilesIn(
    root,
    ["diff", "--cached", "--name-only", "--relative"],
    (f) => f && f !== "ROADMAP.jsonl" && f !== ledger.NOTES_RELATIVE
  );
}

// [Foreman: 110]
// The entry's `touches` as it stands BEFORE a close folds anything in is the
// prediction: it is the creation-time guess, and the fold below overwrites it
// with what actually shipped. So the drift has to be measured against a
// snapshot taken first, not against the stored field afterwards.
//
// Matching is prefix-aware on purpose. `touches` is an area-level hint --
// "foreman/tests" predicts every file beneath it -- so a plain set subtraction
// would report drift that never happened.
// Matching goes through normalizedTouch for the same reason the collision
// rule does: it is the one place that knows the shapes a human types.
function coversPath(predicted, actual) {
  const base = normalizedTouch(predicted);
  const target = normalizedTouch(actual);
  if (!base || !target) return false;
  return target === base || target.startsWith(`${base}/`);
}

function scopeDrift(predicted, actual) {
  return {
    untouched: predicted.filter((p) => !actual.some((a) => coversPath(p, a))),
    unpredicted: actual.filter((a) => !predicted.some((p) => coversPath(p, a))),
  };
}

// Subtraction, not judgment: a wide diff says something about how the entry
// was framed, so it is recorded as one note line and never gates the close.
function driftNote(drift) {
  const parts = [];
  if (drift.untouched.length) parts.push(`predicted but untouched: ${drift.untouched.join(", ")}`);
  if (drift.unpredicted.length) parts.push(`touched but unpredicted: ${drift.unpredicted.join(", ")}`);
  return parts.length ? `scope drift — ${parts.join("; ")}` : null;
}

// Best-effort `git add` of the files a staged close writes, so it needs no
// extra caller step to fold them into the pending commit. False (git absent /
// not a repo) never fails the close — the caller just stages them itself.
// The notes file is staged only when this close actually wrote to it; an
// unrelated pending edit to it is not this close's business.
function stageRoadmapFile(root, extraPaths = []) {
  const paths = ["ROADMAP.jsonl", ...extraPaths];
  try {
    execFileSync("git", ["add", "--", ...paths], {
      cwd: root,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function compactEntries(entries, ids) {
  return [...ids]
    .map((id) => entries.find((entry) => entry.id === id))
    .filter(Boolean)
    .map(({ id, title }) => ({ id, title }));
}

// [Foreman: 132] `resolve` is how a dependency that has been archived still
// counts: an id missing from `entries` is looked up in the archive and
// resolves with its archived status (done ⇒ satisfied, dropped/rejected ⇒
// stranded), exactly as it would have before the move. Only a truly absent
// id is treated as missing.
function graphState(entries, resolve) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const parentOf = (id) => byId.get(id) || (resolve ? resolve(id) : null);
  const isDone = (id) => {
    const parent = parentOf(id);
    return Boolean(parent) && parent.status === "done";
  };
  const ready = new Set(
    entries
      .filter((entry) => entry.status === "planned")
      .filter((entry) => (entry.depends_on || []).every(isDone))
      .map((entry) => entry.id)
  );
  const stranded = new Set(
    entries
      .filter((entry) => !TERMINAL_STATUSES.has(entry.status))
      .filter((entry) =>
        (entry.depends_on || []).some((dependency) => {
          const parent = parentOf(dependency);
          return !parent || (TERMINAL_STATUSES.has(parent.status) && parent.status !== "done");
        })
      )
      .map((entry) => entry.id)
  );
  return { ready, stranded };
}

function graphFacts(beforeEntries, afterEntries, options = {}) {
  const before = graphState(beforeEntries, options.resolve);
  const after = graphState(afterEntries, options.resolve);
  const omit = new Set(options.omit || []);
  const difference = (left, right) =>
    new Set([...left].filter((id) => !right.has(id) && !omit.has(id)));
  const newlyUnblocked = difference(after.ready, before.ready);
  const newlyBlocked = difference(before.ready, after.ready);
  const strandedDependents = difference(after.stranded, before.stranded);
  const facts = {};
  if (newlyUnblocked.size) {
    facts.newly_unblocked = compactEntries(afterEntries, newlyUnblocked);
  }
  if (newlyBlocked.size) {
    facts.newly_blocked = compactEntries(afterEntries, newlyBlocked);
  }
  if (strandedDependents.size) {
    facts.stranded_dependents = compactEntries(afterEntries, strandedDependents);
  }
  return facts;
}

// [Foreman: 132] Every mutation is an active-entry operation. An id the
// active file does not have may still be archived, so the "not found" path
// checks there and names the one command that makes it writable again
// instead of leaving the caller to guess where the entry went.
function missingEntryError(resolve, id) {
  if (resolve(id)) {
    return new Error(
      `entry ${id} is archived — run "roadmap.js restore" for it first; archived entries are history, not edited in place`
    );
  }
  return new Error(`no entry with id ${id}`);
}

function cmdUpdateStatus(root, payload) {
  return withRoadmapLock(root, () => cmdUpdateStatusUnlocked(root, payload));
}

function cmdUpdateStatusUnlocked(root, payload) {
  const {
    id,
    status,
    commit,
    staged,
    notes,
    lesson,
    add_touches,
    doc,
    kind,
    model,
    effort,
    expected_status,
    require_ready,
  } = payload || {};
  if (!id || !status) throw new Error("update-status requires id, status");
  if (!STATUSES.has(status)) {
    throw new Error(`status must be one of ${[...STATUSES].join("|")}`);
  }
  if (expected_status !== undefined && !STATUSES.has(expected_status)) {
    throw new Error(`expected_status must be one of ${[...STATUSES].join("|")}`);
  }
  if (require_ready !== undefined && typeof require_ready !== "boolean") {
    throw new Error("require_ready must be a boolean");
  }
  if (
    require_ready
    && (status !== "in_progress" || expected_status !== "planned")
  ) {
    throw new Error(
      "require_ready is only valid for expected planned -> in_progress dispatch"
    );
  }
  // A staged close exists precisely because the commit doesn't yet — the
  // two link modes are mutually exclusive by construction.
  if (staged && commit) {
    throw new Error("staged and commit are mutually exclusive — staged closes before the commit exists, commit records one that already landed");
  }
  // [Foreman: 186] Recorded evidence must at least be sha-shaped: any other
  // truthy string would persist as a "commit" nothing can ever resolve.
  // Existence is still the views' job — this gate runs without git.
  if (commit !== undefined && !/^[0-9a-f]{7,64}$/i.test(String(commit))) {
    throw new Error("commit must be a 7-64 character hex sha — the short or full form git prints");
  }
  if (add_touches !== undefined && !Array.isArray(add_touches)) {
    throw new Error("add_touches must be an array of paths");
  }
  if (lesson !== undefined && typeof lesson !== "string") {
    throw new Error("lesson must be a string — one sentence naming the file or symbol it concerns");
  }
  if (doc !== undefined) validateDoc(doc);
  if (kind !== undefined) validateKind(kind);
  if (model !== undefined) validateRan("model", model, MODELS);
  if (effort !== undefined) validateRan("effort", effort, EFFORTS);
  const resolve = archiveResolver(root);
  const entries = readEntries(root);
  const beforeEntries = entries.map((entry) => ({
    ...entry,
    depends_on: [...(entry.depends_on || [])],
  }));
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw missingEntryError(resolve, id);
  // Internal compare-and-set guard for hooks that first made a read-only
  // eligibility check. Recheck inside the mutation lock so a concurrent
  // close cannot be regressed by the stale hook observation.
  if (expected_status !== undefined && entry.status !== expected_status) {
    return {
      entry,
      skipped: true,
      reason: "status_mismatch",
      expected_status,
    };
  }
  if (require_ready) {
    const byId = new Map(entries.map((candidate) => [candidate.id, candidate]));
    const blockingDependencies = (entry.depends_on || [])
      .map((dependencyId) => {
        // An archived parent still answers for its status — an archived
        // done dependency is satisfied, not missing.
        const dependency = byId.get(dependencyId) || resolve(dependencyId);
        return dependency
          ? {
              id: dependency.id,
              title: dependency.title,
              status: dependency.status,
            }
          : { id: dependencyId, title: "(missing)", status: "missing" };
      });
    const unfinishedDependencies = blockingDependencies.filter(
      (dependency) => dependency.status !== "done"
    );
    if (unfinishedDependencies.length) {
      return {
        entry,
        skipped: true,
        reason: "dependencies_not_done",
        blocking_dependencies: unfinishedDependencies,
      };
    }
  }
  entry.status = status;
  if (doc !== undefined) entry.doc = doc;
  // What ran, not what was recommended -- the gap between the two is the
  // signal, so nothing here compares them or complains when they differ.
  if (model !== undefined) entry.model = model;
  if (effort !== undefined) entry.effort = effort;
  // Reclassify: store only "decision"; setting it back to "build" (the
  // default) drops the key so the omit-when-default invariant holds.
  if (kind === "decision") entry.kind = "decision";
  else if (kind === "build") delete entry.kind;
  if (commit) {
    entry.commits = Array.isArray(entry.commits) ? entry.commits : [];
    if (!entry.commits.includes(commit)) entry.commits.push(commit);
  }
  if (notes) {
    // append-only invariant: never replace existing notes
    entry.notes = appendNote(entry.notes, notes);
  }
  // [Foreman: 130] observed_touches is the growing footprint, same
  // append-only spirit as commits: what the commit's diff actually shows (or,
  // for a staged close, the index), plus whatever add_touches names on top.
  // It lands HERE and not in planned_touches — the prediction is the entry's
  // forecast and stays exactly as its author left it, which is what makes the
  // drift below (and every collision check) mean something.
  const derivedTouches = commit
    ? filesTouchedByCommit(root, commit)
    : staged
      ? filesStagedIn(root)
      : [];
  // [Foreman: 110] The prediction, as stored before this call. Nothing folds
  // into it any more, but it is still read before the write so the drift
  // describes the entry as it was framed.
  const predictedTouches = Array.isArray(entry.planned_touches) ? [...entry.planned_touches] : [];
  const newTouches = [...(add_touches || []), ...derivedTouches];
  if (newTouches.length) {
    entry.observed_touches = Array.isArray(entry.observed_touches) ? entry.observed_touches : [];
    for (const t of newTouches) {
      if (typeof t === "string" && t && !entry.observed_touches.includes(t)) entry.observed_touches.push(t);
    }
  }
  // [Foreman: 110] An entry that predicted nothing has nothing to drift from,
  // and a close with no commit or index behind it has no actual list to
  // compare against — both stay silent rather than reporting every file as a
  // surprise. Re-running the same close would recompute the same line, so an
  // already-recorded one is never appended twice.
  const drift =
    predictedTouches.length && derivedTouches.length ? scopeDrift(predictedTouches, derivedTouches) : null;
  const note = drift && driftNote(drift);
  if (note && !String(entry.notes || "").includes(note)) {
    entry.notes = appendNote(entry.notes, note);
  }
  // The lesson ledger's one write moment, inside the lock this close already
  // holds. Nothing here can fail the close: every refusal is a reported
  // reason, and prose that could not be stored is kept on the entry's own
  // notes rather than dropped.
  const lessonOutcome = lesson === undefined
    ? null
    : recordLesson(root, entry, { lesson, commit });
  if (lessonOutcome && lessonOutcome.note) {
    entry.notes = appendNote(entry.notes, lessonOutcome.note);
  }
  entry.updated_at = today();
  const migrated = writeEntries(root, entries, resolve);
  const warnings = notes ? fieldWarnings([["notes", notes, NOTES_APPEND_WARN_CHARS, NOTES_WARN_HINT]]) : [];
  const result = { entry, ...graphFacts(beforeEntries, entries, { omit: [id], resolve }) };
  if (migrated) result.migrated = migrated;
  if (derivedTouches.length) result.derived_touches = derivedTouches;
  if (drift && (drift.untouched.length || drift.unpredicted.length)) result.scope_drift = drift;
  if (lessonOutcome) result.lesson = lessonOutcome.report;
  // A staged close hands back the exact trailer line the commit message
  // must carry — the entry↔commit link the recorded sha used to be.
  if (staged) {
    result.trailer = commitTrailerFor(id);
    result.roadmap_staged = stageRoadmapFile(
      root,
      lessonOutcome && lessonOutcome.report.stored ? [ledger.NOTES_RELATIVE] : []
    );
  }
  return warnings.length ? { ...result, warnings } : result;
}

// A lesson is worth recording only where there is finished work behind it.
// `awaiting_acceptance` counts for the same reason recall counts it: the diff
// is real and only the user's yes is missing.
const LESSON_STATUSES = new Set([...TERMINAL_STATUSES, "awaiting_acceptance"]);

/**
 * Store one close's lesson, or say exactly why it was not stored.
 *
 * `{report, note}` — `report` is what the close hands back
 * (`{stored:true, area, paths_count}` or `{stored:false, reason}`), `note` is
 * the line to append to the entry's own notes. Both machine prefixes below
 * are in craft-handoff.js's MACHINE_NOTE_RE, so neither the provenance line
 * nor the fallback prose can ever be quoted back as a recall excerpt.
 */
function recordLesson(root, entry, { lesson, commit }) {
  const refuse = (reason, note = null) => {
    recordTrial("lesson_present", { stored: false, outcome: reason }, { root });
    return { report: { stored: false, reason }, note };
  };

  if (!LESSON_STATUSES.has(entry.status)) return refuse("not_a_close");

  // Disabled is not a reason to lose what the user typed: the prose lands on
  // the entry, prefixed so recall can never mistake it for a finding.
  if (!readLedger(root).enabled) {
    return refuse("disabled", `lesson not recorded (ledger disabled): ${lesson}`);
  }

  const anchor = commit ? { kind: "commit", sha: commit } : { kind: "entry" };
  const stored = ledger.append(root, {
    lesson,
    paths: entry.observed_touches || [],
    entry: entry.id,
    anchor,
    date: today(),
  });
  if (!stored.stored) {
    return refuse(stored.reason, `lesson not recorded (${stored.reason}): ${lesson}`);
  }
  recordTrial("lesson_present", { stored: true, outcome: "stored" }, { root });
  return {
    report: stored,
    note: `lesson recorded: ${ledger.NOTES_RELATIVE}, area ${stored.area}`,
  };
}

// Notes-only append that leaves status alone — a breadcrumb write must not
// re-assert a status the caller read earlier, which would silently regress
// an entry another session has since moved (e.g. planned -> in_progress).
function cmdAnnotate(root, payload) {
  return withRoadmapLock(root, () => cmdAnnotateUnlocked(root, payload));
}

function cmdAnnotateUnlocked(root, payload) {
  const { id, notes } = payload || {};
  if (!id || !notes) throw new Error("annotate requires id, notes");
  const entries = readEntries(root);
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw missingEntryError(archiveResolver(root), id);
  // append-only invariant: never replace existing notes
  entry.notes = appendNote(entry.notes, notes);
  entry.updated_at = today();
  const migrated = writeEntries(root, entries);
  const warnings = fieldWarnings([["notes", notes, NOTES_APPEND_WARN_CHARS, NOTES_WARN_HINT]]);
  const result = migrated ? { entry, migrated } : { entry };
  return warnings.length ? { ...result, warnings } : result;
}

// True if starting from startId and walking depends_on chains reaches
// targetId — i.e. targetId already (transitively) depends on startId, so
// making targetId depend on startId too would close a cycle.
function reaches(entries, startId, targetId) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const seen = new Set();
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === targetId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const dep of byId.get(cur)?.depends_on || []) stack.push(dep);
  }
  return false;
}

// Structural fix for a hidden dependency `add` missed at creation time —
// mutates depends_on on an existing entry, which next-candidates already
// reads. Unlike notes, this changes future ranking mechanically instead of
// just leaving a breadcrumb for a human/Claude to notice.
function cmdUpdateDeps(root, payload) {
  return withRoadmapLock(root, () => cmdUpdateDepsUnlocked(root, payload));
}

function cmdUpdateDepsUnlocked(root, payload) {
  const { id, add_depends_on, remove_depends_on } = payload || {};
  const adds = Array.isArray(add_depends_on) ? add_depends_on : [];
  const removes = Array.isArray(remove_depends_on) ? remove_depends_on : [];
  if (!id || (!adds.length && !removes.length)) {
    throw new Error("update-deps requires id and a non-empty add_depends_on or remove_depends_on array");
  }
  const entries = readEntries(root);
  const beforeEntries = entries.map((entry) => ({
    ...entry,
    depends_on: [...(entry.depends_on || [])],
  }));
  const resolve = archiveResolver(root);
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw missingEntryError(resolve, id);
  // An archived (usually done) parent is a legitimate edge, same as add's.
  const knownIds = new Set(entries.map((e) => e.id));
  const unknown = adds.filter((dep) => !knownIds.has(dep) && !resolve(dep));
  if (unknown.length) throw new Error(`unknown depends_on id(s): ${unknown.join(", ")}`);
  if (adds.includes(id)) throw new Error("a task cannot depend on itself");
  // A cycle can only be introduced here — add sets depends_on once, at
  // creation, when no other entry can reference the not-yet-existing id.
  const cyclic = adds.filter((dep) => reaches(entries, dep, id));
  if (cyclic.length) {
    throw new Error(
      `depends_on id(s) would create a cycle back to ${id}: ${cyclic.join(", ")}`
    );
  }
  entry.depends_on = Array.isArray(entry.depends_on) ? entry.depends_on : [];
  // Removals run first and need no guard of their own — dropping an edge
  // can't create a cycle or a dangling reference, and removing an id that
  // isn't there is a no-op, same spirit as the dedup on insert below. This
  // is the recovery path for an edge whose dependency was later dropped.
  if (removes.length) {
    entry.depends_on = entry.depends_on.filter((dep) => !removes.includes(dep));
  }
  for (const dep of adds) {
    if (!entry.depends_on.includes(dep)) entry.depends_on.push(dep);
  }
  entry.updated_at = today();
  const migrated = writeEntries(root, entries, resolve);
  const result = { entry, ...graphFacts(beforeEntries, entries, { resolve }) };
  return migrated ? { ...result, migrated } : result;
}

// The fields a stale plan gets wrong that no other command can repair:
// status is update-status', depends_on is update-deps', notes is append-only
// on purpose. Git is the audit trail for what these used to say -- the active
// entry carries the best-known truth, not a museum of obsolete prose.
const CORRECTABLE_TEXT = ["title", "why", "what"];
// [Foreman: 130] The PLANNED half only. observed_touches is mechanical
// history derived from the commits the entry already names, so there is
// nothing here for a caller to correct — a wrong observation means the wrong
// commit was recorded, which is a different repair.
const CORRECTABLE_FIELDS = [...CORRECTABLE_TEXT, "kind", "planned_touches"];
// Only an entry still being worked toward is correctable. Rewriting a
// done/dropped/rejected one rewrites history: its commits, notes, and closure
// evidence describe the task as it was worded then. An `awaiting_acceptance`
// entry is not history yet — it can still be sent back — so it stays
// correctable like any other active entry.
const CORRECTABLE_STATUSES = new Set([
  "planned",
  "in_progress",
  "awaiting_acceptance",
  "deferred",
]);

// [Foreman: 178] An applied correction stamps one CLI-authored line naming the
// fields it changed — the same shape as reassign-id's. Field NAMES only: the
// prose a correction replaced is git's job, and copying it here would rebuild
// in `notes` exactly the museum of obsolete wording this command exists to
// avoid. Without the stamp an applied correction left no trace at all, so
// scripts/health/roadmap-health.js had nothing to count.
const CORRECTION_MARKER = "correction applied: ";

// [Foreman: 202] `expected.planned_touches`'s guard compares the same
// multiset of paths, not the same order — the array is ordered only because
// JSON has no set type, so a caller who reordered without changing anything
// must not be refused as if someone else had edited the entry.
function touchesSetEqual(expectedValue, current) {
  if (!Array.isArray(expectedValue) || expectedValue.length !== current.length) return false;
  const sortedExpected = [...expectedValue].sort();
  const sortedCurrent = [...current].sort();
  return sortedExpected.every((value, index) => value === sortedCurrent[index]);
}

function cmdCorrect(root, payload) {
  return withRoadmapLock(root, () => cmdCorrectUnlocked(root, payload));
}

function cmdCorrectUnlocked(root, payload) {
  const { id, expected_updated_at, kind } = payload || {};
  if (!id) throw new Error("correct requires id");
  // Same canonical-plus-alias contract as add, and the same refusal of a
  // hand-written observed surface.
  const planned = plannedTouchesInput(payload, "correct");
  // Staleness guard, not a revision counter: `updated_at` already exists and
  // already moves on every write, so no new stored field is needed. It is
  // date-only, so two corrections on the SAME day both pass this check -- the
  // mutation lock is what serializes those (read and write happen inside one
  // lock, so the second call sees the first's result). This catches the
  // cross-session case the lock cannot: a session holding an entry it read
  // days ago, overwriting a correction made since.
  if (!expected_updated_at) {
    throw new Error(
      "correct requires expected_updated_at (the entry's current updated_at) so a stale session cannot overwrite a newer correction"
    );
  }
  const text = {};
  for (const field of CORRECTABLE_TEXT) {
    const value = (payload || {})[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${field} must be a non-empty string`);
    }
    text[field] = value;
  }
  if (kind !== undefined) validateKind(kind);
  // Shape and per-path safety are both checked in plannedTouchesInput; the
  // write gate (invalid_path / non-string item) stays the backstop for
  // entries that predate it.
  if (!Object.keys(text).length && kind === undefined && planned === undefined) {
    throw new Error(`correct requires at least one of ${CORRECTABLE_FIELDS.join(", ")}`);
  }
  const entries = readEntries(root);
  const beforeEntries = entries.map((entry) => ({
    ...entry,
    depends_on: [...(entry.depends_on || [])],
  }));
  const resolve = archiveResolver(root);
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw missingEntryError(resolve, id);
  if (!CORRECTABLE_STATUSES.has(entry.status)) {
    throw new Error(
      `entry ${id} is ${entry.status} — only ${[...CORRECTABLE_STATUSES].join("/")} entries can be corrected; a terminal entry is history its commits already describe`
    );
  }
  // Refused, not silently skipped like update-status' expected_status: a
  // correction the caller composed against older text cannot be applied to
  // text it never saw, so the caller has to re-read and re-decide.
  if (entry.updated_at !== expected_updated_at) {
    throw new Error(
      `entry ${id} was last updated ${entry.updated_at}, not ${expected_updated_at} — re-read the entry and re-apply the correction on top of it`
    );
  }
  // Content compare-and-swap: `updated_at` is date-only, so two sessions
  // that both read an entry today both pass the guard above -- the second
  // one composes its correction against text the first already replaced,
  // and nothing stops it from silently winning. Every field this call is
  // changing (a no-op counts too: the requirement is what the caller SAW,
  // not what ends up different, so there is no field-shaped way around it)
  // must come with the caller's own view of that field's CURRENT value in
  // `expected`. Missing it names the field outright, so the guard cannot be
  // skipped by omission; a mismatch means someone moved it since this
  // session read it.
  const expected = (payload || {}).expected || {};
  const currentKind = entry.kind === "decision" ? "decision" : "build";
  const currentPlanned = Array.isArray(entry.planned_touches) ? entry.planned_touches : [];
  const contentChecks = [
    ...Object.keys(text).map((field) => [field, entry[field]]),
    ...(kind !== undefined ? [["kind", currentKind]] : []),
    ...(planned !== undefined ? [["planned_touches", currentPlanned]] : []),
  ];
  for (const [field, current] of contentChecks) {
    // Same canonical-plus-alias precedence plannedTouchesInput reads on the
    // input side [Foreman: 130]: expected.touches stands in for
    // expected.planned_touches when the caller sent the old key, the
    // canonical one winning when both are given.
    const usesTouchesAlias = field === "planned_touches" && !("planned_touches" in expected) && "touches" in expected;
    const expectedKey = usesTouchesAlias ? "touches" : field;
    if (!(expectedKey in expected)) {
      throw new Error(
        `correct requires expected.${field} (the entry's current ${field}) so a same-day correction cannot overwrite text it never saw`
      );
    }
    // [Foreman: 202] `planned_touches` is an ordered array only because JSON
    // has no set type -- the order carries no meaning, so a caller who
    // reordered the same paths without changing them compares equal instead
    // of being refused as if someone else had edited the entry.
    const matches = field === "planned_touches"
      ? touchesSetEqual(expected[expectedKey], current)
      : expected[expectedKey] === current;
    if (!matches) {
      throw new Error(
        `entry ${id}'s ${field} no longer matches expected.${field} — re-read the entry and re-apply the correction on top of it`
      );
    }
  }
  // add's exact-title replay dedup is only safe while titles stay unique —
  // and it now matches archived titles too, so those count as taken.
  if (text.title !== undefined) {
    const clash = [...entries, ...readArchive(root)]
      .find((other) => other.id !== id && other.title === text.title);
    if (clash) {
      throw new Error(
        `entry ${clash.id} already has the title ${JSON.stringify(text.title)} — titles must stay unique, they are add's replay key`
      );
    }
  }
  const changed = [];
  for (const [field, value] of Object.entries(text)) {
    if (entry[field] === value) continue;
    entry[field] = value;
    changed.push(field);
  }
  // Same omit-when-default contract as add/update-status: "build" removes the
  // key, only "decision" is stored.
  if (kind !== undefined && kind !== (entry.kind === "decision" ? "decision" : "build")) {
    if (kind === "decision") entry.kind = "decision";
    else delete entry.kind;
    changed.push("kind");
  }
  // Full replacement, unlike update-status' append-only fold into
  // observed_touches: this field is the mutable prediction of the surface the
  // work will touch, and a prediction that was wrong has to be able to shrink.
  // [Foreman: 202] Compared as a SET, exactly like the expected-value guard
  // above: the array is ordered only because JSON has no set type. Order-
  // sensitive here meant a caller who reordered the same paths passed the
  // guard as unchanged and then had the reorder written, reported in
  // `changed`, and — since 178 — stamped and counted as an applied
  // correction. One comparison rule for both halves, so they cannot disagree.
  if (planned !== undefined) {
    const current = Array.isArray(entry.planned_touches) ? entry.planned_touches : [];
    if (!touchesSetEqual(planned, current)) {
      entry.planned_touches = planned;
      changed.push("planned_touches");
    }
  }
  // A correction that changes nothing writes nothing — including updated_at,
  // which is the very value every other session's guard is holding, and
  // including the stamp: a no-op correction is not a correction.
  let migrated;
  if (changed.length) {
    entry.notes = appendNote(entry.notes, `${CORRECTION_MARKER}${changed.join(", ")}`);
    entry.updated_at = today();
    migrated = writeEntries(root, entries, resolve);
  }
  const warnings = fieldWarnings([
    ["why", text.why, WHY_WARN_CHARS],
    ["what", text.what, WHAT_WARN_CHARS],
  ]);
  // No correctable field touches status or depends_on, so these are always
  // empty today. Wired anyway so a later correctable field inherits it.
  const result = { entry, changed, ...graphFacts(beforeEntries, entries, { resolve }) };
  if (migrated) result.migrated = migrated;
  return warnings.length ? { ...result, warnings } : result;
}

function cmdList(root, filters) {
  // [Foreman: 132] --archived swaps the source file and nothing else: the
  // same --ids/--status/--summary semantics, over history instead of the
  // active plan. Without it, list is active-only like every other view.
  const entries = filters.archived ? readArchive(root) : readEntries(root);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const statusFilter = filters.status ? new Set(String(filters.status).split(",")) : null;
  const idsFilter = filters.ids ? new Set(String(filters.ids).split(",")) : null;
  let filtered = entries;
  if (statusFilter) filtered = filtered.filter((e) => statusFilter.has(e.status));
  if (idsFilter) filtered = filtered.filter((e) => idsFilter.has(e.id));
  // --summary keeps the fields a whole-roadmap render actually needs (id,
  // title, status, depends_on so blocked-ness stays derivable, and
  // planned_touches — cheap array of path hints, not prose — so a caller
  // building a not-done digest, e.g. foreman:survey step 1, doesn't have to
  // fall back to a full-entry read) and drops the prose — on a large
  // roadmap the full entries are most of the payload, re-sent into context
  // on every review.
  if (filters.summary) {
    filtered = filtered.map((e) => ({
      id: e.id,
      title: e.title,
      status: e.status,
      depends_on: e.depends_on || [],
      planned_touches: e.planned_touches || [],
    }));
  } else if (idsFilter) {
    // A targeted detail read is the post-menu preparation path. Carry only
    // the direct dependencies' decision-document pointers so the caller can
    // honor settled decisions without loading those dependency entries too.
    // Whole-roadmap list output remains the stored entries unchanged.
    filtered = filtered.map((e) => ({
      ...e,
      depends_on_docs: dependencyDocs(e, byId),
      ...(reportsEvidence(e) ? { commit_evidence: evidenceSummary(root, e) } : {}),
    }));
  }
  return { entries: filtered };
}

// [Foreman: 134] A targeted row reports commit evidence only where there is a
// claim to back it: the entry recorded a sha, or its status asserts finished
// work (which a staged close backs with a trailer and no sha at all). A
// planned entry has nothing to report, so it neither says so nor pays for the
// git reads -- the pick-a-task path fetches its entry through this same call.
const EVIDENCE_STATUSES = new Set(["done", "awaiting_acceptance"]);

function reportsEvidence(entry) {
  return recordedCommits(entry).length > 0 || EVIDENCE_STATUSES.has(entry.status);
}

// Upstream decision docs the dispatch should read before starting, so a task
// building on an earlier decision does not silently re-decide it. Direct
// parents only, and "none" explicitly means there is no document pointer.
function dependencyDocs(entry, byId) {
  return (entry.depends_on || [])
    .map((dep) => byId.get(dep))
    .filter((dependency) => dependency && typeof dependency.doc === "string" && dependency.doc !== "none")
    .map((dependency) => dependency.doc);
}

// Statuses that still want their dependencies finished — a done/dropped/
// rejected dependent no longer benefits from anything landing, so it
// neither counts toward unblocks nor extends a dependency chain.
// `awaiting_acceptance` is open: it can still come back to in_progress.
const OPEN_STATUSES = new Set([
  "planned",
  "in_progress",
  "awaiting_acceptance",
  "deferred",
]);

// Fraction of the hint's own words found in the entry's text — containment,
// not jaccard, so a long entry isn't penalized for having words the hint
// didn't mention.
// [Foreman: 130] BOTH file surfaces feed the hint. A hint is how a user finds
// the work they mean ("the auth middleware thing"), so the honest surface is
// everything the entry is about: what it predicts it will touch AND where it
// has already been. Scanning the observed half only ever finds resumed areas
// — it cannot invent a match, since containment scoring needs the hint's own
// words to appear — and the collision check (which must not see history) is a
// separate rule below.
function hintScore(hintWords, entry) {
  if (!hintWords.size) return 0;
  const words = normalizeWords(
    [
      entry.title,
      entry.why,
      entry.what,
      (entry.planned_touches || []).join(" "),
      (entry.observed_touches || []).join(" "),
      entry.notes,
    ]
      .filter(Boolean)
      .join(" ")
  );
  let hit = 0;
  for (const w of hintWords) if (words.has(w)) hit += 1;
  return hit / hintWords.size;
}

// [Foreman: 125]
// The one collision rule, shared by next-candidates and safe-commit's
// ownership check.
// `touches` is an area hint, so `src/auth` owns everything beneath it —
// matching has to be folder-aware in both directions, and forgiving about
// the shapes a human types: Windows separators, `./` prefixes, trailing
// slashes, casing.
function normalizedTouch(touch) {
  return String(touch || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

// Prefix matching stops at a segment boundary on purpose: `src/auth-utils`
// is a sibling of `src/auth`, not a child of it.
function touchesOverlap(left, right) {
  const a = normalizedTouch(left);
  const b = normalizedTouch(right);
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

// Mechanical filter + rank for "what should I work on next" — no stored,
// staleness-prone priority field. unblocks (how much open work depends on
// this entry, directly and down the chain) is a derived proxy for
// importance instead.
// [Foreman: 208] How many accept/resume rows the finish-first check puts in
// front of the ranked candidates, per skills/roadmap/pick.md ("at most 2 of
// each; oldest updated_at first"). Only the trial log's menu-size count reads
// it — the arrays themselves are returned whole, since the branch needs the
// full list to pick its two from.
const MENU_SETTLE_ROWS = 2;

function cmdNextCandidates(root, filters) {
  const limit = filters && filters.limit ? parseInt(filters.limit, 10) : 3;
  const hintWords = normalizeWords(filters && typeof filters.hint === "string" ? filters.hint : "");
  const entries = readEntries(root);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const doneIds = new Set(entries.filter((e) => e.status === "done").map((e) => e.id));
  // [Foreman: 132] An archived parent still satisfies its dependents: an id
  // the active file does not carry is looked up in the archive (once, and
  // only when that happens) and answers with its archived status, so
  // archiving a finished parent never strands the work waiting on it.
  const resolve = archiveResolver(root);
  const dependencyDone = (dep) => {
    if (doneIds.has(dep)) return true;
    if (byId.has(dep)) return false;
    const parent = resolve(dep);
    return Boolean(parent) && parent.status === "done";
  };

  // [Foreman: 131] `in_progress` only, deliberately: collision is the
  // proxy for "someone is mid-flight in these files", and an
  // `awaiting_acceptance` entry's work is already committed — its files are
  // in the tree, not in someone's working copy. Including it would flag
  // overlap that cannot conflict with anything.
  // [Foreman: 130] PLANNED only, on both sides. Collision asks "would
  // starting this task put two sessions in the same files", which is a
  // question about intent: the observed half is where an entry has ALREADY
  // been, and a path it committed last week collides with nothing. Mixing the
  // two is what made a long-running entry accumulate a footprint that flagged
  // every later candidate.
  const inProgressTouches = [];
  for (const e of entries) {
    if (e.status !== "in_progress") continue;
    for (const t of e.planned_touches || []) inProgressTouches.push(t);
  }

  // Reverse dependency edges, open dependents only.
  const openDependents = new Map();
  for (const e of entries) {
    if (!OPEN_STATUSES.has(e.status)) continue;
    for (const dep of new Set(e.depends_on || [])) {
      if (!openDependents.has(dep)) openDependents.set(dep, []);
      openDependents.get(dep).push(e.id);
    }
  }

  // Distinct open entries transitively waiting behind this one — the walk
  // stays on open nodes (openDependents only ever holds them), so a chain
  // severed by a dropped middle entry doesn't inflate the count.
  function transitiveUnblocks(id) {
    const seen = new Set();
    const stack = [...(openDependents.get(id) || [])];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of openDependents.get(cur) || []) stack.push(next);
    }
    return seen.size;
  }

  const unblocked = entries
    // Only `planned` is a candidate — `deferred` is deliberately excluded
    // here: it means "recorded but waiting on an external trigger the user
    // hasn't marked as met", so it must not surface as a "do this next" pick.
    // `awaiting_acceptance` is excluded by the same test: its work is already
    // done, so offering it as a task to start would be a lie. It rides along
    // in its own result array below, where the action is "accept", not "do".
    .filter((e) => e.status === "planned")
    .filter((e) => (e.depends_on || []).every(dependencyDone))
    .map((e) => ({
      id: e.id,
      title: e.title,
      why: e.why,
      what: e.what,
      planned_touches: e.planned_touches || [],
      observed_touches: e.observed_touches || [],
      depends_on: e.depends_on || [],
      unblocks: (openDependents.get(e.id) || []).length,
      unblocks_total: transitiveUnblocks(e.id),
      ...(hintWords.size ? { hint_score: hintScore(hintWords, e) } : {}),
      collision: (e.planned_touches || []).some((t) =>
        inProgressTouches.some((busy) => touchesOverlap(t, busy))
      ),
      created_at: e.created_at,
      notes: e.notes || "",
      // Direct parents only, not the transitive chain. [Foreman: 097]
      depends_on_docs: dependencyDocs(e, byId),
      ...(e.doc !== undefined ? { doc: e.doc } : {}),
      ...(e.kind !== undefined ? { kind: e.kind } : {}),
    }))
    .sort((a, b) => {
      if (hintWords.size && b.hint_score !== a.hint_score) return b.hint_score - a.hint_score;
      if (b.unblocks_total !== a.unblocks_total) return b.unblocks_total - a.unblocks_total;
      if (b.unblocks !== a.unblocks) return b.unblocks - a.unblocks;
      // A candidate whose files an in_progress task is already touching
      // ranks below an otherwise-equal clean one — start where nothing
      // is mid-flight, all else equal.
      if (a.collision !== b.collision) return a.collision ? 1 : -1;
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });

  // Why each candidate sits where it sits, read back off the signals the
  // sort already used — no new ranking input, no reordering. The branches
  // mirror the comparator's own precedence, so the first one that fires is
  // the key that actually decided this row's place.
  for (const candidate of unblocked) {
    let reason;
    if (candidate.hint_score > 0) {
      reason = `matches your hint '${filters.hint}'`;
    } else if (candidate.unblocks_total > 0) {
      reason = `unblocks ${candidate.unblocks_total} open task${candidate.unblocks_total === 1 ? "" : "s"} (${candidate.unblocks} directly)`;
    } else if (
      !candidate.collision &&
      // Tied on every earlier key, so collision is what separated them —
      // and the comparator always puts the colliding one second.
      unblocked.some(
        (other) =>
          other.collision &&
          other.hint_score === candidate.hint_score &&
          other.unblocks_total === candidate.unblocks_total &&
          other.unblocks === candidate.unblocks
      )
    ) {
      reason = "no file overlap with in-progress work, unlike an otherwise equal task";
    } else {
      reason = "oldest ready task";
    }
    candidate.reason = candidate.collision ? `${reason}; may overlap in-progress work` : reason;
  }

  // in_progress entries ride along so the pick flow can offer to finish
  // existing work before starting something new. Full callers still receive
  // the entry substance; --menu projects these to choice-only rows below.
  const inProgress = entries
    .filter((e) => e.status === "in_progress")
    .map((e) => ({
      id: e.id,
      title: e.title,
      why: e.why,
      what: e.what,
      planned_touches: e.planned_touches || [],
      observed_touches: e.observed_touches || [],
      depends_on: e.depends_on || [],
      notes: e.notes || "",
      updated_at: e.updated_at,
      ...(e.doc !== undefined ? { doc: e.doc } : {}),
      ...(e.kind !== undefined ? { kind: e.kind } : {}),
    }));

  // [Foreman: 131] Finished work still waiting on the user's yes. It rides
  // along so the pick flow can offer acceptance, and it is kept OUT of
  // `in_progress` on purpose: the action is different (accept or send back,
  // never resume). Compact in both shapes — accepting needs an id, a title,
  // and how long it has been waiting, not the entry's substance; a caller
  // that wants more fetches it with `list --ids`.
  const awaiting = entries
    .filter((e) => e.status === "awaiting_acceptance")
    .map((e) => ({
      id: e.id,
      title: e.title,
      why: menuExcerpt(e.why),
      updated_at: e.updated_at,
    }));

  const result = {
    // Shape only after filtering and sorting so --menu can never drift from
    // the established recommendation order. Full output stays the default
    // for existing callers that need the complete candidate records.
    candidates: unblocked.slice(0, limit).map((candidate) =>
      filters && filters.menu
        ? {
            id: candidate.id,
            title: candidate.title,
            why: menuExcerpt(candidate.why),
            unblocks: candidate.unblocks,
            unblocks_total: candidate.unblocks_total,
            ...(candidate.hint_score !== undefined ? { hint_score: candidate.hint_score } : {}),
            collision: candidate.collision,
            created_at: candidate.created_at,
            reason: candidate.reason,
          }
        : candidate
    ),
    total_unblocked: unblocked.length,
    in_progress:
      filters && filters.menu
        ? inProgress.map((entry) => ({
            id: entry.id,
            title: entry.title,
            why: menuExcerpt(entry.why),
            updated_at: entry.updated_at,
          }))
        : inProgress,
    // Absent, not empty, when nothing is waiting — a project that never uses
    // the state never sees the key.
    ...(awaiting.length ? { awaiting_acceptance: awaiting } : {}),
  };
  // hint_matched tells the caller whether relevance actually reordered
  // anything — all-zero scores mean the list below is just the standard
  // ranking, and the caller should say the hint found nothing.
  if (filters && filters.hint !== undefined) {
    result.hint_matched = unblocked.some((c) => (c.hint_score || 0) > 0);
  }
  // [Foreman: 208] The menu the user is about to read, recorded where the
  // facts already are. `--menu` is the projection the pick branch asks for
  // before a question is put to anyone, so this is the moment TRIALS.md
  // names — and it costs the skill no instruction tokens, because the skill
  // was already making this call. Silent no-op unless the project opted in;
  // never throws.
  //
  // `candidates` is rows the user is OFFERED, not rows this call returned.
  // The finish-first check in skills/roadmap/pick.md promotes "at most 2 of
  // each" accept/resume row above the ranked candidates, so the arrays are
  // capped the same way here — a project sitting on five in-progress entries
  // still only ever shows two of them, and counting all five would report a
  // menu nobody saw.
  if (filters && filters.menu) {
    recordTrial("menu_shown", {
      candidates: result.candidates.length
        + Math.min(inProgress.length, MENU_SETTLE_ROWS)
        + Math.min(awaiting.length, MENU_SETTLE_ROWS),
      hint: filters.hint !== undefined,
    }, { root });
    if (filters.hint !== undefined) {
      recordTrial("hint_used", { hit: result.hint_matched === true }, { root });
    }
  }
  return result;
}

function normalizeWords(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

const DUPLICATE_THRESHOLD = 0.4;
const MAX_MATCHES = 5;

// Cheap word-overlap check against every entry — not semantic understanding,
// just enough to stop re-suggesting something already declined or already
// on the roadmap. Each match carries its status so the caller can tell
// "already declined" from "already planned/in progress/done".
function cmdCheckDuplicate(root, payload) {
  const { title, why } = payload || {};
  if (!title && !why) throw new Error("check-duplicate requires title and/or why");
  const words = normalizeWords(`${title || ""} ${why || ""}`);
  // [Foreman: 132] Archived entries are still the record of what this
  // project has already considered, so they stay in the sweep — a task
  // finished and archived last month must not be re-suggested as new.
  const matches = [
    ...readEntries(root).map((e) => ({ entry: e, archived: false })),
    ...readArchive(root).map((e) => ({ entry: e, archived: true })),
  ]
    .map(({ entry: e, archived }) => ({
      id: e.id,
      title: e.title,
      status: e.status,
      ...(archived ? { archived: true } : {}),
      score: jaccard(words, normalizeWords(`${e.title || ""} ${e.why || ""}`)),
    }))
    .filter((m) => m.score >= DUPLICATE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHES);
  return { duplicate: matches.length > 0, matches };
}

// [Foreman: 132]
// Archive and restore are the same move in opposite directions, so they are
// one implementation.
//
// Two files cannot be renamed atomically together, so the order is fixed:
// the DESTINATION is written first (temp file + rename, the same crash-safe
// pattern every roadmap write uses), then the source is rewritten without
// the entries. A crash between the two leaves the id in BOTH files — never
// in neither — and re-running the same command finishes the move, because a
// byte-identical copy already sitting in the destination is read as an
// interrupted move rather than a conflict. `doctor` reports that state as
// duplicate_across_files and names the same repair.
//
// All-or-nothing: one bad id refuses the whole call, before anything is
// written. A partial batch would leave the caller to work out which half
// moved, which is exactly the bookkeeping this is supposed to remove.
function moveEntries(root, payload, direction) {
  const ids = (payload || {}).ids;
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== "string" || !id)) {
    throw new Error(`${direction} requires ids: a non-empty array of entry ids`);
  }
  const archiving = direction === "archive";
  const source = archiving ? readEntries(root) : readArchive(root);
  const destination = archiving ? readArchive(root) : readEntries(root);
  const sourceLabel = archiving ? "ROADMAP.jsonl" : ARCHIVE_LABEL;
  const destinationById = new Map(destination.map((entry) => [entry.id, entry]));

  const wanted = [...new Set(ids)];
  const moving = [];
  for (const id of wanted) {
    const entry = source.find((candidate) => candidate.id === id);
    const already = destinationById.get(id);
    if (!entry) {
      throw new Error(
        already
          ? `entry ${id} is already ${archiving ? "archived" : "active"}`
          : `no entry with id ${id} in ${sourceLabel}`
      );
    }
    // Only work nothing is waiting on any more leaves the active file. An
    // entry still in flight would vanish from every view that plans work.
    if (archiving && !TERMINAL_STATUSES.has(entry.status)) {
      throw new Error(
        `entry ${id} is ${entry.status} — only ${[...TERMINAL_STATUSES].join("/")} entries can be archived, `
          + "and nothing is archived by halves, so this call moved nothing"
      );
    }
    if (already) {
      if (JSON.stringify(already) !== JSON.stringify(entry)) {
        throw new Error(
          `entry ${id} is in both ROADMAP.jsonl and ${ARCHIVE_LABEL} with different content — `
            + 'resolve which one is the entry by hand (via Bash), then re-run; run "roadmap.js doctor" for the full report'
        );
      }
      continue; // an interrupted move: only the source rewrite is still owed
    }
    moving.push(entry);
  }

  const keep = new Set(wanted);
  const remaining = source.filter((entry) => !keep.has(entry.id));
  const combined = [...destination, ...moving];
  // Destination first, always — the entry is duplicated for an instant
  // rather than at risk of existing nowhere. Both writes run migrateIfNeeded,
  // but only the first ever finds anything left to do — the second sees an
  // already-current file and reports nothing.
  let migrated;
  if (archiving) {
    if (moving.length) migrated = writeArchive(root, combined);
    migrated = writeEntries(root, remaining) || migrated;
  } else {
    if (moving.length) migrated = writeEntries(root, combined);
    migrated = writeArchive(root, remaining) || migrated;
  }

  const result = {
    [archiving ? "archived" : "restored"]: wanted,
    active_count: archiving ? remaining.length : combined.length,
    archived_count: archiving ? combined.length : remaining.length,
  };
  if (migrated) result.migrated = migrated;
  return result;
}

function cmdArchive(root, payload) {
  return withRoadmapLock(root, () => moveEntries(root, payload, "archive"));
}

function cmdRestore(root, payload) {
  return withRoadmapLock(root, () => moveEntries(root, payload, "restore"));
}

// [Foreman: 135]
// The repair for the one thing a branch merge breaks that nothing else can:
// two branches each computed the same next id, and the merged file carries
// two entries claiming it. `doctor` reports that as duplicate_id (or
// duplicate_across_files when the twin sits in the archive) and describes
// what the collision costs; this is the guarded write that ends it.
//
// The division of labour is deliberate. Mechanical: which ids are free, who
// still points at the duplicated one, rewriting both files without breaking a
// link. Judgment: WHICH holder deserves to keep the id -- the one whose
// commit trailers, anchors and dependents already mean it. So the caller
// names that holder by its exact `title` (the natural discriminator after a
// merge; ids are exactly what is ambiguous here) and every other holder is
// renumbered.
//
// Links survive by construction rather than by rewriting: the id does not
// move, so every `depends_on` that named it still names the entry that kept
// it. A dependent that actually meant the RENUMBERED entry is a judgment too
// -- the result and the doctor detail say which dependents exist, and
// `update-deps` re-points the ones that were meant for the other side.
//
// Computed all-or-nothing: every refusal happens before the first write. When
// holders live in both files a crash between the two writes leaves the
// un-rewritten file's holder still on the old id -- re-running the same call
// finishes it, exactly like an interrupted archive/restore.
function cmdReassignId(root, payload) {
  return withRoadmapLock(root, () => cmdReassignIdUnlocked(root, payload));
}

function cmdReassignIdUnlocked(root, payload) {
  const { id, keep, expected_updated_at_kept: expectedKept } = payload || {};
  if (typeof id !== "string" || !id) throw new Error("reassign-id requires id: the duplicated entry id");
  if (typeof keep !== "string" || !keep) {
    throw new Error("reassign-id requires keep: the exact title of the holder that keeps the id");
  }
  const active = readEntries(root);
  const archived = readArchive(root);
  // File order, active file first -- the renumbering has to be reproducible,
  // and a duplicated id is exactly the case where nothing else orders these.
  const holders = [
    ...active.filter((entry) => entry && entry.id === id).map((entry) => ({ entry, archived: false })),
    ...archived.filter((entry) => entry && entry.id === id).map((entry) => ({ entry, archived: true })),
  ];
  if (holders.length < 2) {
    throw new Error(
      holders.length
        ? `id ${id} is held by exactly one entry — there is nothing to repair`
        : `no entry with id ${id} in ROADMAP.jsonl or ${ARCHIVE_LABEL}`
    );
  }
  const titles = holders.map((holder) => JSON.stringify(holder.entry.title)).join(", ");
  const matches = holders.filter((holder) => holder.entry.title === keep);
  if (!matches.length) {
    throw new Error(
      `no holder of ${id} has the title ${JSON.stringify(keep)} — the holders are ${titles}`
    );
  }
  // The degenerate merge: the same task added on both branches. Renumbering
  // would leave two identical entries with different ids, which is a worse
  // roadmap than the one that came in -- and the CLI cannot tell them apart to
  // edit one, since every command resolves an id to the FIRST holder. Deduping
  // them is a hand edit, which is the one thing the guard hook leaves open.
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} holders of ${id} share the title ${JSON.stringify(keep)} — titles are the only thing `
        + "telling duplicate holders apart, so this one is a manual dedup: drop or re-title one of them by hand "
        + "(the guard hook leaves the Bash path open for a file the CLI cannot repair), then re-run"
    );
  }
  const kept = matches[0];
  // Same staleness guard `correct` uses, and optional for the same reason it
  // is required there: this call does not rewrite the kept entry at all, so
  // pass it only when the choice of holder was made against a read that may
  // since have moved.
  if (expectedKept !== undefined && kept.entry.updated_at !== expectedKept) {
    throw new Error(
      `the holder keeping ${id} was last updated ${kept.entry.updated_at}, not ${expectedKept} — `
        + "re-read the duplicate and re-decide which holder keeps the id"
    );
  }
  // Commit labels are immutable history: a commit saying `Foreman: <id>` may
  // have closed the entry being renumbered, and nothing can rewrite that. So
  // the mismatch is reported instead of hidden, and each renumbered entry
  // carries a dated note saying its old trailers predate the move. Fail-soft:
  // null (git unavailable) reports as no known commits, never as a failure.
  const trailers = trailerShasFor(root, id) || [];
  const known = [...active, ...archived];
  const date = today();
  const others = holders.filter((holder) => holder !== kept);
  const reassigned = others.map((holder) => {
    const to = nextId(known);
    known.push({ id: to });
    holder.entry.id = to;
    holder.entry.notes = appendNote(
      holder.entry.notes,
      `id reassigned from ${id} during duplicate repair; commit trailers ${commitTrailerFor(id)} predate the reassignment`
    );
    holder.entry.updated_at = date;
    return { from: id, to, title: holder.entry.title, trailer_commits: trailers };
  });
  let migrated;
  if (others.some((holder) => !holder.archived)) {
    migrated = writeEntries(root, active, otherFileResolver(() => archived));
  }
  if (others.some((holder) => holder.archived)) {
    migrated = writeArchive(root, archived) || migrated;
  }
  // [Foreman: 247] Lesson records anchored to the repaired id have the same
  // problem the commit trailers do, and unlike the trailers this store is
  // ours to fix. Which holder wrote a given record is unknowable, so the
  // anchor is demoted rather than repointed: the lesson keeps serving, and its
  // staleness reads "unknown" instead of resolving against the wrong entry's
  // history.
  const notes = ledger.demoteAnchors(root, id, { date });

  const result = {
    kept: { id, title: kept.entry.title },
    reassigned,
    // Every entry still pointing at the id -- which now unambiguously means
    // the kept holder. The list is what `update-deps` gets aimed at when one
    // of them actually meant a renumbered entry.
    dependents_on_kept: [...active, ...archived]
      .filter((entry) => entry && Array.isArray(entry.depends_on) && entry.depends_on.includes(id))
      .map((entry) => entry.id),
  };
  if (migrated) result.migrated = migrated;
  if (notes && notes.demoted) result.notes_anchors_demoted = notes.demoted;
  return result;
}

function backupStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function cmdMigrate(root) {
  return withRoadmapLock(root, () => cmdMigrateUnlocked(root));
}

// Repeat-safe by construction: it computes the file the current format would
// produce and compares it with the file on disk. Identical means there is
// nothing to do — no backup, no write, `changed:false` — so running it twice
// is running it once. A file from a NEWER Foreman throws out of readEntries
// before anything here touches the disk. Never reads or writes config.
//
// [Foreman: 130] The archive is the same JSONL at the same format, so it is
// upgraded in the same call and with a backup of its own — leaving it behind
// would strand `restore` (a write) on a file `migrate` claimed to have
// handled. It is skipped entirely when the project has none.
function cmdMigrateUnlocked(root) {
  const p = roadmapPath(root);
  if (!fs.existsSync(p)) {
    throw new Error(`no ROADMAP.jsonl at ${p} — nothing to migrate`);
  }
  const roadmap = migrateFile(p, () => readEntries(root), (entries) =>
    writeEntries(root, entries, archiveResolver(root), { migrating: true })
  );
  const archive = fs.existsSync(archivePath(root))
    ? migrateFile(archivePath(root), () => readArchive(root), (entries) =>
        writeArchive(root, entries, { migrating: true })
      )
    : null;
  return {
    from: roadmap.from,
    to: CURRENT_ROADMAP_FORMAT,
    changed: roadmap.changed || Boolean(archive && archive.changed),
    ...(roadmap.backup ? { backup: roadmap.backup } : {}),
    // Reported separately: two files, two versions, two backups — a caller
    // that has to restore one needs to know which.
    ...(archive ? { archive: { from: archive.from, changed: archive.changed, ...(archive.backup ? { backup: archive.backup } : {}) } } : {}),
  };
}

function migrateFile(file, read, write) {
  const before = fs.readFileSync(file, "utf-8");
  const from = declaredFormat(before);
  // readEntries already applied every upgrade step in memory; re-running them
  // here would be a no-op (each step is idempotent by shape), so the read IS
  // the upgrade and this only decides whether the file on disk still differs.
  const entries = read();
  const after = serializeEntries(entries);
  if (after === before) return { from, changed: false };
  // Before any rewrite, never after: the backup is what makes an upgrade
  // recoverable, so it has to exist while the original still does.
  const backup = `${file}.backup-${backupStamp()}`;
  fs.copyFileSync(file, backup);
  write(entries);
  return { from, changed: true, backup };
}

// Whole-file health check: the same structural contract every write is held
// to, plus the settings file, reported instead of thrown. Read-only unless
// --fix is passed. `ok` here answers "is the roadmap healthy" — the one
// subcommand where it is not just "did the call succeed"; a failed call
// still exits 1 with an `error` field, as everywhere else.
// [Foreman: 132] The archive is held to the SAME per-entry contract as the
// roadmap — same schema, and a corrupt archive line is just as unreadable —
// with each of its findings prefixed by the file it came from, plus the one
// finding only the pair can produce (an id sitting in both). Dependencies
// resolve across the boundary in both directions, so an active entry waiting
// on an archived parent is not "missing" and an archived entry waiting on a
// still-active one is not either. Archived findings are never marked
// repairable: --fix writes the roadmap only.
// [Foreman: 135] Duplicate findings pick up the merge-repair facts here and
// not in validateEntries: the write gate runs that on every mutation, and it
// must never pay for a git history scan. A roadmap with no duplicate is
// untouched by the pass.
function allFindings(root) {
  const active = readEntries(root);
  const archived = readArchive(root);
  return enrichDuplicates(root, [
    ...validateEntries(active, { resolve: otherFileResolver(() => archived) }),
    ...validateEntries(archived, { resolve: otherFileResolver(() => active) }).map((item) => ({
      ...item,
      repairable: false,
      message: `${ARCHIVE_LABEL}: ${item.message}`,
    })),
    ...validateAcrossFiles(active, archived),
    ...validateConfig(root),
    ...validateAreaNotes(root),
    ...hookDependencies(),
  ], active, archived);
}

// [Foreman: 243] The explicit pull. Every cap here exists so the output is
// O(what you asked for) and never O(store): an unfiltered call on a project
// with four hundred closed tasks must still print something a person reads.
const NOTES_MAX_AREAS = 10;

function cmdNotes(root, flags) {
  const { records, error } = ledger.read(root);
  if (error) return { error_code: error, areas: [], records: [] };

  const wantPaths = typeof flags.paths === "string"
    ? flags.paths.split(",").map((p) => p.trim()).filter(Boolean)
    : [];
  const wantArea = typeof flags.area === "string" ? ledger.normalizeStorePath(flags.area).toLowerCase() : "";

  // Newest first everywhere: a corrective record is written after the record
  // it corrects, so it has to be the one a reader meets first.
  let matched = [...records].reverse();
  if (wantPaths.length) {
    matched = matched.filter((record) =>
      record.paths.some((stored) => wantPaths.some((wanted) => touchesOverlap(wanted, stored))));
  }
  if (wantArea) {
    matched = matched.filter((record) => {
      const area = String(record.area || ".").toLowerCase();
      return area === wantArea || area.startsWith(`${wantArea}/`);
    });
  }

  // An unfiltered call is the one that can run away, so only that one is
  // capped by area. A filtered call already named its own bound.
  const filtered = Boolean(wantPaths.length || wantArea);
  const order = [];
  for (const record of matched) {
    const area = record.area || ".";
    if (!order.includes(area)) order.push(area);
  }
  const served = filtered ? order : order.slice(0, NOTES_MAX_AREAS);
  const overflow = order.length - served.length;
  const shown = matched.filter((record) => served.includes(record.area || "."));

  const budget = noteStaleness.newBudget();
  const resolved = noteStaleness.resolveAll(root, shown, budget);

  const result = {
    areas: served,
    records: resolved.map(({ record, state, label: line }) => ({
      key: ledger.recordKey(record),
      area: record.area || ".",
      entry: record.entry,
      date: record.date,
      paths: record.paths,
      lesson: record.lesson,
      staleness: state,
      label: line,
    })),
  };
  if (overflow > 0) {
    result.overflow = `+${overflow} more area${overflow === 1 ? "" : "s"} — filter with --area or --paths`;
  }
  // Past the budget every remaining record serves its anchor and no freshness
  // claim, so say that rather than letting "unknown" read as a git failure.
  if (budget.spent >= budget.limit) result.staleness_budget_spent = true;
  return result;
}

/**
 * [Foreman: 247] Retire one served lesson that proved wrong.
 *
 * The handoff block already tells a session to record the corrected fact on
 * its close, and newest-first serving puts the correction above the mistake.
 * That fixes what gets read first; it does not stop the wrong line being read
 * at all, and it leaves it spending part of a capped serving window forever.
 * This is the other half: name the record and it stops being served.
 *
 * The key comes from `notes` output. It is derived from the record's own
 * content, so it is the same in every clone of the project.
 */
function cmdNoteSupersede(root, payload) {
  const { key, by_entry: byEntry } = payload || {};
  if (typeof key !== "string" || !key) {
    throw new Error("note-supersede requires key: the record key, as `notes` reports it");
  }
  if (byEntry !== undefined && (typeof byEntry !== "string" || !byEntry)) {
    throw new Error("note-supersede's by_entry, when given, is the id of the entry recording the correction");
  }
  // The store's own append is atomic, but a concurrent close writing a lesson
  // is the case this has to serialize against, and that close holds this lock.
  return withRoadmapLock(root, () => ledger.supersede(root, { key, by_entry: byEntry, date: today() }));
}

/**
 * [Foreman: 247] The one operation that rewrites the lesson store.
 *
 * Append-only is what makes every other path in the ledger safe, so this is
 * the deliberate exception and it is never automatic: `--dry-run` reports what
 * would go, and a flow shows that count before asking. What goes is only what
 * nothing can learn from any more — records whose every file is gone, and
 * records a correction already retired.
 */
function cmdNotePrune(root, flags) {
  const dryRun = Boolean(flags && (flags["dry-run"] || flags.dryRun));
  if (dryRun) return ledger.prune(root, { dryRun: true });
  return withRoadmapLock(root, () => ledger.prune(root));
}

function cmdDoctor(root, flags) {
  if (!flags || !flags.fix) {
    return summarize(allFindings(root));
  }
  return withRoadmapLock(root, () => {
    // Re-read inside the lock: the read that produced a finding must be the
    // read the repair is applied to.
    const entries = readEntries(root);
    const resolve = archiveResolver(root);
    const fixed = applyRepairs(entries, validateEntries(entries, { resolve }));
    // The write gate tolerates what the file already had, so a partial
    // repair is never blocked by the damage it cannot fix.
    const migrated = fixed.length ? writeEntries(root, entries, resolve) : undefined;
    // Re-validate from disk, not from memory — the report describes the file
    // that now exists.
    const result = { ...summarize(allFindings(root)), fixed };
    if (migrated) result.migrated = migrated;
    return result;
  });
}

function readStdinJSON() {
  let raw;
  try {
    raw = fs.readFileSync(0, "utf-8");
  } catch {
    raw = "";
  }
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

const USAGE = `roadmap.js -- mechanical CRUD for ROADMAP.jsonl. Every call
prints one JSON line to stdout: {"ok":true, ...} on success,
{"ok":false,"error":"..."} (exit 1) on failure. Any mutating subcommand run
against a file below the current format migrates it first (see "migrate"
below) and adds a "migrated" field ({from, to, backup}) to its own result --
absent when the file was already current.

  add               stdin JSON: {title, why, what, source, depends_on?, planned_touches?, notes?, status?, doc?, kind?}
                    source: "user" | "claude-suggested"
                    planned_touches: the PREDICTED file/area surface (the
                    editable half; "touches" is still accepted as an input
                    alias for it). observed_touches is never an input -- it
                    is derived at close from the commit's own diff

                    depends_on ids must already exist -- an id that doesn't
                    resolve would strand the entry out of next-candidates
                    status (create-time only): "planned" (default) | "rejected"
                    doc: "none" | a relative path ending in .md (no leading
                    slash, no drive letter, no ".." segments) -- an optional
                    pointer at a document this project already keeps,
                    omitted entirely (not defaulted) when not given
                    kind: "build" (default, never stored) | "decision" (resolve
                    an open question, no code) -- only "decision" is stored;
                    the pick flow hands a decision entry a "decide, don't build" rule
                    an exact existing title returns that entry with
                    deduped:true; intentional separate tasks need distinct
                    titles so every add remains safe to replay
  update-status     stdin JSON: {id, status, commit?, staged?, notes?, lesson?, add_touches?, doc?, kind?, model?, effort?, expected_status?, require_ready?}
                    status: "planned" | "in_progress" | "awaiting_acceptance" | "deferred" | "done" | "dropped" | "rejected"
                    "awaiting_acceptance" = implemented AND checked, waiting
                    only on the user's yes; open everywhere (does not satisfy
                    a dependent, does not archive), never a next-candidate.
                    User confirms -> "done"; not ready -> back to "in_progress"
                    "deferred" = recorded but waiting on an external trigger;
                    excluded from next-candidates until moved back to "planned"
                    if commit is given, observed_touches auto-folds in that
                    commit's actual changed files (git show, best-effort,
                    silent if git/the sha is unavailable) -- add_touches adds
                    more on top, for anything outside that commit's diff.
                    planned_touches is never folded into: it is the entry's
                    prediction, and scope_drift is that prediction measured
                    against what the close actually derived
                    staged: true = the staged close -- call it AFTER staging
                    the task's own files with "safe-commit.js finish
                    --no-commit" and BEFORE committing: observed_touches
                    auto-folds from the index instead of a commit, the script stages
                    ROADMAP.jsonl itself, and the result carries trailer
                    ("Foreman: <id>") to put as the commit message's final
                    line -- entry and commit link through that trailer, so
                    the close lands inside its own commit with no sha
                    recorded and no roadmap ride-along. Mutually exclusive
                    with commit (which records one that already landed).
                    add_touches: array of paths to fold into observed_touches
                    (dedup, never removes) -- for a file the commit's own
                    diff cannot show
                    lesson: one durable sentence about this code area,
                    naming the file or symbol it concerns, recorded in
                    .foreman/notes.jsonl for a later task whose planned files
                    intersect this close's observed ones. Only on a close
                    (done/dropped/rejected/awaiting_acceptance), only when
                    ledger.enabled, at most 500 chars -- longer is
                    refused, never truncated. The result reports
                    lesson:{stored:true, area, paths_count} or
                    {stored:false, reason}; prose that could not be stored
                    lands on the entry's own notes instead of being dropped.
                    Omitting it is a valid outcome: nothing generalizes from
                    most tasks
                    doc: same "none" | relative .md path contract as add
                    kind: "build" | "decision" -- reclassify the entry;
                    "decision" is stored, "build" drops the key (the default)
                    model: "haiku" | "sonnet" | "opus" | "fable" -- what
                    ACTUALLY ran this entry, not what was recommended
                    effort: "low" | "medium" | "high" | "xhigh" | "max" --
                    likewise; both are self-reported (nothing can detect
                    them) and omitted entirely when not given
                    dependency changes caused by the transition return
                    compact newly_unblocked/newly_blocked/
                    stranded_dependents facts only when non-empty
                    expected_status is an internal compare-and-set guard:
                    a mismatch returns skipped:true without writing
                    require_ready is an internal dispatch guard: under the
                    same mutation lock, every dependency must still be done
                    or the call returns skipped:true with compact blockers
  annotate          stdin JSON: {id, notes}
                    appends notes and bumps updated_at without touching
                    status -- use for a breadcrumb write so a stale status
                    read never regresses an entry another session moved
  update-deps       stdin JSON: {id, add_depends_on?, remove_depends_on?}
                    at least one must be a non-empty array of ids --
                    remove_depends_on is the recovery path when a dependency
                    was later dropped; removing an id that isn't there is a
                    no-op; returns the same compact graph-fact fields when
                    the edge change makes them non-empty
  correct           stdin JSON: {id, expected_updated_at, expected?, title?, why?, what?, kind?, planned_touches?}
                    the supported repair for an entry whose description or
                    planned files went stale -- at least one correctable
                    field is required, each is a full replacement (title/why/
                    what non-empty strings, planned_touches the whole planned
                    surface -- so a wrong prediction can shrink -- kind on
                    add's contract: "decision" stored, "build" drops the key)
                    "touches" is accepted as an input alias for
                    planned_touches; observed_touches is NOT correctable --
                    it is mechanical history derived from the entry's own
                    commits, and a wrong one means a wrong commit was recorded
                    expected_updated_at is required and must equal the
                    entry's current updated_at, so a stale session cannot
                    overwrite a newer correction; a mismatch names the
                    current value and writes nothing
                    expected is a required content compare-and-swap: for
                    every field this call changes (a no-op counts too),
                    expected.<field> must be the caller's own view of that
                    field's CURRENT value ({"expected":{"what":"..."}} etc,
                    planned_touches compared as a set -- order doesn't
                    matter, and expected.touches is accepted as an alias
                    for expected.planned_touches) -- expected_updated_at
                    is date-only, so two same-day corrections both pass it;
                    this catches the one it cannot. A field changed without
                    its expected entry is refused, naming the field; a
                    mismatch says to re-read and re-apply, same as above
                    only ${[...CORRECTABLE_STATUSES].join("/")}
                    entries are correctable -- done/dropped/rejected is
                    history its commits already describe
                    an applied correction appends one dated
                    "correction applied: <fields>" line to notes: the
                    field names only, never the prose they replaced
                    a title equal to another entry's is refused: titles are
                    add's exact-replay key. Git is the audit trail for what
                    the entry used to say
                    returns changed:[...] listing only the fields that
                    actually differed, plus the same compact graph-fact
                    fields when non-empty
  reassign-id       stdin JSON: {id, keep, expected_updated_at_kept?}
                    the branch-merge repair: two branches computed the same
                    next id, so the merged file has two entries claiming it
                    (doctor reports duplicate_id, or duplicate_across_files
                    when the twin is archived, and describes the collision)
                    keep is the EXACT title of the holder that keeps the id --
                    which one deserves it is the user's call, so it is named,
                    never guessed. Every OTHER holder gets a fresh id (nextId
                    over both files, one each, in file order) and a dated note
                    saying its "Foreman: <old>" commit trailers predate the
                    move; commit history is never rewritten
                    depends_on links are preserved by construction: the id
                    does not move, so every dependent still points at the kept
                    holder. A dependent that actually meant the renumbered
                    entry is re-pointed with update-deps -- that judgment is
                    not automated
                    holders may live in ROADMAP.jsonl or the archive; both
                    files are rewritten with the same gate as any other write
                    refuses: an id only one entry holds, a keep title no
                    holder has, and a keep title SEVERAL holders share (the
                    same task added on both branches -- dedup that by hand)
                    expected_updated_at_kept is the optional staleness guard
                    from correct, checked against the kept holder
                    returns {kept:{id,title}, reassigned:[{from,to,title,
                    trailer_commits}], dependents_on_kept:[ids]}
                    a lesson-ledger record anchored to the repaired id
                    cannot be attributed to either holder, so every one
                    is demoted to an unresolvable anchor rather than
                    pointed at the surviving holder's history
                    (notes_anchors_demoted counts them). The lesson and
                    its date stay; only the freshness verdict falls to
                    unknown
  archive           stdin JSON: {ids:["019", ...]}
                    moves terminal (done/dropped/rejected) entries out of
                    ROADMAP.jsonl into .foreman/archive.jsonl, verbatim --
                    same id, same fields, same status. A non-terminal or
                    unknown id refuses the WHOLE call; nothing moves by
                    halves. Archived entries leave every active view (list,
                    next-candidates) but still count for id continuity,
                    add's exact-title dedup, check-duplicate, and dependency
                    resolution. Returns {archived:[ids], active_count,
                    archived_count}
  restore           stdin JSON: {ids:["019", ...]}
                    the exact inverse: moves entries back verbatim, refusing
                    an id the active file already carries. Same
                    all-or-nothing rule. Restore before changing an archived
                    entry -- update-status/annotate/update-deps/correct all
                    refuse one and say so. Returns {restored:[ids], ...}
                    Both write the destination file BEFORE rewriting the
                    source, so a crash duplicates an id rather than losing
                    it; re-running the same call finishes the move, and
                    doctor reports the gap as duplicate_across_files
  list              flag: --status planned,in_progress   (optional, comma-separated)
                    flag: --ids 002,005   (optional, comma-separated, combinable with --status)
                    targeted full rows add depends_on_docs (direct
                    dependency document paths only)
                    flag: --summary   (optional: entries carry only
                    id/title/status/depends_on/planned_touches -- use for
                    whole-roadmap renders and not-done digests, then fetch
                    the few needing prose via --ids)
                    flag: --archived   (optional: read .foreman/archive.jsonl
                    instead of ROADMAP.jsonl -- same filter semantics;
                    without it every view is active-only)
  next-candidates   flag: --limit N   (optional, default 3)
                    flag: --menu   (optional: compact choice rows only;
                    fetch the selected entry with list --ids <id>)
                    flag: --hint "words"   (optional: rank by how many of
                    the hint's words appear in each candidate's title/why/
                    what/planned_touches/observed_touches/notes -- both file
                    surfaces, so a hint also finds resumed areas; hint_score per
                    candidate, hint_matched:false in the result when no
                    candidate matched at all)
                    candidates include depends_on, unblocks (open entries
                    depending directly), and unblocks_total (the whole
                    open chain behind it); ranked unblocks_total, then
                    unblocks, then no-collision, then oldest
                    every candidate (both shapes) carries reason: one short
                    sentence naming the ranking key that put it there --
                    it is the default ordering explained, not a claim that
                    the entry was checked against the code
                    awaiting_acceptance: compact id/title/bounded why/
                    updated_at rows for entries finished and waiting on the
                    user's yes -- same in both shapes, omitted when empty.
                    Separate from in_progress: the action is accept, not
                    resume
  notes             flag: --paths a.js,b.js   (optional, comma-separated:
                    only records whose stored files overlap one of these)
                    flag: --area <prefix>   (optional: only records under
                    that area key -- a poor filter by design, since two
                    thirds of closed work has no dominant area; --paths is
                    the useful one)
                    the explicit read of the lesson ledger
                    (.foreman/notes.jsonl), newest first, each record
                    carrying a staleness verdict ("fresh"|"stale"|"unknown")
                    and the label that states it. Records whose every stored
                    file is gone are dropped, not labelled.
                    An unfiltered call serves at most 10 areas and adds an
                    "overflow" line counting the rest; staleness resolution
                    stops at a fixed git budget, after which records serve
                    their anchor and no freshness claim
                    (staleness_budget_spent:true says so)
                    a store that will not parse returns error_code and no
                    records -- run doctor for the finding that explains it
                    every record carries key, the name note-supersede takes
  note-supersede    stdin JSON: {key, by_entry?}
                    retire one record that proved wrong, so it stops being
                    served and stops spending the serving window. key is the
                    one notes reports; it is derived from the record's own
                    content, so it is identical in every clone. Appends a
                    marker rather than editing the line -- the store stays
                    append-only and two clones retiring the same record still
                    merge cleanly. by_entry (optional) names the entry that
                    recorded the correction.
                    refuses with reason "no_such_record" when the key names
                    nothing live, "already_superseded" when it is already
                    retired
  note-prune        flag: --dry-run   (optional: report and write nothing)
                    the ONE operation that rewrites .foreman/notes.jsonl, and
                    never automatic. Removes only what nothing can learn from
                    any more: records whose every stored file is gone, and
                    records a note-supersede marker retired. A marker whose
                    target this file has never carried is kept -- that is the
                    half-merged case, where the line it retires is still
                    inbound. Returns {removed, dropped:{dead,superseded}, kept}
  check-duplicate   stdin JSON: {title, why}
                    word-overlap match against ALL entries regardless of
                    status, archived ones included (archived:true on those);
                    each match includes its status so callers can
                    tell "already declined" from "already on the roadmap"
  doctor            flag: --fix   (optional; read-only without it)
                    checks the whole roadmap and .foreman/config.json against
                    the structural contract every mutation is held to, and
                    prints {ok, findings, summary:{errors,warnings}} -- here
                    ok means "no error-severity finding", not "the call
                    worked" (a failed call still exits 1 with error)
                    each finding: code, severity ("error"|"warning"), the
                    entry ids it concerns, a one-line message, and
                    repairable:true only where the fix is mechanical
                    a duplicate_id/duplicate_across_files finding also carries
                    detail: every holder's title/status/created_at, every
                    entry depending on the id, and how many commits already
                    carry the "Foreman: <id>" trailer (with the first few
                    shas; absent when git cannot be asked) -- the facts
                    "reassign-id" is decided from. No git history is read
                    unless a duplicate is actually present
                    codes: missing_field, invalid_type, invalid_id,
                    duplicate_id, unknown_status, unknown_source,
                    unknown_kind, unknown_model, unknown_effort,
                    invalid_date, invalid_path, invalid_doc,
                    missing_dependency, self_dependency,
                    duplicate_dependency, dependency_cycle,
                    stranded_dependency, similar_titles,
                    terminal_without_evidence, awaiting_without_evidence,
                    unsupported_schema_version,
                    duplicate_across_files, unknown_config_key,
                    invalid_config_value, unreadable_config
                    the whole per-entry contract also runs over
                    .foreman/archive.jsonl (its findings' messages carry that
                    prefix, and --fix never writes that file)
                    --fix applies ONLY the repairable ones (an absent
                    depends_on/planned_touches/observed_touches/commits/
                    notes, a self-dependency
                    edge, a repeated dependency id) under the mutation lock,
                    then re-validates and returns what it changed as
                    "fixed". Ambiguous findings are never auto-fixed --
                    they are reported for a human to decide.
                    A malformed or misplaced format meta line is reported as
                    unsupported_schema_version and repaired by "migrate",
                    never by --fix.
  migrate           no input, no flags. Brings ROADMAP.jsonl (and
                    .foreman/archive.jsonl, when the project has one) up to
                    the current format version, safe to repeat: returns
                    {from, to, changed}, and changed:false when the files are
                    already current (nothing written, no backup). The
                    archive's own {from, changed, backup} rides along as
                    "archive" when that file exists.
                    ROADMAP.jsonl declares its format on an optional first
                    line, {"foreman_roadmap_format":N}; a file without one
                    is format 1. Format 2 split the old single "touches"
                    array into planned_touches (the editable prediction) and
                    observed_touches (derived at close): the 1->2 step is
                    mechanical and runs no git -- the whole old array becomes
                    planned_touches and observed_touches starts empty.
                    READING an older file still works everywhere (it is
                    normalized in memory, the file is untouched). WRITING to
                    one -- any mutation, not just this subcommand -- migrates
                    it first automatically, same backup and all, and reports
                    it as a "migrated" field on that mutation's own result;
                    this subcommand stays the way to do the same upgrade
                    explicitly, with nothing else changing.
                    When it does change a file it first copies it to
                    <file>.backup-<YYYYMMDD-HHmmss> and returns that
                    path as "backup". Holds the same mutation lock as every
                    other write; never touches .foreman/config.json.
                    A file declaring a version NEWER than this Foreman
                    supports fails here and on every other subcommand with
                    one clear error naming both versions -- upgrade the
                    plugin, or migrate with the Foreman that wrote it.

Examples:
  echo '{"title":"Add JWT refresh middleware","why":"...","what":"...","source":"user"}' \\
    | node roadmap.js add
  echo '{"id":"003","status":"done","commit":"a1b2c3d"}' \\
    | node roadmap.js update-status
  echo '{"id":"003","status":"done","commit":"a1b2c3d","add_touches":["docs/migration.md"]}' \\
    | node roadmap.js update-status
  echo '{"id":"003","expected":["src/api"]}' | node safe-commit.js finish --baseline <begin.head> --no-commit
  echo '{"id":"003","status":"done","staged":true}' \\
    | node roadmap.js update-status   # then commit with "Foreman: 003" as the last line
  echo '{"id":"004","add_depends_on":["002"]}' \\
    | node roadmap.js update-deps
  echo '{"id":"004","expected_updated_at":"2026-07-28","expected":{"what":"old what","planned_touches":["src/api"]},"what":"...","planned_touches":["src/api/retry.ts"]}' \\
    | node roadmap.js correct
  echo '{"id":"130","keep":"Cache the rate lookup"}' \\
    | node roadmap.js reassign-id
  echo '{"ids":["001","003"]}' | node roadmap.js archive
  echo '{"ids":["003"]}' | node roadmap.js restore
  node roadmap.js list --archived --summary
  node roadmap.js next-candidates --limit 5
  node roadmap.js doctor
  node roadmap.js doctor --fix
  node roadmap.js migrate
`;

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function main() {
  const [, , sub, ...rest] = process.argv;
  if (!sub || sub === "--help" || sub === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  const root = projectDir();
  let result;
  switch (sub) {
    case "add":
      result = cmdAdd(root, readStdinJSON());
      break;
    case "update-status":
      result = cmdUpdateStatus(root, readStdinJSON());
      break;
    case "annotate":
      result = cmdAnnotate(root, readStdinJSON());
      break;
    case "update-deps":
      result = cmdUpdateDeps(root, readStdinJSON());
      break;
    case "correct":
      result = cmdCorrect(root, readStdinJSON());
      break;
    case "reassign-id":
      result = cmdReassignId(root, readStdinJSON());
      break;
    case "archive":
      result = cmdArchive(root, readStdinJSON());
      break;
    case "restore":
      result = cmdRestore(root, readStdinJSON());
      break;
    case "list":
      result = cmdList(root, parseFlags(rest));
      break;
    case "next-candidates":
      result = cmdNextCandidates(root, parseFlags(rest));
      break;
    case "notes":
      result = cmdNotes(root, parseFlags(rest));
      break;
    case "note-supersede":
      result = cmdNoteSupersede(root, readStdinJSON());
      break;
    case "note-prune":
      result = cmdNotePrune(root, parseFlags(rest));
      break;
    case "check-duplicate":
      result = cmdCheckDuplicate(root, readStdinJSON());
      break;
    case "doctor":
      result = cmdDoctor(root, parseFlags(rest));
      break;
    case "migrate":
      result = cmdMigrate(root);
      break;
    default:
      throw new Error(
        `unknown subcommand: ${sub}. Use add|update-status|annotate|update-deps|correct|reassign-id|archive|restore|list|next-candidates|notes|note-supersede|note-prune|check-duplicate|doctor|migrate`
      );
  }
  process.stdout.write(JSON.stringify({ ok: true, ...result }));
}

// Exported before main() runs, not after: roadmap-doctor.js resolves this
// module lazily to break the require cycle, and a CLI invocation would
// otherwise reach the doctor while these exports were still undefined.
module.exports = {
  projectDir,
  roadmapPath,
  readEntries,
  // [Foreman: 142] The same parser behind readEntries/readArchive, for a
  // reader pointed at a file neither of those names (scripts/health's
  // explicit --archive). Read-only callers only; every writer goes through
  // writeEntries/writeArchive.
  readEntriesFrom,
  writeEntries,
  // [Foreman: 132] The archive half of the storage: same format, same
  // writer, a different path. readEntries stays active-only.
  ARCHIVE_LABEL,
  archivePath,
  readArchive,
  writeArchive,
  nextId,
  today,
  cmdAdd,
  cmdUpdateStatus,
  cmdAnnotate,
  cmdUpdateDeps,
  cmdCorrect,
  cmdReassignId,
  cmdArchive,
  cmdRestore,
  cmdList,
  cmdNextCandidates,
  cmdCheckDuplicate,
  cmdDoctor,
  cmdMigrate,
  // The roadmap's format version: the meta line's key, the version this
  // Foreman writes and accepts, and the shape test the doctor reuses so
  // there is one definition of "that line is the marker, not an entry".
  ROADMAP_FORMAT_KEY,
  CURRENT_ROADMAP_FORMAT,
  isFormatMeta,
  declaredFormat,
  // [Foreman: 130] The 1->2 upgrade, exported so a fixture or a caller that
  // needs the current entry shape uses the same transform migrate does.
  splitTouches,
  UPGRADE_STEPS,
  findingKey,
  isUnsafePath,
  submodulePaths,
  filesTouchedByCommit,
  filesStagedIn,
  coversPath,
  normalizedTouch,
  touchesOverlap,
  scopeDrift,
  driftNote,
  stageRoadmapFile,
  reaches,
  normalizeWords,
  jaccard,
  // The validator vocabulary roadmap-doctor.js checks a whole file against —
  // exported so the doctor uses these definitions rather than a second copy.
  validateDoc,
  validateKind,
  validateRan,
  ID_PATTERN,
  ID_RE,
  isValidId,
  nextId,
  STATUSES,
  SOURCES,
  CREATE_STATUSES,
  TERMINAL_STATUSES,
  KINDS,
  MODELS,
  EFFORTS,
  DUPLICATE_THRESHOLD,
  MAX_MATCHES,
  // [Foreman: 177] The one definition of "still correctable", exported so the
  // usage text, the skill branch, and their drift test all read it instead of
  // each keeping a copy that can fall behind.
  CORRECTABLE_STATUSES,
  DECISION_ANCHOR_RE,
  anchorIdsIn,
  anchorHasId,
  COMMIT_TRAILER_RE,
  commitTrailerFor,
  trailerIdsIn,
  // [Foreman: 178] The stamp cmdCorrect writes, exported so
  // scripts/health/roadmap-health.js counts the string this script
  // actually writes rather than a second copy of it.
  CORRECTION_MARKER,
  USAGE,
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}
