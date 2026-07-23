#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

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

// parse-before-write + parse-after-write invariants, enforced here instead of by prose.
// Temp-file-then-rename so a crash mid-write leaves the old file intact —
// same directory, so the rename can't cross filesystems.
function writeEntries(root, entries) {
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
// or multi-id `[Foreman: 019, 034]` -- 3-digit zero-padded ids only, comma-
// separated, spaces around the comma optional. Exported so the close gate
// and the anchor tripwire hook share one definition instead of two regexes
// drifting apart. A trailing/leading digit run outside the exact {3} width
// (e.g. a 4-digit id) fails the whole bracketed match rather than partially
// matching -- deliberate, ids are always zero-padded to exactly 3 digits.
const DECISION_ANCHOR_RE = /\[Foreman:\s*\d{3}(?:\s*,\s*\d{3})*\s*\]/g;

// All 3-digit ids named across every anchor comment in `text`, deduped,
// first-seen order. String.prototype.matchAll clones the regex per call,
// so the shared `g` flag's lastIndex never leaks across calls or into
// other consumers of DECISION_ANCHOR_RE.
function anchorIdsIn(text) {
  if (!text) return [];
  const ids = [];
  const seen = new Set();
  for (const match of String(text).matchAll(DECISION_ANCHOR_RE)) {
    for (const id of match[0].match(/\d{3}/g) || []) {
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
// before committing. Same 3-digit zero-padded grammar as the decision
// anchors, unbracketed because trailers follow git's `Key: value` shape.
const COMMIT_TRAILER_RE = /^Foreman:\s*\d{3}(?:\s*,\s*\d{3})*\s*$/gm;

function commitTrailerFor(id) {
  return `Foreman: ${id}`;
}

// All 3-digit ids named across every trailer line in `text` (a commit
// message), deduped, first-seen order. matchAll clones the regex, so the
// shared `g` flag's lastIndex never leaks across calls.
function trailerIdsIn(text) {
  if (!text) return [];
  const ids = [];
  const seen = new Set();
  for (const match of String(text).matchAll(COMMIT_TRAILER_RE)) {
    for (const id of match[0].match(/\d{3}/g) || []) {
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
// A newly created entry only ever starts as planned or rejected — nothing
// gets created already in_progress/deferred/done/dropped, those are
// transitions applied later via update-status.
const CREATE_STATUSES = new Set(["planned", "rejected"]);

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

function cmdAdd(root, payload) {
  const { title, why, what, source, status, depends_on, touches, notes, doc } = payload || {};
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
  const entries = readEntries(root);
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
function filesTouchedByCommit(root, sha) {
  try {
    const out = execFileSync(
      "git",
      ["show", "--pretty=format:", "--name-only", "--relative", sha],
      { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    );
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// The staged-close twin of filesTouchedByCommit: the index instead of a
// landed commit, so a close can derive touches BEFORE the commit exists
// and ride inside it. Same fail-soft contract. ROADMAP.jsonl itself is
// dropped — the close is about to stage it, and it isn't task footprint.
function filesStagedIn(root) {
  try {
    const out = execFileSync(
      "git",
      ["diff", "--cached", "--name-only", "--relative"],
      { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    );
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter((f) => f && f !== "ROADMAP.jsonl");
  } catch {
    return [];
  }
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

function cmdUpdateStatus(root, payload) {
  const { id, status, commit, staged, notes, add_touches, doc } = payload || {};
  if (!id || !status) throw new Error("update-status requires id, status");
  if (!STATUSES.has(status)) {
    throw new Error(`status must be one of ${[...STATUSES].join("|")}`);
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
  const entries = readEntries(root);
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(`no entry with id ${id}`);
  entry.status = status;
  if (doc !== undefined) entry.doc = doc;
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
  const newTouches = [...(add_touches || []), ...derivedTouches];
  if (newTouches.length) {
    entry.touches = Array.isArray(entry.touches) ? entry.touches : [];
    for (const t of newTouches) {
      if (typeof t === "string" && t && !entry.touches.includes(t)) entry.touches.push(t);
    }
  }
  entry.updated_at = today();
  writeEntries(root, entries);
  const warnings = notes ? fieldWarnings([["notes", notes, NOTES_APPEND_WARN_CHARS, NOTES_WARN_HINT]]) : [];
  const result = { entry };
  if (derivedTouches.length) result.derived_touches = derivedTouches;
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
  const { id, add_depends_on, remove_depends_on } = payload || {};
  const adds = Array.isArray(add_depends_on) ? add_depends_on : [];
  const removes = Array.isArray(remove_depends_on) ? remove_depends_on : [];
  if (!id || (!adds.length && !removes.length)) {
    throw new Error("update-deps requires id and a non-empty add_depends_on or remove_depends_on array");
  }
  const entries = readEntries(root);
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
  return { entry };
}

function cmdList(root, filters) {
  const entries = readEntries(root);
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
  }
  return { entries: filtered };
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
      ...(e.doc !== undefined ? { doc: e.doc } : {}),
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

  // in_progress entries ride along (full-ish fields — there are rarely more
  // than a couple): the pick flow offers to finish existing work before
  // starting new work, and re-crafting a resume prompt needs the entry's
  // substance without a second CLI call.
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
    }));

  const result = {
    candidates: unblocked.slice(0, limit),
    total_unblocked: unblocked.length,
    in_progress: inProgress,
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

  add               stdin JSON: {title, why, what, source, depends_on?, touches?, notes?, status?, doc?}
                    source: "user" | "claude-suggested"
                    depends_on ids must already exist -- an id that doesn't
                    resolve would strand the entry out of next-candidates
                    status (create-time only): "planned" (default) | "rejected"
                    doc: "none" | a relative path ending in .md (no leading
                    slash, no drive letter, no ".." segments) -- a forced
                    choice, omitted entirely (not defaulted) when not given
  update-status     stdin JSON: {id, status, commit?, staged?, notes?, add_touches?, doc?}
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
  annotate          stdin JSON: {id, notes}
                    appends notes and bumps updated_at without touching
                    status -- use for a breadcrumb write so a stale status
                    read never regresses an entry another session moved
  update-deps       stdin JSON: {id, add_depends_on?, remove_depends_on?}
                    at least one must be a non-empty array of ids --
                    remove_depends_on is the recovery path when a dependency
                    was later dropped; removing an id that isn't there is a
                    no-op
  list              flag: --status planned,in_progress   (optional, comma-separated)
                    flag: --ids 002,005   (optional, comma-separated, combinable with --status)
                    flag: --summary   (optional: entries carry only
                    id/title/status/depends_on -- use for whole-roadmap
                    renders, then fetch the few needing prose via --ids)
  next-candidates   flag: --limit N   (optional, default 3)
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
  node roadmap.js next-candidates --limit 5
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
    case "list":
      result = cmdList(root, parseFlags(rest));
      break;
    case "next-candidates":
      result = cmdNextCandidates(root, parseFlags(rest));
      break;
    case "check-duplicate":
      result = cmdCheckDuplicate(root, readStdinJSON());
      break;
    default:
      throw new Error(
        `unknown subcommand: ${sub}. Use add|update-status|annotate|update-deps|list|next-candidates|check-duplicate`
      );
  }
  process.stdout.write(JSON.stringify({ ok: true, ...result }));
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
  cmdList,
  cmdNextCandidates,
  cmdCheckDuplicate,
  filesTouchedByCommit,
  filesStagedIn,
  stageRoadmapFile,
  reaches,
  normalizeWords,
  jaccard,
  DECISION_ANCHOR_RE,
  anchorIdsIn,
  anchorHasId,
  COMMIT_TRAILER_RE,
  commitTrailerFor,
  trailerIdsIn,
  USAGE,
};
