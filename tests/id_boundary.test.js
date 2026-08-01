'use strict';

// The 999 -> 1000 boundary, end to end. An id is three OR MORE digits,
// zero-padded to at least three (scripts/roadmap.js ID_PATTERN), so every
// place that creates, validates, parses, orders, or hands off an id has to
// survive the fourth digit.
//
// Covers:
//   - add computes 1000 after 999 (numeric max + 1, not lexicographic)
//   - update-status / annotate / update-deps / doctor all accept a 4-digit id
//   - doctor's invalid_id still rejects 07, 7, abc, and the over-padded 01000
//   - the commit trailer round-trips 1000 without truncating it to 100
//   - the task-created hook marks a 1000 entry from its handoff marker
//   - next-candidates ranks a mixed 3/4-digit roadmap by score, not by string

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  runRoadmap,
  runScriptRaw,
  makeTmpProject,
  writeRoadmap,
  initGitRepo,
} = require('./helpers');
const { commitTrailerFor, trailerIdsIn, isValidId, nextId } = require('../scripts/roadmap');

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
    touches: [],
    commits: [],
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    notes: '',
    ...overrides,
  };
}

describe('isValidId — the one shared id shape', () => {
  test('accepts three digits and everything past 999', () => {
    for (const id of ['000', '001', '019', '999', '1000', '1001', '10000']) {
      assert.equal(isValidId(id), true, id);
    }
  });

  test('rejects fewer than three digits, non-digits, and over-padding past 999', () => {
    for (const id of ['', '7', '07', 'abc', '00a', '01000', '0999', '1000.', ' 1000']) {
      assert.equal(isValidId(id), false, JSON.stringify(id));
    }
  });

  test('nextId crosses the boundary numerically', () => {
    assert.equal(nextId([{ id: '999' }]), '1000');
    assert.equal(nextId([{ id: '1000' }]), '1001');
    // A lexicographic max would pick "999" here and hand back "1000" twice.
    assert.equal(nextId([{ id: '999' }, { id: '1000' }, { id: '001' }]), '1001');
  });
});

// [Foreman: 188] Overwrite re-init: the old file is discarded, but its
// trailers and anchors persist in history, so the new generation's ids
// must continue past the old one instead of reusing them.
describe('ids_after floors a fresh generation', () => {
  test('the first add continues past the discarded generation, later adds follow', () => {
    const first = run(['add'], {
      title: 'first of the new generation', why: 'w', what: 'x', source: 'user', ids_after: '042',
    });
    assert.equal(first.status, 0);
    assert.equal(first.json.entry.id, '043');

    const second = run(['add'], { title: 'second', why: 'w', what: 'x', source: 'user' });
    assert.equal(second.json.entry.id, '044');
  });

  test('a floor below the natural next id changes nothing', () => {
    writeRoadmap(project, [entry('100')]);
    const { json } = run(['add'], {
      title: 'still natural', why: 'w', what: 'x', source: 'user', ids_after: '005',
    });
    assert.equal(json.entry.id, '101');
  });

  test('crosses the 999 boundary numerically like everything else', () => {
    const { json } = run(['add'], {
      title: 'past the boundary', why: 'w', what: 'x', source: 'user', ids_after: '999',
    });
    assert.equal(json.entry.id, '1000');
  });

  test('a malformed ids_after is refused', () => {
    for (const bad of ['42', 'abc', '01000']) {
      const { status, json } = run(['add'], {
        title: `bad ${bad}`, why: 'w', what: 'x', source: 'user', ids_after: bad,
      });
      assert.equal(status, 1, bad);
      assert.match(json.error, /ids_after must be a Foreman entry id/);
    }
  });
});

describe('add past 999', () => {
  test('an add on a roadmap whose max id is 999 yields 1000', () => {
    writeRoadmap(project, [entry('001'), entry('999')]);
    const { status, json } = run(['add'], {
      title: 'Fourth digit', why: 'boundary', what: 'boundary', source: 'user',
    });
    assert.equal(status, 0);
    assert.equal(json.entry.id, '1000');
  });

  test('the next add continues past it, and 1000 is usable as a dependency', () => {
    writeRoadmap(project, [entry('999')]);
    run(['add'], { title: 'a', why: 'a', what: 'a', source: 'user' });
    const { status, json } = run(['add'], {
      title: 'b', why: 'b', what: 'b', source: 'user', depends_on: ['1000'],
    });
    assert.equal(status, 0);
    assert.equal(json.entry.id, '1001');
    assert.deepEqual(json.entry.depends_on, ['1000']);
  });
});

describe('mutations and doctor on a 4-digit id', () => {
  test('update-status transitions 1000 and doctor stays clean', () => {
    writeRoadmap(project, [entry('1000')]);
    const updated = run(['update-status'], { id: '1000', status: 'done', commit: 'a1b2c3d' });
    assert.equal(updated.status, 0);
    assert.equal(updated.json.entry.id, '1000');
    assert.equal(updated.json.entry.status, 'done');

    const report = run(['doctor']).json;
    assert.deepEqual(report.findings.filter((f) => f.code === 'invalid_id'), []);
    assert.equal(report.summary.errors, 0);
  });

  test('annotate appends to 1000', () => {
    writeRoadmap(project, [entry('1000')]);
    const { status, json } = run(['annotate'], { id: '1000', notes: 'a finding' });
    assert.equal(status, 0);
    assert.match(json.entry.notes, /a finding$/);
  });

  test('update-deps adds and removes an edge between 999 and 1000', () => {
    writeRoadmap(project, [entry('999'), entry('1000')]);
    const added = run(['update-deps'], { id: '1000', add_depends_on: ['999'] });
    assert.equal(added.status, 0);
    assert.deepEqual(added.json.entry.depends_on, ['999']);

    const removed = run(['update-deps'], { id: '1000', remove_depends_on: ['999'] });
    assert.equal(removed.status, 0);
    assert.deepEqual(removed.json.entry.depends_on, []);
  });

  test('list --ids finds 1000 and does not match it as 100', () => {
    writeRoadmap(project, [entry('100'), entry('1000')]);
    const { json } = run(['list', '--ids', '1000']);
    assert.deepEqual(json.entries.map((e) => e.id), ['1000']);
  });

  test('doctor still flags ids under three digits, non-digits, and over-padding', () => {
    for (const bad of ['07', '7', 'abc', '01000']) {
      project = makeTmpProject();
      env = { CLAUDE_PROJECT_DIR: project };
      writeRoadmap(project, [entry(bad)]);
      const findings = run(['doctor']).json.findings.filter((f) => f.code === 'invalid_id');
      assert.equal(findings.length, 1, `expected invalid_id for ${bad}`);
      assert.equal(findings[0].severity, 'error');
    }
  });
});

describe('commit trailer round-trip past 999', () => {
  test('commitTrailerFor(1000) is parsed back as 1000', () => {
    assert.equal(commitTrailerFor('1000'), 'Foreman: 1000');
    assert.deepEqual(trailerIdsIn(`subject\n\n${commitTrailerFor('1000')}`), ['1000']);
  });

  test('a staged close on 1000 returns the trailer that parses back', () => {
    writeRoadmap(project, [entry('1000')]);
    initGitRepo(project);
    spawnSync('git', ['add', 'ROADMAP.jsonl'], { cwd: project });
    spawnSync('git', ['commit', '-q', '-m', 'roadmap'], { cwd: project });

    const { status, json } = run(['update-status'], { id: '1000', status: 'done', staged: true });
    assert.equal(status, 0);
    assert.equal(json.trailer, 'Foreman: 1000');
    assert.deepEqual(trailerIdsIn(`close it\n\n${json.trailer}`), ['1000']);
  });
});

describe('task-created hook on a 4-digit marker', () => {
  test('marks entry 1000 in_progress from its handoff marker', () => {
    writeRoadmap(project, [entry('100'), entry('1000')]);
    const result = runScriptRaw('task-created.js', {
      hook_event_name: 'TaskCreated',
      task_id: '1',
      task_subject: 'Do the thing',
      task_description:
        'This task is ROADMAP.jsonl entry `1000`. Mark it in_progress before doing anything else.',
    }, env);
    assert.equal(result.status, 0, result.stderr);

    const entries = fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(entries.find((e) => e.id === '1000').status, 'in_progress');
    // The 3-digit prefix of the marked id must not be swept along.
    assert.equal(entries.find((e) => e.id === '100').status, 'planned');
  });
});

describe('next-candidates over a mixed 3/4-digit roadmap', () => {
  test('ranks by unblocks_total, not by id string width', () => {
    writeRoadmap(project, [
      entry('999', { created_at: '2026-01-01' }),
      entry('1000', { created_at: '2026-01-02' }),
      entry('001', { depends_on: ['1000'], created_at: '2026-01-03' }),
      entry('002', { depends_on: ['001'], created_at: '2026-01-04' }),
    ]);

    const { json } = run(['next-candidates', '--limit', '5']);
    // 1000 unblocks 001 -> 002, so it outranks the standalone 999 despite
    // sorting after it as a string and being created later.
    assert.deepEqual(json.candidates.map((c) => c.id), ['1000', '999']);
    assert.equal(json.candidates[0].unblocks_total, 2);
    assert.equal(json.total_unblocked, 2);
  });

  test('a 4-digit blocker still gates its dependent until it is done', () => {
    writeRoadmap(project, [
      entry('1000'),
      entry('1001', { depends_on: ['1000'] }),
    ]);
    assert.deepEqual(run(['next-candidates']).json.candidates.map((c) => c.id), ['1000']);

    run(['update-status'], { id: '1000', status: 'done', commit: 'a1b2c3d' });
    assert.deepEqual(run(['next-candidates']).json.candidates.map((c) => c.id), ['1001']);
  });
});
