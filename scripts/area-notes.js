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
 * Every record in the store, oldest first.
 *
 * `{records, format, error}`. `error` is `"conflict"` when the file still
 * carries merge markers, `"unsupported_format"` when its marker names a
 * format this code does not know, `"unreadable"` when the filesystem refused
 * a file that exists. In every one of those cases `records` is empty: a
 * partially-understood store serves nothing.
 *
 * A missing file is not an error — it is a project that has recorded nothing.
 */
function read(root) {
  let text;
  try {
    text = fs.readFileSync(notesPath(root), 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { records: [], format: FORMAT, error: null, invalid: 0 };
    return { records: [], format: null, error: 'unreadable', invalid: 0 };
  }

  if (looksLikeConflict(text)) return { records: [], format: null, error: 'conflict', invalid: 0 };

  // Dropping the last split element covers both endings at once: a clean file
  // ends in a newline so that element is empty, and a crashed append leaves a
  // torn final line there instead. Skipping it is what makes a lock-free read
  // safe — every earlier line is whole by construction.
  const complete = text.split('\n').slice(0, -1);
  const records = [];
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
    if (!Array.isArray(parsed.paths) || !parsed.paths.length || typeof parsed.lesson !== 'string') {
      invalid += 1;
      continue;
    }
    records.push(parsed);
  }

  if (format !== null && format !== FORMAT) {
    return { records: [], format, error: 'unsupported_format', invalid };
  }
  return { records, format: format === null ? FORMAT : format, error: null, invalid };
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

module.exports = {
  NOTES_RELATIVE: `${NOTES_DIR}/${NOTES_FILE}`,
  FORMAT,
  FORMAT_KEY,
  LESSON_MAX,
  notesPath,
  normalizeStorePath,
  dominantArea,
  read,
  append,
};
