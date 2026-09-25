'use strict';

// The lesson ledger's store: `.foreman/notes.jsonl`, one record per close that
// recorded a durable fact about the files it touched.
//
// Append-only, and that is the whole concurrency story. Sessions never rewrite
// it, so two branches merge line by line with nothing to reconcile; there are
// no record ids, so nothing can collide on a count-derived one. Reads are
// lock-free because a torn final line is skipped rather than repaired, and
// writes ride the close's existing roadmap lock rather than taking their own.
//
// Everything here fails soft. A store that will not parse is a store that
// serves nothing — never a close that fails, and never an exception a caller
// has to guard.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const NOTES_DIR = '.foreman';
const NOTES_FILE = 'notes.jsonl';

// The format marker is the file's first line and is recognized by shape, not
// by position in a schema registry. A newer format is refused rather than
// guessed at: reading a record shape this code has never seen would serve
// wrong prose confidently, which is the one failure this feature cannot have.
const FORMAT = 1;
const FORMAT_KEY = 'foreman_notes_format';

// Hard refuse, not advise. Measured: advisory caps under-comply by about 35%,
// and an essay in a served block spends the whole char budget on one record.
const LESSON_MAX = 500;

// Files every close touches as bookkeeping rather than as work. A record whose
// paths are only these describes nothing about the code and is refused.
const BOOKKEEPING = [
  (p) => p === 'ROADMAP.jsonl',
  (p) => p === NOTES_DIR || p.startsWith(`${NOTES_DIR}/`),
  (p) => p === 'docs/foreman' || p.startsWith('docs/foreman/'),
];

function notesPath(root) {
  return path.join(root, NOTES_DIR, NOTES_FILE);
}

/**
 * Separator- and prefix-normalized, and deliberately NOT lowercased.
 * roadmap.js's `normalizedTouch` lowercases because it builds a compare key;
 * this builds a path that will later be handed to `fs.existsSync` and to git,
 * where a lowercased path reads false-dead and false-fresh on a
 * case-sensitive filesystem.
 */
function normalizeStorePath(value) {
  return String(value || '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
}

function isBookkeeping(p) {
  return BOOKKEEPING.some((test) => test(p));
}

/** The paths a record should carry: normalized, deduped, bookkeeping dropped. */
function storablePaths(paths) {
  const seen = new Set();
  const kept = [];
  for (const raw of Array.isArray(paths) ? paths : []) {
    const p = normalizeStorePath(raw);
    if (!p || isBookkeeping(p) || seen.has(p)) continue;
    seen.add(p);
    kept.push(p);
  }
  return kept;
}

/**
 * The cosmetic grouping key: the directory prefix most of a record's files
 * share, at most two segments deep, lowercased because nothing resolves it
 * against a filesystem. Selection never uses it — that is always path-level
 * overlap — so a wrong answer here costs a readable heading, nothing more.
 * (P0, 2026-08-18: two thirds of this repo's closed entries have no dominant
 * area at all, which is exactly why nothing load-bearing may read it.)
 */
function dominantArea(paths) {
  const counts = new Map();
  for (const p of storablePaths(paths)) {
    const segments = p.split('/');
    const key = segments.length > 1 ? segments.slice(0, -1).slice(0, 2).join('/').toLowerCase() : '.';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = null;
  // Insertion order breaks a tie, so the answer is stable for a given input
  // rather than dependent on how the Map happens to iterate.
  for (const [key, count] of counts) {
    if (!best || count > best.count) best = { key, count };
  }
  return best ? best.key : '.';
}

function looksLikeConflict(text) {
  return /^(<{7}|={7}|>{7})/m.test(text);
}

/**
 * [Foreman: 247] The stable name of one record, for a later line to refer to.
 *
 * The store has no record ids on purpose — nothing can collide on a
 * count-derived one across two branches. A supersede marker still needs to say
 * WHICH record it retires, so the name is derived from the record instead of
 * assigned to it: same content in two clones means the same key in both, and
 * every reader computes it rather than reading it off the line.
 *
 * `lesson` alone would collide across two areas recording the same sentence,
 * so the entry and the date ride along. Twelve hex characters is well past
 * collision range for a store whose realistic size is hundreds of lines.
 */
function recordKey(record) {
  const parts = [record && record.entry, record && record.date, record && record.lesson];
  return crypto.createHash('sha1').update(parts.map((p) => String(p === undefined || p === null ? '' : p)).join('\u0000')).digest('hex').slice(0, 12);
}

/** True when every file a record names is gone from disk. */
function isDead(root, record) {
  return !(record.paths || []).some((p) => fs.existsSync(path.join(root, p)));
}

/**
 * Every record in the store, oldest first.
 *
 * `{records, tombstones, superseded, format, error}`. `error` is `"conflict"`
 * when the file still carries merge markers, `"unsupported_format"` when its
 * marker names a format this code does not know, `"unreadable"` when the
 * filesystem refused a file that exists. In every one of those cases
 * `records` is empty: a partially-understood store serves nothing.
 *
 * [Foreman: 247] `records` is the LIVE set — a record a later line superseded
 * is already gone from it. Every existing consumer therefore stops serving a
 * retired lesson without knowing the concept exists, which is the point: a
 * correction is only worth recording if the wrong line stops being quoted.
 * `tombstones` and `superseded` are for the two callers that manage the store
 * itself.
 *
 * A missing file is not an error — it is a project that has recorded nothing.
 */
function read(root) {
  let text;
  try {
    text = fs.readFileSync(notesPath(root), 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { records: [], retired: [], tombstones: [], superseded: [], format: FORMAT, error: null, invalid: 0 };
    }
    return { records: [], retired: [], tombstones: [], superseded: [], format: null, error: 'unreadable', invalid: 0 };
  }

  if (looksLikeConflict(text)) {
    return { records: [], retired: [], tombstones: [], superseded: [], format: null, error: 'conflict', invalid: 0 };
  }

  // Dropping the last split element covers both endings at once: a clean file
  // ends in a newline so that element is empty, and a crashed append leaves a
  // torn final line there instead. Skipping it is what makes a lock-free read
  // safe — every earlier line is whole by construction.
  const complete = text.split('\n').slice(0, -1);
  const records = [];
  const tombstones = [];
  let format = null;
  let invalid = 0;
  for (const line of complete) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      invalid += 1;
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      invalid += 1;
      continue;
    }
    if (format === null && FORMAT_KEY in parsed) {
      format = parsed[FORMAT_KEY];
      continue;
    }
    // [Foreman: 247] A supersede marker, checked before the record shape: it
    // carries no paths and no lesson, so the validity test below would score
    // it as a corrupt line and the correction it records would be lost.
    if (typeof parsed.supersedes === 'string' && parsed.supersedes) {
      tombstones.push(parsed);
      continue;
    }
    if (!Array.isArray(parsed.paths) || !parsed.paths.length || typeof parsed.lesson !== 'string') {
      invalid += 1;
      continue;
    }
    records.push(parsed);
  }

  if (format !== null && format !== FORMAT) {
    return { records: [], retired: [], tombstones: [], superseded: [], format, error: 'unsupported_format', invalid };
  }

  const superseded = [...new Set(tombstones.map((t) => t.supersedes))];
  const retiredKeys = new Set(superseded);
  const live = [];
  const retired = [];
  for (const record of records) {
    (retiredKeys.has(recordKey(record)) ? retired : live).push(record);
  }
  return {
    records: live,
    retired,
    tombstones,
    superseded,
    format: format === null ? FORMAT : format,
    error: null,
    invalid,
  };
}

/**
 * Append one record. Returns the shape a close reports back:
 * `{stored:true, area, paths_count}` or `{stored:false, reason}`.
 *
 * Never throws. A close that recorded nothing is a close that succeeded with
 * one fewer breadcrumb — it is never a close that failed.
 */
function append(root, { lesson, paths, entry, anchor, date }) {
  const text = String(lesson === undefined || lesson === null ? '' : lesson).replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (!text) return { stored: false, reason: 'empty_lesson' };
  if (text.length > LESSON_MAX) return { stored: false, reason: 'over_500_chars' };

  const stored = storablePaths(paths);
  if (!stored.length) return { stored: false, reason: 'no_observed_paths' };

  const existing = read(root);
  if (existing.error) return { stored: false, reason: existing.error };

  const record = {
    area: dominantArea(stored),
    paths: stored,
    entry,
    anchor: anchor || { kind: 'none' },
    date,
    lesson: text,
  };

  try {
    fs.mkdirSync(path.join(root, NOTES_DIR), { recursive: true });
    const marker = fs.existsSync(notesPath(root)) ? '' : `${JSON.stringify({ [FORMAT_KEY]: FORMAT })}\n`;
    fs.appendFileSync(notesPath(root), `${marker}${JSON.stringify(record)}\n`, 'utf-8');
  } catch {
    return { stored: false, reason: 'write_failed' };
  }

  return { stored: true, area: record.area, paths_count: stored.length };
}

/**
 * [Foreman: 247] Retire one record by appending a marker that names it.
 *
 * Superseding is an append, not an edit, because the store's whole
 * concurrency story is that nothing rewrites a line. Two clones that retire
 * the same record write the same marker twice and the merge is still clean.
 *
 * Returns `{superseded:true, key}` or `{superseded:false, reason}`. Never
 * throws — the caller reports, it does not guard.
 */
function supersede(root, { key, by_entry: byEntry, date }) {
  const wanted = String(key || '').trim();
  if (!wanted) return { superseded: false, reason: 'no_key' };

  const existing = read(root);
  if (existing.error) return { superseded: false, reason: existing.error };
  if (existing.superseded.includes(wanted)) return { superseded: false, reason: 'already_superseded' };
  if (!existing.records.some((record) => recordKey(record) === wanted)) {
    return { superseded: false, reason: 'no_such_record' };
  }

  const marker = { supersedes: wanted, by_entry: byEntry, date };
  try {
    fs.mkdirSync(path.join(root, NOTES_DIR), { recursive: true });
    fs.appendFileSync(notesPath(root), `${JSON.stringify(marker)}\n`, 'utf-8');
  } catch {
    return { superseded: false, reason: 'write_failed' };
  }
  return { superseded: true, key: wanted };
}

/**
 * [Foreman: 247] The one operation that rewrites the store: drop the records
 * nothing can learn from any more.
 *
 * Two kinds go: a record every one of whose files is gone from disk, and a
 * record a later marker retired. Their markers go with them — except a marker
 * whose target was never in this file at all, which is the half-merged case
 * and the one time keeping it is what preserves the correction.
 *
 * Append-only is the invariant everywhere else, so this is deliberately the
 * only exception, it is user-approved rather than automatic, and the caller
 * holds the roadmap lock around it. Returns what it removed without writing
 * when `dryRun` is set, so a flow can show the count before asking.
 */
function prune(root, { dryRun = false } = {}) {
  const state = read(root);
  if (state.error) return { pruned: false, reason: state.error };

  // Both halves of the file, so a marker can tell "your target is gone" from
  // "your target never arrived".
  const present = new Set([...state.records, ...state.retired].map((record) => recordKey(record)));
  const kept = [];
  const dropped = { dead: 0, superseded: state.retired.length };

  for (const record of state.records) {
    if (isDead(root, record)) {
      dropped.dead += 1;
      continue;
    }
    kept.push(record);
  }

  // A marker whose target this file has never carried is the half-merged case:
  // the other side still owes us the line it retires, so the marker waits.
  const keptTombstones = state.tombstones.filter((marker) => !present.has(marker.supersedes));

  const removed = dropped.dead + dropped.superseded;
  if (dryRun) return { pruned: false, dry_run: true, removed, dropped, kept: kept.length };
  if (!removed) return { pruned: false, reason: 'nothing_to_prune', removed: 0, dropped, kept: kept.length };

  const lines = [JSON.stringify({ [FORMAT_KEY]: FORMAT })]
    .concat(kept.map((record) => JSON.stringify(record)))
    .concat(keptTombstones.map((marker) => JSON.stringify(marker)));
  const target = notesPath(root);
  const temp = `${target}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(path.join(root, NOTES_DIR), { recursive: true });
    fs.writeFileSync(temp, `${lines.join('\n')}\n`, 'utf-8');
    fs.renameSync(temp, target);
  } catch {
    try { fs.unlinkSync(temp); } catch { /* the temp file may never have landed */ }
    return { pruned: false, reason: 'write_failed' };
  }
  return { pruned: true, removed, dropped, kept: kept.length };
}

/**
 * [Foreman: 247] Mark every record written for `id` as no longer resolvable
 * through that id.
 *
 * `reassign-id` repairs a duplicated id by renumbering all but one holder. The
 * id then unambiguously names the holder that kept it — but a record written
 * while both existed cannot be attributed to either, and resolving it would
 * read one entry's git history as if it were the other's. That is a confident
 * freshness claim from the wrong commits, which is the one failure this
 * channel must never produce.
 *
 * So the anchor is demoted rather than rewritten. The lesson still serves, the
 * date and the entry it names stay as recorded — those are true history, and
 * `recordKey` hashes them, so an existing supersede marker keeps working — and
 * the staleness verdict falls to "unknown", which is the honest answer.
 *
 * Rewrites the file, so the caller holds the roadmap lock. Returns how many
 * records it touched; a store with none is a no-op that writes nothing.
 */
function demoteAnchors(root, id, { date } = {}) {
  const wanted = String(id === undefined || id === null ? '' : id);
  if (!wanted) return { demoted: 0 };
  const state = read(root);
  if (state.error) return { demoted: 0, reason: state.error };

  let demoted = 0;
  // [Foreman: 769] A close writes the id on the record, never on its anchor. A
  // recorded sha stays on the demoted anchor: it names one commit whichever
  // holder wrote it, so only the fallback through the id's trailers goes.
  const rewrite = (record) => {
    const anchor = record.anchor || {};
    if (String(record.entry) !== wanted || anchor.kind === 'ambiguous') return record;
    demoted += 1;
    return { ...record, anchor: { kind: 'ambiguous', was: wanted, since: date, ...(anchor.sha ? { sha: anchor.sha } : {}) } };
  };
  const records = [...state.records, ...state.retired].map(rewrite);
  if (!demoted) return { demoted: 0 };

  const lines = [JSON.stringify({ [FORMAT_KEY]: FORMAT })]
    .concat(records.map((record) => JSON.stringify(record)))
    .concat(state.tombstones.map((marker) => JSON.stringify(marker)));
  const target = notesPath(root);
  const temp = `${target}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temp, `${lines.join('\n')}\n`, 'utf-8');
    fs.renameSync(temp, target);
  } catch {
    try { fs.unlinkSync(temp); } catch { /* the temp file may never have landed */ }
    return { demoted: 0, reason: 'write_failed' };
  }
  return { demoted };
}

module.exports = {
  NOTES_RELATIVE: `${NOTES_DIR}/${NOTES_FILE}`,
  FORMAT,
  FORMAT_KEY,
  LESSON_MAX,
  notesPath,
  normalizeStorePath,
  dominantArea,
  recordKey,
  isDead,
  read,
  append,
  supersede,
  prune,
  demoteAnchors,
};
