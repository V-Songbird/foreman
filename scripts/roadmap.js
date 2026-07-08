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
function writeEntries(root, entries) {
  const p = roadmapPath(root);
  const text = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
  fs.writeFileSync(p, text, "utf-8");
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

function today() {
  return new Date().toISOString().slice(0, 10);
}

const STATUSES = new Set(["planned", "in_progress", "done", "dropped", "rejected"]);
const SOURCES = new Set(["user", "claude-suggested"]);
// A newly created entry only ever starts as planned or rejected — nothing
// gets created already in_progress/done/dropped, those are transitions
// applied later via update-status.
const CREATE_STATUSES = new Set(["planned", "rejected"]);

// Soft caps, not hard limits — every entry gets re-read on every `list`,
// so a wall-of-text why/notes multiplies cost across every future call.
// Dense means specific (exact paths/symbols), not exhaustive prose.
const WHY_WARN_CHARS = 240;
const WHAT_WARN_CHARS = 400;
const NOTES_APPEND_WARN_CHARS = 240;

function fieldWarnings(fields) {
  const warnings = [];
  for (const [name, text, max] of fields) {
    if (text && text.length > max) {
      warnings.push(
        `${name} is ${text.length} chars — aim for under ${max} (roughly 1-2 sentences). ` +
          "Dense means specific (exact paths/symbols), not an exhaustive essay."
      );
    }
  }
  return warnings;
}

function cmdAdd(root, payload) {
  const { title, why, what, source, status, depends_on, touches, notes } = payload || {};
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
  const entries = readEntries(root);
  const id = nextId(entries);
  const date = today();
  const entry = {
    id,
    title,
    why,
    what,
    status: entryStatus,
    source,
    depends_on: Array.isArray(depends_on) ? depends_on : [],
    touches: Array.isArray(touches) ? touches : [],
    commits: [],
    created_at: date,
    updated_at: date,
    notes: notes || "",
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

function cmdUpdateStatus(root, payload) {
  const { id, status, commit, notes, add_touches } = payload || {};
  if (!id || !status) throw new Error("update-status requires id, status");
  if (!STATUSES.has(status)) {
    throw new Error(`status must be one of ${[...STATUSES].join("|")}`);
  }
  if (add_touches !== undefined && !Array.isArray(add_touches)) {
    throw new Error("add_touches must be an array of paths");
  }
  const entries = readEntries(root);
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(`no entry with id ${id}`);
  entry.status = status;
  if (commit) {
    entry.commits = Array.isArray(entry.commits) ? entry.commits : [];
    if (!entry.commits.includes(commit)) entry.commits.push(commit);
  }
  if (notes) {
    // append-only invariant: never replace existing notes
    entry.notes = entry.notes ? `${entry.notes}; ${notes}` : notes;
  }
  // touches is a growing footprint, same append-only spirit as commits — the
  // creation-time guess stays, and both what the commit's diff actually
  // shows and whatever add_touches names get folded in instead of leaving
  // the record stale.
  const derivedTouches = commit ? filesTouchedByCommit(root, commit) : [];
  const newTouches = [...(add_touches || []), ...derivedTouches];
  if (newTouches.length) {
    entry.touches = Array.isArray(entry.touches) ? entry.touches : [];
    for (const t of newTouches) {
      if (typeof t === "string" && t && !entry.touches.includes(t)) entry.touches.push(t);
    }
  }
  entry.updated_at = today();
  writeEntries(root, entries);
  const warnings = notes ? fieldWarnings([["notes", notes, NOTES_APPEND_WARN_CHARS]]) : [];
  const result = { entry };
  if (derivedTouches.length) result.derived_touches = derivedTouches;
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
  const { id, add_depends_on } = payload || {};
  if (!id || !Array.isArray(add_depends_on) || !add_depends_on.length) {
    throw new Error("update-deps requires id and a non-empty add_depends_on array");
  }
  const entries = readEntries(root);
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(`no entry with id ${id}`);
  const knownIds = new Set(entries.map((e) => e.id));
  const unknown = add_depends_on.filter((dep) => !knownIds.has(dep));
  if (unknown.length) throw new Error(`unknown depends_on id(s): ${unknown.join(", ")}`);
  if (add_depends_on.includes(id)) throw new Error("a task cannot depend on itself");
  // A cycle can only be introduced here — add sets depends_on once, at
  // creation, when no other entry can reference the not-yet-existing id.
  const cyclic = add_depends_on.filter((dep) => reaches(entries, dep, id));
  if (cyclic.length) {
    throw new Error(
      `depends_on id(s) would create a cycle back to ${id}: ${cyclic.join(", ")}`
    );
  }
  entry.depends_on = Array.isArray(entry.depends_on) ? entry.depends_on : [];
  for (const dep of add_depends_on) {
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
  return { entries: filtered };
}

// Mechanical filter + rank for "what should I work on next" — no stored,
// staleness-prone priority field. unblocks (how many other entries depend
// on this one) is a derived proxy for importance instead.
function cmdNextCandidates(root, filters) {
  const limit = filters && filters.limit ? parseInt(filters.limit, 10) : 3;
  const entries = readEntries(root);
  const doneIds = new Set(entries.filter((e) => e.status === "done").map((e) => e.id));

  const inProgressTouches = new Set();
  for (const e of entries) {
    if (e.status !== "in_progress") continue;
    for (const t of e.touches || []) inProgressTouches.add(t);
  }

  const unblocksCount = new Map();
  for (const e of entries) {
    for (const dep of e.depends_on || []) {
      unblocksCount.set(dep, (unblocksCount.get(dep) || 0) + 1);
    }
  }

  const unblocked = entries
    .filter((e) => e.status === "planned")
    .filter((e) => (e.depends_on || []).every((dep) => doneIds.has(dep)))
    .map((e) => ({
      id: e.id,
      title: e.title,
      why: e.why,
      what: e.what,
      touches: e.touches || [],
      depends_on: e.depends_on || [],
      unblocks: unblocksCount.get(e.id) || 0,
      collision: (e.touches || []).some((t) => inProgressTouches.has(t)),
      created_at: e.created_at,
      notes: e.notes || "",
    }))
    .sort((a, b) => {
      if (b.unblocks !== a.unblocks) return b.unblocks - a.unblocks;
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });

  return { candidates: unblocked.slice(0, limit), total_unblocked: unblocked.length };
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

// Cheap word-overlap check against rejected entries — not semantic understanding,
// just enough to stop re-asking about something already declined.
function cmdCheckDuplicate(root, payload) {
  const { title, why } = payload || {};
  if (!title && !why) throw new Error("check-duplicate requires title and/or why");
  const words = normalizeWords(`${title || ""} ${why || ""}`);
  const rejected = readEntries(root).filter((e) => e.status === "rejected");
  const matches = rejected
    .map((e) => ({
      id: e.id,
      title: e.title,
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

  add               stdin JSON: {title, why, what, source, depends_on?, touches?, notes?, status?}
                    source: "user" | "claude-suggested"
                    status (create-time only): "planned" (default) | "rejected"
  update-status     stdin JSON: {id, status, commit?, notes?, add_touches?}
                    status: "planned" | "in_progress" | "done" | "dropped" | "rejected"
                    if commit is given, touches auto-folds in that commit's
                    actual changed files (git show, best-effort, silent if
                    git/the sha is unavailable) -- add_touches adds more on
                    top, for anything outside that commit's diff
                    add_touches: array of paths to fold into touches (dedup, never removes)
  update-deps       stdin JSON: {id, add_depends_on}   (add_depends_on: non-empty array of ids)
  list              flag: --status planned,in_progress   (optional, comma-separated)
                    flag: --ids 002,005   (optional, comma-separated, combinable with --status)
  next-candidates   flag: --limit N   (optional, default 3)
                    candidates now include depends_on
  check-duplicate   stdin JSON: {title, why}

Examples:
  echo '{"title":"Add JWT refresh middleware","why":"...","what":"...","source":"user"}' \\
    | node roadmap.js add
  echo '{"id":"003","status":"done","commit":"a1b2c3d"}' \\
    | node roadmap.js update-status
  echo '{"id":"003","status":"done","commit":"a1b2c3d","add_touches":["docs/migration.md"]}' \\
    | node roadmap.js update-status
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
        `unknown subcommand: ${sub}. Use add|update-status|update-deps|list|next-candidates|check-duplicate`
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
  cmdUpdateDeps,
  cmdList,
  cmdNextCandidates,
  cmdCheckDuplicate,
  reaches,
  normalizeWords,
  jaccard,
  USAGE,
};
