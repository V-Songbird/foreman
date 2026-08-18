'use strict';

// How stale one lesson-ledger record is, resolved against git at the moment it
// is about to be served — never at write time, because the answer changes
// every time somebody edits the file the record names.
//
// Two rules govern everything here.
//
// **Never optimistic.** Every way of failing to answer — no git, a sha nothing
// resolves, a sha off this history line, a diff git refused, a budget already
// spent — lands on "unknown". "unchanged" is a verdict git has to earn, because
// the harm this whole feature exists to prevent is a confident stale claim
// anchoring a session on the wrong file.
//
// **Bounded.** Resolution runs only for records already selected for serving,
// and stops at a fixed budget. Past it, records serve with their anchor and no
// freshness claim at all, which is honest rather than expensive.

const fs = require('fs');
const path = require('path');
const { changedSince, trailerShasFor } = require('./commit-evidence');

// Each resolution costs up to three git invocations (rev-parse per scope,
// merge-base, diff). Ten of them is the ~30-call ceiling the economics review
// asked for, and it is a ceiling for the whole call, not per record.
const RESOLVE_BUDGET = 10;

// A commit-kind anchor that no longer resolves falls through to the entry's
// trailers, because a rebase splits a recorded sha from the commit that still
// names the entry. Two tries is enough for that case without letting a record
// with a long trailer history eat the whole budget.
const TRAILER_TRIES = 2;

/** A fresh call budget. Pass one object across a whole serving pass. */
function newBudget(limit = RESOLVE_BUDGET) {
  return { spent: 0, limit };
}

/** The shas worth asking git about for this record, best first. */
function candidateShas(root, record) {
  const anchor = record && record.anchor;
  const recorded = anchor && anchor.kind === 'commit' && anchor.sha ? [String(anchor.sha)] : [];
  const trailers = record && record.entry !== undefined && record.entry !== null
    ? trailerShasFor(root, record.entry)
    : null;
  // trailerShasFor answers newest-first, and null means git could not be asked
  // at all — which is not the same as "no commit names this entry".
  const fromTrailers = Array.isArray(trailers) ? trailers.slice(0, TRAILER_TRIES) : [];
  return [...recorded, ...fromTrailers];
}

function label(record, state, changed, checked, sha) {
  const head = `entry ${record.entry}${record.date ? `, ${record.date}` : ''}`;
  const at = sha ? `, at ${String(sha).slice(0, 7)}` : '';
  if (state === 'fresh') return `[${head}${at} — unchanged since]`;
  if (state === 'stale') {
    return `[${head}${at} — possibly stale: ${changed} of its ${checked} files changed since]`;
  }
  return `[${head}${at} — anchor unresolvable, staleness unknown]`;
}

/**
 * Resolve one record.
 *
 * `{state, label, changed, checked, sha}` where `state` is `"fresh"`,
 * `"stale"`, `"unknown"`, or `"dead"`. A dead record — every stored path gone
 * from disk — is suppressed from serving entirely rather than labelled: it
 * describes code that is not there any more, so there is nothing for a reader
 * to verify it against.
 *
 * The `fs.existsSync` check runs FIRST and costs no git, so a store full of
 * dead records cannot spend the git budget on answers nobody will see.
 */
function resolve(root, record, budget = newBudget()) {
  const paths = Array.isArray(record && record.paths) ? record.paths : [];
  const dead = { state: 'dead', label: null, changed: [], checked: 0, sha: null };
  if (!paths.length) return dead;
  if (!paths.some((p) => fs.existsSync(path.join(root, p)))) return dead;

  for (const sha of candidateShas(root, record)) {
    if (budget.spent >= budget.limit) break;
    budget.spent += 1;
    const { state, changed, checked } = changedSince(root, sha, paths);
    if (state === 'unknown') continue;
    return {
      state,
      label: label(record, state, changed.length, checked, sha),
      // The paths themselves, not just how many: the graded serving rule drops
      // a lesson whose prose names a file that moved under it.
      changed,
      checked,
      sha,
    };
  }

  return {
    state: 'unknown',
    label: label(record, 'unknown', 0, 0, null),
    changed: [],
    checked: 0,
    sha: null,
  };
}

/**
 * Resolve a whole serving window under one shared budget, dropping the dead.
 * Order is preserved — ranking is the caller's decision, not this module's.
 */
function resolveAll(root, records, budget = newBudget()) {
  const out = [];
  for (const record of Array.isArray(records) ? records : []) {
    const verdict = resolve(root, record, budget);
    if (verdict.state === 'dead') continue;
    out.push({ record, ...verdict });
  }
  return out;
}

module.exports = { RESOLVE_BUDGET, TRAILER_TRIES, newBudget, resolve, resolveAll };
