'use strict';

// Tests for `roadmap.js archive` / `restore` — the terminal-entry lifecycle
// across ROADMAP.jsonl and .foreman/archive.jsonl.
//
// Covers:
//   - archive moves terminal entries verbatim: gone from list and
//     next-candidates, present in list --archived, ids and fields intact
//   - a non-terminal or unknown id refuses the whole call, moving nothing
//   - restore is the exact inverse, byte-identical, and refuses an id the
//     active file already carries with different content
//   - id continuity: add after archiving the highest id yields the next id,
//     never a reissue
//   - add's exact-title dedup and check-duplicate both see archived entries
//   - an active entry depending on an archived done parent is ready, both in
//     next-candidates and under the require_ready dispatch guard
//   - an archived dropped parent still strands its active dependent in doctor
//   - the interrupted-move state (one id in both files) is a doctor
//     duplicate_across_files error, and re-running the move finishes it
//   - the guard hook denies direct edits of archive.jsonl
//   - the archive carries the same format marker as the roadmap
//   - update-status/annotate/update-deps/correct on an archived id refuse and
//     name restore

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runRoadmap, runScriptRaw, makeTmpProject, writeRoadmap } = require('./helpers');

const META = '{"foreman_roadmap_format":2}';

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

function entry(id, overrides = {}) {
  return {
    id,
    title: `task ${id}`,
    why: `rationale ${id}`,
    what: `work ${id}`,
    status: 'planned',
    source: 'user',
    depends_on: [],
    planned_touches: [],
    observed_touches: [],
    commits: [],
    created_at: '2026-07-01',
    updated_at: '2026-07-01',
    notes: '',
    ...overrides,
  };
}

function archiveFile() {
  return path.join(project, '.foreman', 'archive.jsonl');
}

/** Write .foreman/archive.jsonl by hand — for crafting a crashed move. */
function writeArchiveRaw(lines) {
  fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
  fs.writeFileSync(archiveFile(), `${lines.join('\n')}\n`, 'utf-8');
}

function archiveLines() {
  if (!fs.existsSync(archiveFile())) return [];
  return fs.readFileSync(archiveFile(), 'utf-8').split('\n').filter(Boolean);
}

function roadmapLines() {
  return fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8').split('\n').filter(Boolean);
}

describe('archive', () => {
  test('moves terminal entries out of the active views and into --archived', () => {
    writeRoadmap(project, [
      entry('001', { status: 'done', commits: ['a1b2c3d'] }),
      entry('002', { status: 'dropped' }),
      entry('003'),
    ]);
    const { status, json } = run(['archive'], { ids: ['001', '002'] });
    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.deepEqual(json.archived, ['001', '002']);
    assert.equal(json.active_count, 1);
    assert.equal(json.archived_count, 2);

    assert.deepEqual(run(['list']).json.entries.map((e) => e.id), ['003']);
    assert.deepEqual(
      run(['list', '--archived']).json.entries.map((e) => e.id),
      ['001', '002']
    );
    const candidates = run(['next-candidates']).json;
    assert.deepEqual(candidates.candidates.map((c) => c.id), ['003']);
  });

  test('entries keep their id, fields, and status verbatim', () => {
    const done = entry('001', { status: 'done', commits: ['a1b2c3d'], notes: 'shipped' });
    writeRoadmap(project, [done, entry('002')]);
    run(['archive'], { ids: ['001'] });
    const [archived] = run(['list', '--archived']).json.entries;
    assert.deepEqual(archived, done);
  });

  test('--archived combines with --ids, --status and --summary', () => {
    writeRoadmap(project, [
      entry('001', { status: 'done', commits: ['a1'] }),
      entry('002', { status: 'dropped' }),
    ]);
    run(['archive'], { ids: ['001', '002'] });
    assert.deepEqual(
      run(['list', '--archived', '--status', 'dropped']).json.entries.map((e) => e.id),
      ['002']
    );
    assert.deepEqual(
      run(['list', '--archived', '--ids', '001']).json.entries.map((e) => e.id),
      ['001']
    );
    assert.deepEqual(run(['list', '--archived', '--summary']).json.entries[0], {
      id: '001',
      title: 'task 001',
      status: 'done',
      depends_on: [],
      planned_touches: [],
    });
  });

  test('the archive carries the same format marker as the roadmap', () => {
    writeRoadmap(project, [entry('001', { status: 'done', commits: ['a1'] })]);
    run(['archive'], { ids: ['001'] });
    assert.equal(archiveLines()[0], META);
    assert.equal(archiveLines().length, 2);
  });

  test('a non-terminal id refuses the whole call — nothing moves', () => {
    writeRoadmap(project, [
      entry('001', { status: 'done', commits: ['a1'] }),
      entry('002', { status: 'in_progress' }),
    ]);
    const { status, json } = run(['archive'], { ids: ['001', '002'] });
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /entry 002 is in_progress/);
    assert.deepEqual(run(['list']).json.entries.map((e) => e.id), ['001', '002']);
    assert.deepEqual(archiveLines(), []);
  });

  test('an unknown id refuses the whole call', () => {
    writeRoadmap(project, [entry('001', { status: 'done', commits: ['a1'] })]);
    const { status, json } = run(['archive'], { ids: ['001', '404'] });
    assert.equal(status, 1);
    assert.match(json.error, /no entry with id 404 in ROADMAP\.jsonl/);
    assert.deepEqual(run(['list']).json.entries.map((e) => e.id), ['001']);
    assert.deepEqual(archiveLines(), []);
  });

  test('ids must be a non-empty array', () => {
    writeRoadmap(project, [entry('001', { status: 'done', commits: ['a1'] })]);
    assert.match(run(['archive'], { ids: [] }).json.error, /non-empty array/);
    assert.match(run(['archive'], {}).json.error, /non-empty array/);
  });
});

describe('restore', () => {
  test('round-trips an entry back verbatim', () => {
    const done = entry('001', { status: 'done', commits: ['a1b2c3d'], notes: 'shipped' });
    writeRoadmap(project, [done, entry('002')]);
    const before = roadmapLines().slice(1); // entry lines only, marker aside
    run(['archive'], { ids: ['001'] });

    const { status, json } = run(['restore'], { ids: ['001'] });
    assert.equal(status, 0);
    assert.deepEqual(json.restored, ['001']);
    assert.equal(json.active_count, 2);
    assert.equal(json.archived_count, 0);
    const restored = run(['list', '--ids', '001']).json.entries[0];
    // Both are derived at read time, not stored — strip them before comparing
    // against the entry as it was written. [Foreman: 134]
    delete restored.depends_on_docs;
    delete restored.commit_evidence;
    assert.deepEqual(restored, done);
    // The roadmap holds the same entries it started with (plus the marker).
    assert.deepEqual(roadmapLines().slice(1).sort(), before.sort());
    assert.deepEqual(run(['list', '--archived']).json.entries, []);
  });

  test('refuses an id the active file already carries with other content', () => {
    writeRoadmap(project, [entry('001', { status: 'done', commits: ['a1'] })]);
    writeArchiveRaw([META, JSON.stringify(entry('001', { status: 'dropped' }))]);
    const { status, json } = run(['restore'], { ids: ['001'] });
    assert.equal(status, 1);
    assert.match(json.error, /in both ROADMAP\.jsonl and \.foreman\/archive\.jsonl/);
    assert.equal(run(['list']).json.entries[0].status, 'done');
  });

  test('an id that is not archived refuses the whole call', () => {
    writeRoadmap(project, [entry('001')]);
    const { status, json } = run(['restore'], { ids: ['001'] });
    assert.equal(status, 1);
    assert.match(json.error, /entry 001 is already active/);
  });
});

describe('id continuity', () => {
  test('add after archiving the highest id yields the next id, never a reissue', () => {
    writeRoadmap(project, [
      entry('001', { status: 'done', commits: ['a1'] }),
      entry('002', { status: 'done', commits: ['a2'] }),
    ]);
    run(['archive'], { ids: ['001', '002'] });
    const { json } = run(['add'], { title: 'next', why: 'w', what: 'x', source: 'user' });
    assert.equal(json.entry.id, '003');
  });

  test('add dedups against an archived exact title and writes nothing', () => {
    writeRoadmap(project, [entry('001', { status: 'done', commits: ['a1'] })]);
    run(['archive'], { ids: ['001'] });
    const { status, json } = run(['add'], {
      title: 'task 001',
      why: 'w',
      what: 'x',
      source: 'user',
    });
    assert.equal(status, 0);
    assert.equal(json.deduped, true);
    assert.equal(json.archived, true);
    assert.equal(json.entry.id, '001');
    assert.deepEqual(run(['list']).json.entries, []);
    assert.equal(run(['list', '--archived']).json.entries.length, 1);
  });

  test('check-duplicate matches archived entries, flagged as archived', () => {
    writeRoadmap(project, [
      entry('001', {
        status: 'done',
        commits: ['a1'],
        title: 'Add JWT refresh middleware',
        why: 'Sessions expire mid-request under load',
      }),
    ]);
    run(['archive'], { ids: ['001'] });
    const { json } = run(['check-duplicate'], {
      title: 'Add JWT refresh middleware',
      why: 'Sessions expire mid-request under load',
    });
    assert.equal(json.duplicate, true);
    assert.equal(json.matches[0].id, '001');
    assert.equal(json.matches[0].archived, true);
    assert.equal(json.matches[0].status, 'done');
  });
});

describe('dependencies across the boundary', () => {
  test('an active entry waiting on an archived done parent is ready', () => {
    writeRoadmap(project, [
      entry('001', { status: 'done', commits: ['a1'] }),
      entry('002', { depends_on: ['001'] }),
    ]);
    run(['archive'], { ids: ['001'] });
    const { json } = run(['next-candidates']);
    assert.deepEqual(json.candidates.map((c) => c.id), ['002']);
  });

  test('the require_ready dispatch guard accepts an archived done parent', () => {
    writeRoadmap(project, [
      entry('001', { status: 'done', commits: ['a1'] }),
      entry('002', { depends_on: ['001'] }),
    ]);
    run(['archive'], { ids: ['001'] });
    const { status, json } = run(['update-status'], {
      id: '002',
      status: 'in_progress',
      expected_status: 'planned',
      require_ready: true,
    });
    assert.equal(status, 0);
    assert.equal(json.skipped, undefined);
    assert.equal(json.entry.status, 'in_progress');
  });

  test('an archived dropped parent still strands its active dependent', () => {
    writeRoadmap(project, [
      entry('001', { status: 'dropped' }),
      entry('002', { depends_on: ['001'] }),
    ]);
    run(['archive'], { ids: ['001'] });
    const { json } = run(['doctor']);
    const stranded = json.findings.filter((f) => f.code === 'stranded_dependency');
    assert.equal(stranded.length, 1);
    assert.deepEqual(stranded[0].ids, ['002']);
    // Not "missing" — the parent resolved, out of the archive.
    assert.deepEqual(json.findings.filter((f) => f.code === 'missing_dependency'), []);
    assert.equal(json.summary.errors, 0);
  });

  test('add accepts a depends_on id that lives in the archive', () => {
    writeRoadmap(project, [entry('001', { status: 'done', commits: ['a1'] })]);
    run(['archive'], { ids: ['001'] });
    const { status, json } = run(['add'], {
      title: 'follow-up',
      why: 'w',
      what: 'x',
      source: 'user',
      depends_on: ['001'],
    });
    assert.equal(status, 0);
    assert.deepEqual(json.entry.depends_on, ['001']);
  });
});

describe('an interrupted move', () => {
  // The crash window: the destination write landed, the source rewrite did
  // not, so the id sits in both files.
  function crashedState() {
    const done = entry('003', { status: 'done', commits: ['a3'] });
    writeRoadmap(project, [entry('001'), done]);
    writeArchiveRaw([META, JSON.stringify(done)]);
    return done;
  }

  test('doctor reports duplicate_across_files and names the repair', () => {
    crashedState();
    const { json } = run(['doctor']);
    const found = json.findings.filter((f) => f.code === 'duplicate_across_files');
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].ids, ['003']);
    assert.equal(found[0].severity, 'error');
    assert.match(found[0].message, /re-run "roadmap\.js archive"/);
    assert.equal(json.ok, false);
  });

  test('re-running archive finishes the move and clears the finding', () => {
    const done = crashedState();
    const { status, json } = run(['archive'], { ids: ['003'] });
    assert.equal(status, 0);
    assert.deepEqual(json.archived, ['003']);
    assert.equal(json.active_count, 1);
    assert.equal(json.archived_count, 1);
    assert.deepEqual(run(['list']).json.entries.map((e) => e.id), ['001']);
    assert.deepEqual(run(['list', '--archived']).json.entries, [done]);
    assert.deepEqual(
      run(['doctor']).json.findings.filter((f) => f.code === 'duplicate_across_files'),
      []
    );
  });

  test('re-running restore finishes the move in the other direction', () => {
    const done = crashedState();
    const { status, json } = run(['restore'], { ids: ['003'] });
    assert.equal(status, 0);
    assert.deepEqual(json.restored, ['003']);
    assert.deepEqual(run(['list']).json.entries.map((e) => e.id), ['001', '003']);
    assert.deepEqual(run(['list', '--archived']).json.entries, []);
    assert.equal(run(['list', '--ids', '003']).json.entries[0].status, done.status);
  });
});

describe('mutations refuse an archived id', () => {
  beforeEach(() => {
    writeRoadmap(project, [
      entry('001', { status: 'done', commits: ['a1'] }),
      entry('002'),
    ]);
    run(['archive'], { ids: ['001'] });
  });

  const cases = [
    ['update-status', { id: '001', status: 'planned' }],
    ['annotate', { id: '001', notes: 'a note' }],
    ['update-deps', { id: '001', add_depends_on: ['002'] }],
    ['correct', { id: '001', expected_updated_at: '2026-07-01', why: 'new' }],
  ];

  for (const [sub, payload] of cases) {
    test(`${sub} says restore first`, () => {
      const { status, json } = run([sub], payload);
      assert.equal(status, 1);
      assert.equal(json.ok, false);
      assert.match(json.error, /entry 001 is archived/);
      assert.match(json.error, /restore/);
      // Untouched.
      assert.equal(run(['list', '--archived']).json.entries[0].status, 'done');
    });
  }

  test('an id in neither file still says "no entry"', () => {
    const { json } = run(['annotate'], { id: '404', notes: 'x' });
    assert.match(json.error, /no entry with id 404/);
  });
});

describe('the guard hook covers archive.jsonl', () => {
  function guard(payload) {
    const result = runScriptRaw('guard-roadmap-edit.js', payload, {});
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }

  test('Edit of .foreman/archive.jsonl is denied', () => {
    const out = guard({
      tool_name: 'Edit',
      tool_input: { file_path: 'D:/project/.foreman/archive.jsonl' },
    });
    const payload = JSON.parse(out);
    assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(payload.hookSpecificOutput.permissionDecisionReason, /archive\.jsonl/);
    assert.match(payload.hookSpecificOutput.permissionDecisionReason, /roadmap\.js/);
  });

  test('Write of archive.jsonl is denied regardless of path prefix', () => {
    const out = guard({
      tool_name: 'Write',
      tool_input: { file_path: '/deep/nested/ARCHIVE.JSONL' },
    });
    assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny');
  });

  test('Bash still repairs a corrupt archive — the escape hatch stays open', () => {
    assert.equal(
      guard({ tool_name: 'Bash', tool_input: { command: 'echo fix > archive.jsonl' } }),
      ''
    );
  });
});
