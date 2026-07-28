#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { withRoadmapLock } = require("./roadmap-lock");
const {
  validateEntries,
  validateConfig,
  applyRepairs,
  summarize,
} = require("./roadmap-doctor");

function projectDir() {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

function roadmapPath(root) {
  return path.join(root, "ROADMAP.jsonl");
}

function readEntries(root) {
  const p = roadmapPath(root);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf-8").split("\n");
  const entries = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      throw new Error(`ROADMAP.jsonl line ${i + 1} is not valid JSON: ${err.message}`);
    }
    entries.push(obj);
  });
  return entries;
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
function existingErrorKeys(root) {
  try {
    return validateEntries(readEntries(root), { similarity: false })
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
function writeEntries(root, entries) {
  const allowed = new Set(existingErrorKeys(root));
  const blocking = validateEntries(entries, { similarity: false })
    .filter((item) => item.severity === "error" && !allowed.has(findingKey(item)));
  if (blocking.length) {
    const detail = blocking.slice(0, 3).map((item) => `${item.code}: ${item.message}`).join("; ");
    throw new Error(
      `refusing to write ROADMAP.jsonl — the result would violate the roadmap contract `
        + `(${blocking.length} error${blocking.length === 1 ? "" : "s"}): ${detail}`
        + `. Run "roadmap.js doctor" for the full report`
    );
  }
  const p = roadmapPath(root);
  const text = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, "utf-8");
  try {
    fs.renameSync(tmp, p);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw err;
  }
  readEntries(root); // throws if the write somehow produced malformed JSONL
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

// Anchor comment format pointing code at its decision-log doc: `[Foreman: 019]`
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

const STATUSES = new Set(["planned", "in_progress", "deferred", "done", "dropped", "rejected"]);
const SOURCES = new Set(["user", "claude-suggested"]);
// Statuses nothing is waiting on any more: the entry will not move again, so
// a dependent of a dropped/rejected one is stranded rather than blocked.
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
function appendNote(existing, note) {
  const line = `${today()} ${note}`;
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

// `doc` is a forced choice, not a free-text field: exactly "none" (this
// task decided nothing worth an ADR) or a relative .md path into the
// project's decision-log dir. Same trust boundary as depends_on ids/
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
    touches,
    notes,
    doc,
    kind,
  } = payload || {};
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
  // Same trust boundary update-deps already guards: an id that doesn't
  // resolve strands the entry out of next-candidates permanently — the
  // guard hook denies the hand-edit repair and depends_on only ever grows.
  // Self-reference and cycles stay unreachable here: id comes from nextId,
  // so it isn't in entries yet and nothing can reference it.
  const deps = Array.isArray(depends_on) ? depends_on : [];
  const knownIds = new Set(entries.map((e) => e.id));
  const unknown = deps.filter((dep) => !knownIds.has(dep));
  if (unknown.length) throw new Error(`unknown depends_on id(s): ${unknown.join(", ")}`);
  const id = nextId(entries);
  const date = today();
  const entry = {
    id,
    title,
    why,
    what,
    status: entryStatus,
    source,
    depends_on: deps,
    touches: Array.isArray(touches) ? touches : [],
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
  writeEntries(root, entries);
  const warnings = fieldWarnings([
    ["why", why, WHY_WARN_CHARS],
    ["what", what, WHAT_WARN_CHARS],
  ]);
  return warnings.length ? { entry, warnings } : { entry };
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

// Runs one git file-listing command at the root, then in each submodule until
// one yields files, prefixing a submodule's paths so they read exactly the way
// `touches` does. Fail-soft throughout: a missing git binary, a non-git
// project, or an unknown sha all just mean no derived paths.
function gitFilesIn(root, args, keep) {
  const runIn = (cwd) => {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] })
        .split("\n")
        .map((line) => line.trim())
        .filter(keep);
    } catch {
      return [];
    }
  };

  const atRoot = runIn(root);
  if (atRoot.length) return atRoot;
  for (const sub of submodulePaths(root)) {
    const files = runIn(path.join(root, sub));
    if (files.length) return files.map((file) => `${sub}/${file}`);
  }
  return [];
}

function filesTouchedByCommit(root, sha) {
  return gitFilesIn(root, ["show", "--pretty=format:", "--name-only", "--relative", sha], Boolean);
}

// The staged-close twin of filesTouchedByCommit: the index instead of a
// landed commit, so a close can derive touches BEFORE the commit exists
// and ride inside it. Same fail-soft contract. ROADMAP.jsonl itself is
// dropped — the close is about to stage it, and it isn't task footprint.
function filesStagedIn(root) {
  return gitFilesIn(
    root,
    ["diff", "--cached", "--name-only", "--relative"],
    (f) => f && f !== "ROADMAP.jsonl"
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
function coversPath(predicted, actual) {
  const base = predicted.replace(/\/+$/, "");
  return actual === base || actual.startsWith(`${base}/`);
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

// Best-effort `git add ROADMAP.jsonl` so a staged close needs no extra
// caller step to fold the roadmap change into the pending commit. False
// (git absent / not a repo) never fails the close — the caller just
// stages the file itself.
function stageRoadmapFile(root) {
  try {
    execFileSync("git", ["add", "ROADMAP.jsonl"], {
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

function graphState(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const done = new Set(entries.filter((entry) => entry.status === "done").map((entry) => entry.id));
  const ready = new Set(
    entries
      .filter((entry) => entry.status === "planned")
      .filter((entry) => (entry.depends_on || []).every((dependency) => done.has(dependency)))
      .map((entry) => entry.id)
  );
  const stranded = new Set(
    entries
      .filter((entry) => !TERMINAL_STATUSES.has(entry.status))
      .filter((entry) =>
        (entry.depends_on || []).some((dependency) => {
          const parent = byId.get(dependency);
          return !parent || (TERMINAL_STATUSES.has(parent.status) && parent.status !== "done");
        })
      )
      .map((entry) => entry.id)
  );
  return { ready, stranded };
}

function graphFacts(beforeEntries, afterEntries, options = {}) {
  const before = graphState(beforeEntries);
  const after = graphState(afterEntries);
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
  if (add_touches !== undefined && !Array.isArray(add_touches)) {
    throw new Error("add_touches must be an array of paths");
  }
  if (doc !== undefined) validateDoc(doc);
  if (kind !== undefined) validateKind(kind);
  if (model !== undefined) validateRan("model", model, MODELS);
  if (effort !== undefined) validateRan("effort", effort, EFFORTS);
  const entries = readEntries(root);
  const beforeEntries = entries.map((entry) => ({
    ...entry,
    depends_on: [...(entry.depends_on || [])],
  }));
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(`no entry with id ${id}`);
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
        const dependency = byId.get(dependencyId);
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
  // touches is a growing footprint, same append-only spirit as commits — the
  // creation-time guess stays, and both what the commit's diff actually
  // shows (or, for a staged close, the index) and whatever add_touches
  // names get folded in instead of leaving the record stale.
  const derivedTouches = commit
    ? filesTouchedByCommit(root, commit)
    : staged
      ? filesStagedIn(root)
      : [];
  // [Foreman: 110] Snapshot the prediction before the fold destroys it.
  const predictedTouches = Array.isArray(entry.touches) ? [...entry.touches] : [];
  const newTouches = [...(add_touches || []), ...derivedTouches];
  if (newTouches.length) {
    entry.touches = Array.isArray(entry.touches) ? entry.touches : [];
    for (const t of newTouches) {
      if (typeof t === "string" && t && !entry.touches.includes(t)) entry.touches.push(t);
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
  entry.updated_at = today();
  writeEntries(root, entries);
  const warnings = notes ? fieldWarnings([["notes", notes, NOTES_APPEND_WARN_CHARS, NOTES_WARN_HINT]]) : [];
  const result = { entry, ...graphFacts(beforeEntries, entries, { omit: [id] }) };
  if (derivedTouches.length) result.derived_touches = derivedTouches;
  if (drift && (drift.untouched.length || drift.unpredicted.length)) result.scope_drift = drift;
  // A staged close hands back the exact trailer line the commit message
  // must carry — the entry↔commit link the recorded sha used to be.
  if (staged) {
    result.trailer = commitTrailerFor(id);
    result.roadmap_staged = stageRoadmapFile(root);
  }
  return warnings.length ? { ...result, warnings } : result;
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
  if (!entry) throw new Error(`no entry with id ${id}`);
  // append-only invariant: never replace existing notes
  entry.notes = appendNote(entry.notes, notes);
  entry.updated_at = today();
  writeEntries(root, entries);
  const warnings = fieldWarnings([["notes", notes, NOTES_APPEND_WARN_CHARS, NOTES_WARN_HINT]]);
  return warnings.length ? { entry, warnings } : { entry };
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
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(`no entry with id ${id}`);
  const knownIds = new Set(entries.map((e) => e.id));
  const unknown = adds.filter((dep) => !knownIds.has(dep));
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
  writeEntries(root, entries);
  return { entry, ...graphFacts(beforeEntries, entries) };
}

// The fields a stale plan gets wrong that no other command can repair:
// status is update-status', depends_on is update-deps', notes is append-only
// on purpose. Git is the audit trail for what these used to say -- the active
// entry carries the best-known truth, not a museum of obsolete prose.
const CORRECTABLE_TEXT = ["title", "why", "what"];
const CORRECTABLE_FIELDS = [...CORRECTABLE_TEXT, "kind", "touches"];
// Only an entry still being worked toward is correctable. Rewriting a
// done/dropped/rejected one rewrites history: its commits, notes, and closure
// evidence describe the task as it was worded then.
const CORRECTABLE_STATUSES = new Set(["planned", "in_progress", "deferred"]);

function cmdCorrect(root, payload) {
  return withRoadmapLock(root, () => cmdCorrectUnlocked(root, payload));
}

function cmdCorrectUnlocked(root, payload) {
  const { id, expected_updated_at, kind, touches } = payload || {};
  if (!id) throw new Error("correct requires id");
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
  // Same shape check add_touches gets; per-path safety is the write gate's
  // (invalid_path / non-string item), so it is not restated here.
  if (touches !== undefined && !Array.isArray(touches)) {
    throw new Error("touches must be an array of paths");
  }
  if (!Object.keys(text).length && kind === undefined && touches === undefined) {
    throw new Error(`correct requires at least one of ${CORRECTABLE_FIELDS.join(", ")}`);
  }
  const entries = readEntries(root);
  const beforeEntries = entries.map((entry) => ({
    ...entry,
    depends_on: [...(entry.depends_on || [])],
  }));
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(`no entry with id ${id}`);
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
  // add's exact-title replay dedup is only safe while titles stay unique.
  if (text.title !== undefined) {
    const clash = entries.find((other) => other.id !== id && other.title === text.title);
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
  // Full replacement, unlike update-status' append-only fold: this field is
  // the mutable prediction of the surface the work will touch, and a
  // prediction that was wrong has to be able to shrink.
  if (touches !== undefined) {
    const current = Array.isArray(entry.touches) ? entry.touches : [];
    if (current.length !== touches.length || current.some((p, i) => p !== touches[i])) {
      entry.touches = touches;
      changed.push("touches");
    }
  }
  // A correction that changes nothing writes nothing — including updated_at,
  // which is the very value every other session's guard is holding.
  if (changed.length) {
    entry.updated_at = today();
    writeEntries(root, entries);
  }
  const warnings = fieldWarnings([
    ["why", text.why, WHY_WARN_CHARS],
    ["what", text.what, WHAT_WARN_CHARS],
  ]);
  // No correctable field touches status or depends_on, so these are always
  // empty today. Wired anyway so a later correctable field inherits it.
  const result = { entry, changed, ...graphFacts(beforeEntries, entries) };
  return warnings.length ? { ...result, warnings } : result;
}

function cmdList(root, filters) {
  const entries = readEntries(root);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const statusFilter = filters.status ? new Set(String(filters.status).split(",")) : null;
  const idsFilter = filters.ids ? new Set(String(filters.ids).split(",")) : null;
  let filtered = entries;
  if (statusFilter) filtered = filtered.filter((e) => statusFilter.has(e.status));
  if (idsFilter) filtered = filtered.filter((e) => idsFilter.has(e.id));
  // --summary keeps the fields a whole-roadmap render actually needs (id,
  // title, status, plus depends_on so blocked-ness stays derivable) and
  // drops the prose — on a large roadmap the full entries are most of the
  // payload, re-sent into context on every review.
  if (filters.summary) {
    filtered = filtered.map((e) => ({
      id: e.id,
      title: e.title,
      status: e.status,
      depends_on: e.depends_on || [],
    }));
  } else if (idsFilter) {
    // A targeted detail read is the post-menu preparation path. Carry only
    // the direct dependencies' decision-document pointers so the caller can
    // honor settled decisions without loading those dependency entries too.
    // Whole-roadmap list output remains the stored entries unchanged.
    filtered = filtered.map((e) => ({
      ...e,
      depends_on_docs: dependencyDocs(e, byId),
    }));
  }
  return { entries: filtered };
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
const OPEN_STATUSES = new Set(["planned", "in_progress", "deferred"]);

// Fraction of the hint's own words found in the entry's text — containment,
// not jaccard, so a long entry isn't penalized for having words the hint
// didn't mention.
function hintScore(hintWords, entry) {
  if (!hintWords.size) return 0;
  const words = normalizeWords(
    [entry.title, entry.why, entry.what, (entry.touches || []).join(" "), entry.notes]
      .filter(Boolean)
      .join(" ")
  );
  let hit = 0;
  for (const w of hintWords) if (words.has(w)) hit += 1;
  return hit / hintWords.size;
}

// Mechanical filter + rank for "what should I work on next" — no stored,
// staleness-prone priority field. unblocks (how much open work depends on
// this entry, directly and down the chain) is a derived proxy for
// importance instead.
function cmdNextCandidates(root, filters) {
  const limit = filters && filters.limit ? parseInt(filters.limit, 10) : 3;
  const hintWords = normalizeWords(filters && typeof filters.hint === "string" ? filters.hint : "");
  const entries = readEntries(root);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const doneIds = new Set(entries.filter((e) => e.status === "done").map((e) => e.id));

  const inProgressTouches = new Set();
  for (const e of entries) {
    if (e.status !== "in_progress") continue;
    for (const t of e.touches || []) inProgressTouches.add(t);
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
    .filter((e) => e.status === "planned")
    .filter((e) => (e.depends_on || []).every((dep) => doneIds.has(dep)))
    .map((e) => ({
      id: e.id,
      title: e.title,
      why: e.why,
      what: e.what,
      touches: e.touches || [],
      depends_on: e.depends_on || [],
      unblocks: (openDependents.get(e.id) || []).length,
      unblocks_total: transitiveUnblocks(e.id),
      ...(hintWords.size ? { hint_score: hintScore(hintWords, e) } : {}),
      collision: (e.touches || []).some((t) => inProgressTouches.has(t)),
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
      touches: e.touches || [],
      depends_on: e.depends_on || [],
      notes: e.notes || "",
      updated_at: e.updated_at,
      ...(e.doc !== undefined ? { doc: e.doc } : {}),
      ...(e.kind !== undefined ? { kind: e.kind } : {}),
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
  };
  // hint_matched tells the caller whether relevance actually reordered
  // anything — all-zero scores mean the list below is just the standard
  // ranking, and the caller should say the hint found nothing.
  if (filters && filters.hint !== undefined) {
    result.hint_matched = unblocked.some((c) => (c.hint_score || 0) > 0);
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
  const matches = readEntries(root)
    .map((e) => ({
      id: e.id,
      title: e.title,
      status: e.status,
      score: jaccard(words, normalizeWords(`${e.title || ""} ${e.why || ""}`)),
    }))
    .filter((m) => m.score >= DUPLICATE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHES);
  return { duplicate: matches.length > 0, matches };
}

// Whole-file health check: the same structural contract every write is held
// to, plus the settings file, reported instead of thrown. Read-only unless
// --fix is passed. `ok` here answers "is the roadmap healthy" — the one
// subcommand where it is not just "did the call succeed"; a failed call
// still exits 1 with an `error` field, as everywhere else.
function cmdDoctor(root, flags) {
  if (!flags || !flags.fix) {
    return summarize([...validateEntries(readEntries(root)), ...validateConfig(root)]);
  }
  return withRoadmapLock(root, () => {
    // Re-read inside the lock: the read that produced a finding must be the
    // read the repair is applied to.
    const entries = readEntries(root);
    const fixed = applyRepairs(entries, validateEntries(entries));
    // The write gate tolerates what the file already had, so a partial
    // repair is never blocked by the damage it cannot fix.
    if (fixed.length) writeEntries(root, entries);
    // Re-validate from disk, not from memory — the report describes the file
    // that now exists.
    return {
      ...summarize([...validateEntries(readEntries(root)), ...validateConfig(root)]),
      fixed,
    };
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
{"ok":false,"error":"..."} (exit 1) on failure.

  add               stdin JSON: {title, why, what, source, depends_on?, touches?, notes?, status?, doc?, kind?}
                    source: "user" | "claude-suggested"
                    depends_on ids must already exist -- an id that doesn't
                    resolve would strand the entry out of next-candidates
                    status (create-time only): "planned" (default) | "rejected"
                    doc: "none" | a relative path ending in .md (no leading
                    slash, no drive letter, no ".." segments) -- a forced
                    choice, omitted entirely (not defaulted) when not given
                    kind: "build" (default, never stored) | "decision" (resolve
                    an open question, no code) -- only "decision" is stored;
                    the pick flow hands a decision entry a "decide, don't build" rule
                    an exact existing title returns that entry with
                    deduped:true; intentional separate tasks need distinct
                    titles so every add remains safe to replay
  update-status     stdin JSON: {id, status, commit?, staged?, notes?, add_touches?, doc?, kind?, model?, effort?, expected_status?, require_ready?}
                    status: "planned" | "in_progress" | "deferred" | "done" | "dropped" | "rejected"
                    "deferred" = recorded but waiting on an external trigger;
                    excluded from next-candidates until moved back to "planned"
                    if commit is given, touches auto-folds in that commit's
                    actual changed files (git show, best-effort, silent if
                    git/the sha is unavailable) -- add_touches adds more on
                    top, for anything outside that commit's diff
                    staged: true = the staged close -- call it AFTER "git add
                    -A" and BEFORE committing: touches auto-folds from the
                    index instead of a commit, the script stages
                    ROADMAP.jsonl itself, and the result carries trailer
                    ("Foreman: <id>") to put as the commit message's final
                    line -- entry and commit link through that trailer, so
                    the close lands inside its own commit with no sha
                    recorded and no roadmap ride-along. Mutually exclusive
                    with commit (which records one that already landed).
                    add_touches: array of paths to fold into touches (dedup, never removes)
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
  correct           stdin JSON: {id, expected_updated_at, title?, why?, what?, kind?, touches?}
                    the supported repair for an entry whose description or
                    planned files went stale -- at least one correctable
                    field is required, each is a full replacement (title/why/
                    what non-empty strings, touches the whole planned
                    surface -- so a wrong prediction can shrink -- kind on
                    add's contract: "decision" stored, "build" drops the key)
                    expected_updated_at is required and must equal the
                    entry's current updated_at, so a stale session cannot
                    overwrite a newer correction; a mismatch names the
                    current value and writes nothing
                    only planned/in_progress/deferred entries are
                    correctable -- done/dropped/rejected is history its
                    commits already describe
                    a title equal to another entry's is refused: titles are
                    add's exact-replay key. Git is the audit trail for what
                    the entry used to say
                    returns changed:[...] listing only the fields that
                    actually differed, plus the same compact graph-fact
                    fields when non-empty
  list              flag: --status planned,in_progress   (optional, comma-separated)
                    flag: --ids 002,005   (optional, comma-separated, combinable with --status)
                    targeted full rows add depends_on_docs (direct
                    dependency document paths only)
                    flag: --summary   (optional: entries carry only
                    id/title/status/depends_on -- use for whole-roadmap
                    renders, then fetch the few needing prose via --ids)
  next-candidates   flag: --limit N   (optional, default 3)
                    flag: --menu   (optional: compact choice rows only;
                    fetch the selected entry with list --ids <id>)
                    flag: --hint "words"   (optional: rank by how many of
                    the hint's words appear in each candidate's
                    title/why/what/touches/notes -- hint_score per
                    candidate, hint_matched:false in the result when no
                    candidate matched at all)
                    candidates include depends_on, unblocks (open entries
                    depending directly), and unblocks_total (the whole
                    open chain behind it); ranked unblocks_total, then
                    unblocks, then no-collision, then oldest
  check-duplicate   stdin JSON: {title, why}
                    word-overlap match against ALL entries regardless of
                    status; each match includes its status so callers can
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
                    codes: missing_field, invalid_type, invalid_id,
                    duplicate_id, unknown_status, unknown_source,
                    unknown_kind, unknown_model, unknown_effort,
                    invalid_date, invalid_path, invalid_doc,
                    missing_dependency, self_dependency,
                    duplicate_dependency, dependency_cycle,
                    stranded_dependency, similar_titles,
                    terminal_without_evidence, unsupported_schema_version,
                    unknown_config_key, invalid_config_value,
                    unreadable_config
                    --fix applies ONLY the repairable ones (absent
                    depends_on/touches/commits/notes, a self-dependency
                    edge, a repeated dependency id) under the mutation lock,
                    then re-validates and returns what it changed as
                    "fixed". Ambiguous findings are never auto-fixed --
                    they are reported for a human to decide.

Examples:
  echo '{"title":"Add JWT refresh middleware","why":"...","what":"...","source":"user"}' \\
    | node roadmap.js add
  echo '{"id":"003","status":"done","commit":"a1b2c3d"}' \\
    | node roadmap.js update-status
  echo '{"id":"003","status":"done","commit":"a1b2c3d","add_touches":["docs/migration.md"]}' \\
    | node roadmap.js update-status
  git add -A && echo '{"id":"003","status":"done","staged":true}' \\
    | node roadmap.js update-status   # then commit with "Foreman: 003" as the last line
  echo '{"id":"004","add_depends_on":["002"]}' \\
    | node roadmap.js update-deps
  echo '{"id":"004","expected_updated_at":"2026-07-28","what":"...","touches":["src/api/retry.ts"]}' \\
    | node roadmap.js correct
  node roadmap.js next-candidates --limit 5
  node roadmap.js doctor
  node roadmap.js doctor --fix
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
    case "list":
      result = cmdList(root, parseFlags(rest));
      break;
    case "next-candidates":
      result = cmdNextCandidates(root, parseFlags(rest));
      break;
    case "check-duplicate":
      result = cmdCheckDuplicate(root, readStdinJSON());
      break;
    case "doctor":
      result = cmdDoctor(root, parseFlags(rest));
      break;
    default:
      throw new Error(
        `unknown subcommand: ${sub}. Use add|update-status|annotate|update-deps|correct|list|next-candidates|check-duplicate|doctor`
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
  writeEntries,
  nextId,
  today,
  cmdAdd,
  cmdUpdateStatus,
  cmdAnnotate,
  cmdUpdateDeps,
  cmdCorrect,
  cmdList,
  cmdNextCandidates,
  cmdCheckDuplicate,
  cmdDoctor,
  findingKey,
  submodulePaths,
  filesTouchedByCommit,
  filesStagedIn,
  coversPath,
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
  DECISION_ANCHOR_RE,
  anchorIdsIn,
  anchorHasId,
  COMMIT_TRAILER_RE,
  commitTrailerFor,
  trailerIdsIn,
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
