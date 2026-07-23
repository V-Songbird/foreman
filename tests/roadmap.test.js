'use strict';

// Tests for scripts/roadmap.js — the mechanical CRUD CLI for ROADMAP.jsonl.
//
// Covers:
//   - add computes sequential zero-padded ids, validates required fields/source
//   - update-status transitions status, appends (not replaces) commits/notes,
//     and folds add_touches into touches (dedup, never removes) as well as
//     whatever files the given commit's git diff actually shows (best-effort)
//   - update-deps adds a discovered depends_on id to an existing entry,
//     rejecting unknown ids and self-dependencies
//   - list filters by status and/or ids (combinable), returns everything
//     with no filter
//   - next-candidates filters unblocked planned tasks, ranks by open
//     transitive unblocks, then direct unblocks, then no-collision, then
//     oldest created_at; counts only open dependents; supports --hint
//     relevance ranking; flags touches collisions against in_progress,
//     surfaces each candidate's notes and depends_on, and defaults to a
//     limit of 3
//   - add/update-status return a `warnings` field for long why/what/notes
//     without failing the write
//   - annotate appends notes and bumps updated_at without touching status
//   - check-duplicate finds word-overlap matches against all entries,
//     carrying each match's status so callers can tell declined from tracked
//   - a corrupt line in the file fails loudly (ok:false, exit 1) instead of
//     silently skipping it
//   - doc accepts "none" or a relative .md path on add/update-status,
//     rejects traversal/absolute/non-md values, omits itself when unset,
//     and survives list/next-candidates serialization
//   - DECISION_ANCHOR_RE/anchorIdsIn/anchorHasId: single- and multi-id
//     anchor comments, ids in ordinary prose not wrapped in the anchor
//     never match

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runRoadmap, makeTmpProject, writeRoadmap, initGitRepo, commitFile } = require('./helpers');

let project;
let env;

beforeEach(() => {
  project = makeTmpProject();
  env = { CLAUDE_PROJECT_DIR: project };
});

function run(argv, stdinData) {
  const result = runRoadmap(argv, stdinData, env);
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new Error(`non-JSON stdout (status ${result.status}): ${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, json };
}

describe('add', () => {
  test('creates ROADMAP.jsonl if missing, first id is 001', () => {
    const { status, json } = run(['add'], {
      title: 'Add JWT refresh middleware',
      why: 'Sessions expire mid-request under load.',
      what: 'Refresh the token before its 15-min expiry.',
      source: 'user',
    });
    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.equal(json.entry.id, '001');
    assert.equal(json.entry.status, 'planned');
    assert.deepEqual(json.entry.commits, []);
    assert.ok(fs.existsSync(path.join(project, 'ROADMAP.jsonl')));
  });

  test('ids increment sequentially, zero-padded', () => {
    run(['add'], { title: 'a', why: 'a', what: 'a', source: 'user' });
    run(['add'], { title: 'b', why: 'b', what: 'b', source: 'user' });
    const { json } = run(['add'], { title: 'c', why: 'c', what: 'c', source: 'user' });
    assert.equal(json.entry.id, '003');
  });

  test('defaults depends_on/touches/notes when omitted', () => {
    const { json } = run(['add'], { title: 'a', why: 'a', what: 'a', source: 'user' });
    assert.deepEqual(json.entry.depends_on, []);
    assert.deepEqual(json.entry.touches, []);
    assert.equal(json.entry.notes, '');
  });

  test('rejects missing required fields', () => {
    const { status, json } = run(['add'], { title: 'a', source: 'user' });
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /requires title, why, what/);
  });

  test('rejects a depends_on id that does not exist', () => {
    run(['add'], { title: 'a', why: 'a', what: 'a', source: 'user' });
    const { status, json } = run(['add'], {
      title: 'b', why: 'b', what: 'b', source: 'user', depends_on: ['099'],
    });
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /unknown depends_on id\(s\): 099/);
  });

  test('accepts a depends_on id that already exists', () => {
    run(['add'], { title: 'a', why: 'a', what: 'a', source: 'user' });
    const { status, json } = run(['add'], {
      title: 'b', why: 'b', what: 'b', source: 'user', depends_on: ['001'],
    });
    assert.equal(status, 0);
    assert.deepEqual(json.entry.depends_on, ['001']);
  });

  test('rejects invalid source', () => {
    const { status, json } = run(['add'], { title: 'a', why: 'a', what: 'a', source: 'bot' });
    assert.equal(status, 1);
    assert.match(json.error, /source must be one of/);
  });

  test('rejects deferred as a create-time status', () => {
    const { status, json } = run(['add'], {
      title: 'a', why: 'a', what: 'a', source: 'user', status: 'deferred',
    });
    assert.equal(status, 1);
    assert.match(json.error, /add status must be one of/);
  });
});

describe('update-status', () => {
  beforeEach(() => {
    writeRoadmap(project, [
      { id: '001', title: 'a', why: 'a', what: 'a', status: 'in_progress', source: 'user', depends_on: [], touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '' },
    ]);
  });

  test('transitions status and appends a commit', () => {
    const { json } = run(['update-status'], { id: '001', status: 'done', commit: 'a1b2c3d' });
    assert.equal(json.entry.status, 'done');
    assert.deepEqual(json.entry.commits, ['a1b2c3d']);
  });

  test('does not duplicate an already-recorded commit', () => {
    run(['update-status'], { id: '001', status: 'in_progress', commit: 'a1b2c3d' });
    const { json } = run(['update-status'], { id: '001', status: 'done', commit: 'a1b2c3d' });
    assert.deepEqual(json.entry.commits, ['a1b2c3d']);
  });

  test('appends notes on their own dated line rather than replacing them', () => {
    run(['update-status'], { id: '001', status: 'in_progress', notes: 'first' });
    const { json } = run(['update-status'], { id: '001', status: 'in_progress', notes: 'second' });
    const lines = json.entry.notes.split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^\d{4}-\d{2}-\d{2} first$/);
    assert.match(lines[1], /^\d{4}-\d{2}-\d{2} second$/);
  });

  test('a multi-line notes history still round-trips as one JSONL line', () => {
    run(['update-status'], { id: '001', status: 'in_progress', notes: 'first' });
    run(['update-status'], { id: '001', status: 'in_progress', notes: 'second' });
    const raw = fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8').trim();
    assert.equal(raw.split('\n').length, 1);
    assert.equal(JSON.parse(raw).notes.split('\n').length, 2);
  });

  test('rejects unknown id', () => {
    const { status, json } = run(['update-status'], { id: '999', status: 'done' });
    assert.equal(status, 1);
    assert.match(json.error, /no entry with id 999/);
  });

  test('rejects invalid status', () => {
    const { status, json } = run(['update-status'], { id: '001', status: 'cancelled' });
    assert.equal(status, 1);
    assert.match(json.error, /status must be one of/);
  });

  test('accepts deferred as a transition target', () => {
    const { status, json } = run(['update-status'], { id: '001', status: 'deferred' });
    assert.equal(status, 0);
    assert.equal(json.entry.status, 'deferred');
  });

  test('folds add_touches into touches', () => {
    const { json } = run(['update-status'], {
      id: '001',
      status: 'done',
      add_touches: ['src/api/retry.ts', 'src/api/githubClient.ts'],
    });
    assert.deepEqual(json.entry.touches, ['src/api/retry.ts', 'src/api/githubClient.ts']);
  });

  test('does not duplicate an already-listed touched path', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', why: 'a', what: 'a', status: 'in_progress', source: 'user', depends_on: [], touches: ['src/api/retry.ts'], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '' },
    ]);
    const { json } = run(['update-status'], { id: '001', status: 'done', add_touches: ['src/api/retry.ts', 'src/api/new.ts'] });
    assert.deepEqual(json.entry.touches, ['src/api/retry.ts', 'src/api/new.ts']);
  });

  test('rejects a non-array add_touches', () => {
    const { status, json } = run(['update-status'], { id: '001', status: 'done', add_touches: 'src/api/retry.ts' });
    assert.equal(status, 1);
    assert.match(json.error, /add_touches must be an array/);
  });
});

describe('update-status auto-derives touches from the commit', () => {
  beforeEach(() => {
    writeRoadmap(project, [
      { id: '001', title: 'a', why: 'a', what: 'a', status: 'in_progress', source: 'user', depends_on: [], touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '' },
    ]);
    initGitRepo(project);
  });

  test('folds in the files the commit actually changed', () => {
    const sha = commitFile(project, 'src/foo.ts', 'export const x = 1;\n');
    const { json } = run(['update-status'], { id: '001', status: 'done', commit: sha });
    assert.deepEqual(json.entry.touches, ['src/foo.ts']);
    assert.deepEqual(json.derived_touches, ['src/foo.ts']);
  });

  test('merges derived files with manual add_touches, deduped', () => {
    const sha = commitFile(project, 'src/foo.ts', 'export const x = 1;\n');
    const { json } = run(['update-status'], {
      id: '001',
      status: 'done',
      commit: sha,
      add_touches: ['src/foo.ts', 'docs/migration.md'],
    });
    assert.deepEqual(json.entry.touches, ['src/foo.ts', 'docs/migration.md']);
  });

  test('an unknown sha fails soft — write still succeeds, nothing derived', () => {
    const { status, json } = run(['update-status'], { id: '001', status: 'done', commit: 'deadbeef' });
    assert.equal(status, 0);
    assert.equal(json.entry.status, 'done');
    assert.deepEqual(json.entry.touches, []);
    assert.equal(json.derived_touches, undefined);
  });

  test('no commit given — no derivation attempted, add_touches still works alone', () => {
    const { json } = run(['update-status'], { id: '001', status: 'in_progress', add_touches: ['src/manual.ts'] });
    assert.deepEqual(json.entry.touches, ['src/manual.ts']);
    assert.equal(json.derived_touches, undefined);
  });
});

describe('annotate', () => {
  beforeEach(() => {
    writeRoadmap(project, [
      { id: '001', title: 'a', why: 'a', what: 'a', status: 'in_progress', source: 'user', depends_on: [], touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: 'first' },
    ]);
  });

  test('appends notes and bumps updated_at without touching status', () => {
    const { status, json } = run(['annotate'], { id: '001', notes: 'second' });
    assert.equal(status, 0);
    const lines = json.entry.notes.split('\n');
    assert.equal(lines[0], 'first');
    assert.match(lines[1], /^\d{4}-\d{2}-\d{2} second$/);
    assert.equal(json.entry.status, 'in_progress');
    assert.notEqual(json.entry.updated_at, '2026-07-01');
  });

  test('starts notes fresh when the entry has none yet', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', why: 'a', what: 'a', status: 'planned', source: 'user', depends_on: [], touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '' },
    ]);
    const { json } = run(['annotate'], { id: '001', notes: 'only note' });
    assert.match(json.entry.notes, /^\d{4}-\d{2}-\d{2} only note$/);
  });

  test('rejects a missing notes field', () => {
    const { status, json } = run(['annotate'], { id: '001' });
    assert.equal(status, 1);
    assert.match(json.error, /annotate requires id, notes/);
  });

  test('rejects unknown id', () => {
    const { status, json } = run(['annotate'], { id: '999', notes: 'x' });
    assert.equal(status, 1);
    assert.match(json.error, /no entry with id 999/);
  });

  test('returns a warning for an overlong notes append, but still writes', () => {
    const { status, json } = run(['annotate'], { id: '001', notes: 'y'.repeat(3500) });
    assert.equal(status, 0);
    assert.ok(json.warnings && json.warnings.some((w) => w.startsWith('notes')));
  });
});

describe('update-deps', () => {
  beforeEach(() => {
    writeRoadmap(project, [
      { id: '001', title: 'prereq', why: 'a', what: 'a', status: 'planned', source: 'user', depends_on: [], touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '' },
      { id: '002', title: 'target', why: 'a', what: 'a', status: 'planned', source: 'user', depends_on: [], touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '' },
    ]);
  });

  test('adds a discovered dependency', () => {
    const { json } = run(['update-deps'], { id: '002', add_depends_on: ['001'] });
    assert.deepEqual(json.entry.depends_on, ['001']);
  });

  test('does not duplicate an already-present dependency', () => {
    run(['update-deps'], { id: '002', add_depends_on: ['001'] });
    const { json } = run(['update-deps'], { id: '002', add_depends_on: ['001'] });
    assert.deepEqual(json.entry.depends_on, ['001']);
  });

  test('rejects an unknown dependency id', () => {
    const { status, json } = run(['update-deps'], { id: '002', add_depends_on: ['999'] });
    assert.equal(status, 1);
    assert.match(json.error, /unknown depends_on id/);
  });

  test('rejects a task depending on itself', () => {
    const { status, json } = run(['update-deps'], { id: '002', add_depends_on: ['002'] });
    assert.equal(status, 1);
    assert.match(json.error, /cannot depend on itself/);
  });

  test('rejects an indirect cycle', () => {
    // set up 002 -> 001 first; making 001 -> 002 would close the loop.
    run(['update-deps'], { id: '002', add_depends_on: ['001'] });
    const { status, json } = run(['update-deps'], { id: '001', add_depends_on: ['002'] });
    assert.equal(status, 1);
    assert.match(json.error, /would create a cycle/);
  });

  test('rejects a longer indirect cycle (001 -> 002 -> 003 -> 001)', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', why: 'a', what: 'a', status: 'planned', source: 'user', depends_on: [], touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '' },
      { id: '002', title: 'b', why: 'a', what: 'a', status: 'planned', source: 'user', depends_on: ['001'], touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '' },
      { id: '003', title: 'c', why: 'a', what: 'a', status: 'planned', source: 'user', depends_on: ['002'], touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '' },
    ]);
    const { status, json } = run(['update-deps'], { id: '001', add_depends_on: ['003'] });
    assert.equal(status, 1);
    assert.match(json.error, /would create a cycle/);
  });

  test('rejects unknown id', () => {
    const { status, json } = run(['update-deps'], { id: '999', add_depends_on: ['001'] });
    assert.equal(status, 1);
    assert.match(json.error, /no entry with id 999/);
  });

  test('rejects an empty add_depends_on', () => {
    const { status, json } = run(['update-deps'], { id: '002', add_depends_on: [] });
    assert.equal(status, 1);
    assert.match(json.error, /requires id and a non-empty add_depends_on/);
  });

  test('removes a dependency', () => {
    run(['update-deps'], { id: '002', add_depends_on: ['001'] });
    const { json } = run(['update-deps'], { id: '002', remove_depends_on: ['001'] });
    assert.deepEqual(json.entry.depends_on, []);
  });

  test('removing a dependency that is not there is a no-op', () => {
    const { status, json } = run(['update-deps'], { id: '002', remove_depends_on: ['001'] });
    assert.equal(status, 0);
    assert.deepEqual(json.entry.depends_on, []);
  });

  test('removals apply before additions in the same call', () => {
    run(['update-deps'], { id: '002', add_depends_on: ['001'] });
    const { json } = run(['update-deps'], {
      id: '002',
      remove_depends_on: ['001'],
      add_depends_on: ['001'],
    });
    assert.deepEqual(json.entry.depends_on, ['001']);
  });

  test('a removal alone does not need a cycle or existence check', () => {
    writeRoadmap(project, [
      { id: '001', title: 'prereq', why: 'a', what: 'a', status: 'dropped', source: 'user', depends_on: [], touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '' },
      { id: '002', title: 'target', why: 'a', what: 'a', status: 'planned', source: 'user', depends_on: ['001', '099'], touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '' },
    ]);
    const { status, json } = run(['update-deps'], { id: '002', remove_depends_on: ['099'] });
    assert.equal(status, 0);
    assert.deepEqual(json.entry.depends_on, ['001']);
  });
});

describe('list', () => {
  beforeEach(() => {
    writeRoadmap(project, [
      { id: '001', title: 'a', status: 'planned' },
      { id: '002', title: 'b', status: 'in_progress' },
      { id: '003', title: 'c', status: 'done' },
    ]);
  });

  test('no filter returns everything', () => {
    const { json } = run(['list']);
    assert.equal(json.entries.length, 3);
  });

  test('filters by a single status', () => {
    const { json } = run(['list', '--status', 'planned']);
    assert.deepEqual(json.entries.map((e) => e.id), ['001']);
  });

  test('filters by a comma-separated status list', () => {
    const { json } = run(['list', '--status', 'planned,done']);
    assert.deepEqual(json.entries.map((e) => e.id).sort(), ['001', '003']);
  });

  test('filters by a comma-separated ids list', () => {
    const { json } = run(['list', '--ids', '001,003']);
    assert.deepEqual(json.entries.map((e) => e.id).sort(), ['001', '003']);
  });

  test('combines --status and --ids (AND, not OR)', () => {
    const { json } = run(['list', '--status', 'planned,done', '--ids', '001,002']);
    assert.deepEqual(json.entries.map((e) => e.id), ['001']);
  });

  test('--summary strips entries to id/title/status/depends_on', () => {
    const { json } = run(['list', '--summary']);
    assert.equal(json.entries.length, 3);
    for (const e of json.entries) {
      assert.deepEqual(Object.keys(e).sort(), ['depends_on', 'id', 'status', 'title']);
    }
  });

  test('--summary combines with --status', () => {
    const { json } = run(['list', '--status', 'planned', '--summary']);
    assert.deepEqual(json.entries.map((e) => e.id), ['001']);
    assert.equal(json.entries[0].why, undefined);
  });

  test('a project with no ROADMAP.jsonl yet returns an empty list, not an error', () => {
    const freshProject = makeTmpProject();
    const result = runRoadmap(['list'], undefined, { CLAUDE_PROJECT_DIR: freshProject });
    const json = JSON.parse(result.stdout);
    assert.equal(result.status, 0);
    assert.deepEqual(json.entries, []);
  });
});

describe('check-duplicate', () => {
  beforeEach(() => {
    writeRoadmap(project, [
      { id: '001', title: 'Extract duplicated retry logic', why: 'Same backoff loop copy-pasted across API clients', status: 'rejected', source: 'claude-suggested' },
      { id: '002', title: 'Unrelated planned task', why: 'Totally different thing', status: 'planned', source: 'user' },
    ]);
  });

  test('finds a word-overlap match against a rejected entry, with its status', () => {
    const { json } = run(['check-duplicate'], {
      title: 'Extract duplicated retry logic',
      why: 'Same backoff loop copy-pasted across API clients',
    });
    assert.equal(json.duplicate, true);
    assert.equal(json.matches[0].id, '001');
    assert.equal(json.matches[0].status, 'rejected');
  });

  test('matches non-rejected entries too, carrying their status', () => {
    const { json } = run(['check-duplicate'], {
      title: 'Unrelated planned task',
      why: 'Totally different thing',
    });
    assert.equal(json.duplicate, true);
    assert.equal(json.matches[0].id, '002');
    assert.equal(json.matches[0].status, 'planned');
  });

  test('unrelated text finds no match', () => {
    const { json } = run(['check-duplicate'], {
      title: 'Completely different concern about styling',
      why: 'Nothing to do with retries or backoff at all',
    });
    assert.equal(json.duplicate, false);
    assert.deepEqual(json.matches, []);
  });
});

describe('next-candidates', () => {
  test('excludes anything not planned', () => {
    writeRoadmap(project, [
      { id: '001', title: 'done one', status: 'done', depends_on: [], touches: [] },
      { id: '002', title: 'in progress one', status: 'in_progress', depends_on: [], touches: [] },
      { id: '003', title: 'planned one', status: 'planned', depends_on: [], touches: [] },
    ]);
    const { json } = run(['next-candidates']);
    assert.deepEqual(json.candidates.map((c) => c.id), ['003']);
  });

  test('excludes deferred tasks entirely', () => {
    writeRoadmap(project, [
      { id: '001', title: 'deferred one', status: 'deferred', depends_on: [], touches: [] },
      { id: '002', title: 'planned one', status: 'planned', depends_on: [], touches: [] },
    ]);
    const { json } = run(['next-candidates']);
    assert.deepEqual(json.candidates.map((c) => c.id), ['002']);
  });

  test('excludes planned tasks with an undone dependency', () => {
    writeRoadmap(project, [
      { id: '001', title: 'prereq', status: 'planned', depends_on: [], touches: [] },
      { id: '002', title: 'blocked', status: 'planned', depends_on: ['001'], touches: [] },
    ]);
    const { json } = run(['next-candidates']);
    assert.deepEqual(json.candidates.map((c) => c.id), ['001']);
  });

  test('includes a planned task once its dependency is done', () => {
    writeRoadmap(project, [
      { id: '001', title: 'prereq', status: 'done', depends_on: [], touches: [] },
      { id: '002', title: 'unblocked now', status: 'planned', depends_on: ['001'], touches: [] },
    ]);
    const { json } = run(['next-candidates']);
    assert.deepEqual(json.candidates.map((c) => c.id), ['002']);
  });

  test('ranks by unblocks-count (most depended-on first)', () => {
    writeRoadmap(project, [
      { id: '001', title: 'unblocks nothing', status: 'planned', depends_on: [], touches: [], created_at: '2026-07-01' },
      { id: '002', title: 'unblocks two others', status: 'planned', depends_on: [], touches: [], created_at: '2026-07-01' },
      { id: '003', title: 'waiting on 002', status: 'planned', depends_on: ['002'], touches: [] },
      { id: '004', title: 'also waiting on 002', status: 'planned', depends_on: ['002'], touches: [] },
    ]);
    const { json } = run(['next-candidates']);
    assert.equal(json.candidates[0].id, '002');
    assert.equal(json.candidates[0].unblocks, 2);
    assert.equal(json.candidates[0].unblocks_total, 2);
  });

  test('closed referrers do not count as unblocks', () => {
    // A done/dropped/rejected dependent no longer benefits from this entry
    // landing — only open work (planned/in_progress/deferred) counts.
    writeRoadmap(project, [
      { id: '001', title: 'a', status: 'planned', depends_on: [], touches: [], created_at: '2026-07-01' },
      { id: '002', title: 'b', status: 'planned', depends_on: [], touches: [], created_at: '2026-07-02' },
      { id: '003', title: 'closed referrer', status: 'dropped', depends_on: ['002'], touches: [] },
      { id: '004', title: 'done referrer', status: 'done', depends_on: ['002'], touches: [] },
      { id: '005', title: 'deferred referrer', status: 'deferred', depends_on: ['001'], touches: [] },
    ]);
    const { json } = run(['next-candidates']);
    const byId = Object.fromEntries(json.candidates.map((c) => [c.id, c]));
    assert.equal(byId['002'].unblocks, 0);
    assert.equal(byId['001'].unblocks, 1); // deferred still wants its dep
    assert.equal(json.candidates[0].id, '001');
  });

  test('a whole open chain outranks more direct-but-shallow dependents', () => {
    // 001 sits under a 3-deep chain (002<-003<-004); 005 has 2 direct
    // dependents and nothing further. The chain wins on unblocks_total.
    writeRoadmap(project, [
      { id: '001', title: 'chain root', status: 'planned', depends_on: [], touches: [], created_at: '2026-07-02' },
      { id: '002', title: 'chain 2', status: 'planned', depends_on: ['001'], touches: [] },
      { id: '003', title: 'chain 3', status: 'planned', depends_on: ['002'], touches: [] },
      { id: '004', title: 'chain 4', status: 'planned', depends_on: ['003'], touches: [] },
      { id: '005', title: 'two shallow', status: 'planned', depends_on: [], touches: [], created_at: '2026-07-01' },
      { id: '006', title: 'leaf a', status: 'planned', depends_on: ['005'], touches: [] },
      { id: '007', title: 'leaf b', status: 'planned', depends_on: ['005'], touches: [] },
    ]);
    const { json } = run(['next-candidates']);
    assert.equal(json.candidates[0].id, '001');
    assert.equal(json.candidates[0].unblocks_total, 3);
    assert.equal(json.candidates[0].unblocks, 1);
    assert.equal(json.candidates[1].id, '005');
    assert.equal(json.candidates[1].unblocks_total, 2);
  });

  test('a chain severed by a dropped middle entry does not inflate unblocks_total', () => {
    writeRoadmap(project, [
      { id: '001', title: 'root', status: 'planned', depends_on: [], touches: [] },
      { id: '002', title: 'dropped middle', status: 'dropped', depends_on: ['001'], touches: [] },
      { id: '003', title: 'behind the dropped one', status: 'planned', depends_on: ['002'], touches: [] },
    ]);
    const { json } = run(['next-candidates']);
    assert.equal(json.candidates.find((c) => c.id === '001').unblocks_total, 0);
  });

  test('ties in unblocks prefer the candidate without a touches collision', () => {
    writeRoadmap(project, [
      { id: '001', title: 'in flight', status: 'in_progress', depends_on: [], touches: ['src/shared.ts'] },
      { id: '002', title: 'older but colliding', status: 'planned', depends_on: [], touches: ['src/shared.ts'], created_at: '2026-06-01' },
      { id: '003', title: 'newer and clean', status: 'planned', depends_on: [], touches: ['src/other.ts'], created_at: '2026-07-01' },
    ]);
    const { json } = run(['next-candidates']);
    assert.deepEqual(json.candidates.map((c) => c.id), ['003', '002']);
  });

  test('ties in unblocks-count break by oldest created_at first', () => {
    writeRoadmap(project, [
      { id: '001', title: 'newer', status: 'planned', depends_on: [], touches: [], created_at: '2026-07-03' },
      { id: '002', title: 'older', status: 'planned', depends_on: [], touches: [], created_at: '2026-06-01' },
    ]);
    const { json } = run(['next-candidates']);
    assert.deepEqual(json.candidates.map((c) => c.id), ['002', '001']);
  });

  test('flags a touches collision against an in_progress entry', () => {
    writeRoadmap(project, [
      { id: '001', title: 'in progress', status: 'in_progress', depends_on: [], touches: ['src/shared.ts'] },
      { id: '002', title: 'candidate, overlaps', status: 'planned', depends_on: [], touches: ['src/shared.ts'] },
      { id: '003', title: 'candidate, no overlap', status: 'planned', depends_on: [], touches: ['src/other.ts'] },
    ]);
    const { json } = run(['next-candidates']);
    const byId = Object.fromEntries(json.candidates.map((c) => [c.id, c]));
    assert.equal(byId['002'].collision, true);
    assert.equal(byId['003'].collision, false);
  });

  test('surfaces notes so a survey breadcrumb is visible without a separate list call', () => {
    writeRoadmap(project, [
      { id: '001', title: 'surveyed', status: 'planned', depends_on: [], touches: [], notes: 'surveyed 2026-07-04: prefer after 002, shared risk pattern' },
    ]);
    const { json } = run(['next-candidates']);
    assert.equal(json.candidates[0].notes, 'surveyed 2026-07-04: prefer after 002, shared risk pattern');
  });

  test('surfaces depends_on so survey can resolve dependency ids without a separate list call', () => {
    writeRoadmap(project, [
      { id: '001', title: 'prereq', status: 'done', depends_on: [], touches: [] },
      { id: '002', title: 'candidate', status: 'planned', depends_on: ['001'], touches: [] },
    ]);
    const { json } = run(['next-candidates']);
    assert.deepEqual(json.candidates[0].depends_on, ['001']);
  });

  test('defaults to a limit of 3 when --limit is omitted', () => {
    writeRoadmap(
      project,
      Array.from({ length: 5 }, (_, i) => ({
        id: String(i + 1).padStart(3, '0'),
        title: `task ${i + 1}`,
        status: 'planned',
        depends_on: [],
        touches: [],
        created_at: '2026-07-01',
      }))
    );
    const { json } = run(['next-candidates']);
    assert.equal(json.candidates.length, 3);
    assert.equal(json.total_unblocked, 5);
  });

  test('returns in_progress entries alongside candidates', () => {
    writeRoadmap(project, [
      { id: '001', title: 'started', status: 'in_progress', why: 'w', what: 'x', touches: ['a.js'], depends_on: [], notes: 'n', updated_at: '2026-07-01' },
      { id: '002', title: 'ready', status: 'planned', why: 'w', what: 'x', depends_on: [] },
    ]);
    const { json } = run(['next-candidates']);
    assert.equal(json.in_progress.length, 1);
    const ip = json.in_progress[0];
    assert.equal(ip.id, '001');
    assert.equal(ip.updated_at, '2026-07-01');
    assert.deepEqual(ip.touches, ['a.js']);
    assert.equal(ip.notes, 'n');
    assert.deepEqual(json.candidates.map((c) => c.id), ['002']);
  });

  test('in_progress is an empty array when nothing is started', () => {
    writeRoadmap(project, [{ id: '001', title: 'a', status: 'planned', why: 'w', what: 'x', depends_on: [] }]);
    const { json } = run(['next-candidates']);
    assert.deepEqual(json.in_progress, []);
  });

  test('--hint ranks by relevance and reports hint_matched', () => {
    writeRoadmap(project, [
      { id: '001', title: 'Refactor payment retries', why: 'flaky checkout', what: 'backoff in payments.js', status: 'planned', depends_on: [], touches: ['src/payments.js'], created_at: '2026-06-01' },
      { id: '002', title: 'Fix auth token refresh', why: 'sessions expire', what: 'refresh middleware', status: 'planned', depends_on: [], touches: ['src/auth/middleware.ts'], created_at: '2026-07-01' },
    ]);
    const { json } = run(['next-candidates', '--hint', 'something about auth tokens']);
    assert.equal(json.hint_matched, true);
    assert.equal(json.candidates[0].id, '002');
    assert.ok(json.candidates[0].hint_score > 0);
    assert.equal(json.candidates[1].hint_score, 0);
  });

  test('--hint matches against touches paths too', () => {
    writeRoadmap(project, [
      { id: '001', title: 'Tidy formatting', why: 'w', what: 'x', status: 'planned', depends_on: [], touches: ['src/format.js'], created_at: '2026-06-01' },
      { id: '002', title: 'Speed up parser', why: 'w', what: 'x', status: 'planned', depends_on: [], touches: ['src/tokenizer.js'], created_at: '2026-07-01' },
    ]);
    const { json } = run(['next-candidates', '--hint', 'tokenizer work']);
    assert.equal(json.candidates[0].id, '002');
  });

  test('--hint with no match keeps standard order and says so', () => {
    writeRoadmap(project, [
      { id: '001', title: 'older', why: 'w', what: 'x', status: 'planned', depends_on: [], touches: [], created_at: '2026-06-01' },
      { id: '002', title: 'newer', why: 'w', what: 'x', status: 'planned', depends_on: [], touches: [], created_at: '2026-07-01' },
    ]);
    const { json } = run(['next-candidates', '--hint', 'quantum blockchain']);
    assert.equal(json.hint_matched, false);
    assert.deepEqual(json.candidates.map((c) => c.id), ['001', '002']);
  });

  test('no --hint means no hint fields at all', () => {
    writeRoadmap(project, [{ id: '001', title: 'a', why: 'w', what: 'x', status: 'planned', depends_on: [] }]);
    const { json } = run(['next-candidates']);
    assert.equal(json.hint_matched, undefined);
    assert.equal(json.candidates[0].hint_score, undefined);
  });

  test('respects --limit and reports total_unblocked separately', () => {
    writeRoadmap(
      project,
      Array.from({ length: 8 }, (_, i) => ({
        id: String(i + 1).padStart(3, '0'),
        title: `task ${i + 1}`,
        status: 'planned',
        depends_on: [],
        touches: [],
        created_at: '2026-07-01',
      }))
    );
    const { json } = run(['next-candidates', '--limit', '3']);
    assert.equal(json.candidates.length, 3);
    assert.equal(json.total_unblocked, 8);
  });
});

describe('field length warnings', () => {
  test('add returns a warning for an overlong why, but still writes', () => {
    const { status, json } = run(['add'], {
      title: 'a',
      why: 'x'.repeat(300),
      what: 'a',
      source: 'user',
    });
    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.ok(json.warnings && json.warnings.some((w) => w.startsWith('why')));
    assert.equal(json.entry.why.length, 300); // written as given, not truncated
  });

  test('add has no warnings for normal-length fields', () => {
    const { json } = run(['add'], { title: 'a', why: 'short reason', what: 'short scope', source: 'user' });
    assert.equal(json.warnings, undefined);
  });

  test('update-status returns a warning for an overlong notes append', () => {
    writeRoadmap(project, [{ id: '001', title: 'a', why: 'a', what: 'a', status: 'planned', source: 'user', depends_on: [], touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '' }]);
    const { json } = run(['update-status'], { id: '001', status: 'planned', notes: 'y'.repeat(3500) });
    assert.ok(json.warnings && json.warnings.some((w) => w.startsWith('notes')));
  });
});

describe('atomic writes', () => {
  test('a write leaves no temp file behind next to ROADMAP.jsonl', () => {
    run(['add'], { title: 'a', why: 'a', what: 'a', source: 'user' });
    run(['update-status'], { id: '001', status: 'in_progress' });
    const leftovers = fs.readdirSync(project).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
    assert.ok(fs.existsSync(path.join(project, 'ROADMAP.jsonl')));
  });
});

describe('today', () => {
  test('returns the local date, not the UTC date', () => {
    const { today } = require('../scripts/roadmap');
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    assert.equal(today(), local);
  });
});

describe('corrupt file handling', () => {
  test('a malformed line fails loudly instead of being skipped', () => {
    fs.writeFileSync(path.join(project, 'ROADMAP.jsonl'), '{"id":"001"\nnot json at all\n', 'utf-8');
    const { status, json } = run(['list']);
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /not valid JSON/);
  });
});

describe('unknown subcommand', () => {
  test('errors with a helpful message', () => {
    const { status, json } = run(['bogus']);
    assert.equal(status, 1);
    assert.match(json.error, /unknown subcommand/);
  });
});

describe('doc field', () => {
  test('add accepts "none"', () => {
    const { status, json } = run(['add'], { title: 'a', why: 'a', what: 'a', source: 'user', doc: 'none' });
    assert.equal(status, 0);
    assert.equal(json.entry.doc, 'none');
  });

  test('add accepts a relative .md path', () => {
    const { status, json } = run(['add'], {
      title: 'a', why: 'a', what: 'a', source: 'user', doc: 'docs/foreman/001.md',
    });
    assert.equal(status, 0);
    assert.equal(json.entry.doc, 'docs/foreman/001.md');
  });

  test('add omits doc entirely when not given -- not defaulted', () => {
    const { json } = run(['add'], { title: 'a', why: 'a', what: 'a', source: 'user' });
    assert.equal('doc' in json.entry, false);
  });

  test('add rejects a value that is neither "none" nor .md', () => {
    const { status, json } = run(['add'], { title: 'a', why: 'a', what: 'a', source: 'user', doc: 'docs/foreman/001.txt' });
    assert.equal(status, 1);
    assert.match(json.error, /doc must be "none" or a relative path ending in \.md/);
  });

  test('add rejects an absolute posix path', () => {
    const { status, json } = run(['add'], { title: 'a', why: 'a', what: 'a', source: 'user', doc: '/docs/foreman/001.md' });
    assert.equal(status, 1);
    assert.match(json.error, /doc must be a relative path/);
  });

  test('add rejects a drive-letter path', () => {
    const { status, json } = run(['add'], { title: 'a', why: 'a', what: 'a', source: 'user', doc: 'C:/docs/001.md' });
    assert.equal(status, 1);
    assert.match(json.error, /doc must be a relative path/);
  });

  test('add rejects a path with a ".." traversal segment', () => {
    const { status, json } = run(['add'], { title: 'a', why: 'a', what: 'a', source: 'user', doc: '../secrets/001.md' });
    assert.equal(status, 1);
    assert.match(json.error, /doc must not contain "\.\." path segments/);
  });

  describe('update-status', () => {
    beforeEach(() => {
      writeRoadmap(project, [
        { id: '001', title: 'a', why: 'a', what: 'a', status: 'planned', source: 'user', depends_on: [], touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '' },
      ]);
    });

    test('accepts and sets doc', () => {
      const { status, json } = run(['update-status'], { id: '001', status: 'in_progress', doc: 'docs/foreman/001.md' });
      assert.equal(status, 0);
      assert.equal(json.entry.doc, 'docs/foreman/001.md');
    });

    test('accepts "none"', () => {
      const { json } = run(['update-status'], { id: '001', status: 'in_progress', doc: 'none' });
      assert.equal(json.entry.doc, 'none');
    });

    test('overwrites rather than appending on a second call -- not append-only like notes', () => {
      run(['update-status'], { id: '001', status: 'in_progress', doc: 'none' });
      const { json } = run(['update-status'], { id: '001', status: 'in_progress', doc: 'docs/foreman/001.md' });
      assert.equal(json.entry.doc, 'docs/foreman/001.md');
    });

    test('rejects an invalid value and does not write', () => {
      const { status, json } = run(['update-status'], { id: '001', status: 'in_progress', doc: '/abs/001.md' });
      assert.equal(status, 1);
      assert.match(json.error, /doc must be a relative path/);
    });

    test('omits doc when not given, leaving an entry with no doc untouched', () => {
      const { json } = run(['update-status'], { id: '001', status: 'in_progress' });
      assert.equal('doc' in json.entry, false);
    });
  });

  test('doc survives list serialization', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', why: 'a', what: 'a', status: 'planned', source: 'user', depends_on: [], touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '', doc: 'docs/foreman/001.md' },
      { id: '002', title: 'b', why: 'a', what: 'a', status: 'planned', source: 'user', depends_on: [], touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '' },
    ]);
    const { json } = run(['list']);
    assert.equal(json.entries.find((e) => e.id === '001').doc, 'docs/foreman/001.md');
    assert.equal('doc' in json.entries.find((e) => e.id === '002'), false);
  });

  test('doc survives next-candidates serialization for both candidates and in_progress', () => {
    writeRoadmap(project, [
      { id: '001', title: 'candidate', status: 'planned', why: 'w', what: 'x', depends_on: [], touches: [], doc: 'docs/foreman/001.md' },
      { id: '002', title: 'started', status: 'in_progress', why: 'w', what: 'x', depends_on: [], touches: [], doc: 'none' },
    ]);
    const { json } = run(['next-candidates']);
    assert.equal(json.candidates[0].doc, 'docs/foreman/001.md');
    assert.equal(json.in_progress[0].doc, 'none');
  });
});

describe('anchor comments (DECISION_ANCHOR_RE / anchorIdsIn / anchorHasId)', () => {
  const { anchorIdsIn, anchorHasId } = require('../scripts/roadmap');

  test('finds a single id in a single anchor comment', () => {
    assert.deepEqual(anchorIdsIn('// [Foreman: 019]\nfunction f() {}'), ['019']);
  });

  test('finds every id in a multi-id anchor comment', () => {
    assert.deepEqual(anchorIdsIn('// [Foreman: 019, 034]'), ['019', '034']);
  });

  test('tolerates no space around the comma', () => {
    assert.deepEqual(anchorIdsIn('[Foreman: 019,034]'), ['019', '034']);
  });

  test('dedupes ids repeated across separate anchor comments', () => {
    const text = '// [Foreman: 019]\n...\n// [Foreman: 019, 034]';
    assert.deepEqual(anchorIdsIn(text), ['019', '034']);
  });

  test('returns an empty array for null, undefined, or no match at all', () => {
    assert.deepEqual(anchorIdsIn(null), []);
    assert.deepEqual(anchorIdsIn(undefined), []);
    assert.deepEqual(anchorIdsIn('no anchors in this file'), []);
  });

  test('an id written in ordinary prose, without the [Foreman: ] wrapper, does not match', () => {
    assert.deepEqual(anchorIdsIn('see roadmap entry 019 and also 034 for context'), []);
  });

  test('a 4-digit run does not match -- ids are always exactly 3 digits', () => {
    assert.deepEqual(anchorIdsIn('[Foreman: 0199]'), []);
  });

  test('anchorHasId is true when the id is present in an anchor', () => {
    assert.equal(anchorHasId('// [Foreman: 019, 034]', '034'), true);
  });

  test('anchorHasId is false when the id is absent, or only appears unwrapped', () => {
    assert.equal(anchorHasId('// [Foreman: 019]', '034'), false);
    assert.equal(anchorHasId('see entry 034 in passing', '034'), false);
  });
});

describe('--help', () => {
  test('--help prints usage, not a JSON error', () => {
    const result = runRoadmap(['--help'], undefined, env);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /add\b/);
    assert.match(result.stdout, /next-candidates/);
    assert.throws(() => JSON.parse(result.stdout));
  });

  test('-h is the same as --help', () => {
    const result = runRoadmap(['-h'], undefined, env);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /update-status/);
  });

  test('no subcommand at all also prints usage', () => {
    const result = runRoadmap([], undefined, env);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /check-duplicate/);
  });
});
