'use strict';

// [Foreman: 135] The branch-merge aftermath: two branches computed the same
// next id, so the merged roadmap carries two entries claiming it. These tests
// pin both halves of the repair — the facts `doctor` reports about the
// collision, and what `reassign-id` does (and refuses to do) about it — plus
// the read behavior the repair depends on: a duplicated file is still fully
// readable, which is what keeps the repair reachable at all.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  makeTmpProject,
  writeRoadmap,
  initGitRepo,
  runRoadmap,
} = require('./helpers');

let project;

function entry(id, extra) {
  return {
    id,
    title: `Task ${id}`,
    why: `Task ${id} matters`,
    what: `Implement task ${id}`,
    status: 'planned',
    source: 'user',
    depends_on: [],
    planned_touches: [],
    observed_touches: [],
    commits: [],
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    notes: '',
    ...extra,
  };
}

function run(argv, stdin) {
  const result = runRoadmap(argv, stdin, { CLAUDE_PROJECT_DIR: project });
  return { status: result.status, json: JSON.parse(result.stdout) };
}

function writeArchiveFile(entries) {
  const dir = path.join(project, '.foreman');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'archive.jsonl'),
    // Stamped like the roadmap: an unstamped one would auto-migrate on the
    // first write and add an unrelated "migrated" field these tests don't
    // assert on. [Foreman: 130]
    ['{"foreman_roadmap_format":2}', ...entries.map((e) => JSON.stringify(e))].join('\n') + '\n',
    'utf-8'
  );
}

/** Parsed rows of a roadmap/archive file, format marker dropped. */
function readFileRows(relPath) {
  const full = path.join(project, relPath);
  if (!fs.existsSync(full)) return [];
  return fs
    .readFileSync(full, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((row) => row.id !== undefined);
}

/** Commit with an explicit message. Returns the short sha. */
function commitWithMessage(relPath, content, message) {
  const full = path.join(project, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  spawnSync('git', ['add', relPath], { cwd: project });
  spawnSync('git', ['commit', '-q', '-m', message], { cwd: project });
  return spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: project, encoding: 'utf-8' }).stdout.trim();
}

/**
 * The merged file: branch A and branch B each added an entry as `130`, and
 * each side has a dependent pointing at it.
 */
function mergedRoadmap() {
  writeRoadmap(project, [
    entry('129'),
    entry('130', { title: 'Cache the rate lookup' }),
    entry('130', { title: 'Retry the webhook', status: 'done', notes: 'landed on branch B' }),
    entry('131', { depends_on: ['130'] }),
    entry('132', { depends_on: ['130'] }),
  ]);
}

function findingFor(json, code) {
  return json.findings.find((item) => item.code === code);
}

beforeEach(() => {
  project = makeTmpProject();
});

describe('doctor describes a duplicated id', () => {
  test('the duplicate finding names every holder, every dependent, and the commits carrying the trailer', () => {
    initGitRepo(project);
    mergedRoadmap();
    const sha = commitWithMessage('src/a.js', 'a', 'Retry the webhook\n\nForeman: 130');

    const { json } = run(['doctor']);
    const dup = findingFor(json, 'duplicate_id');

    assert.equal(dup.severity, 'error');
    assert.deepEqual(dup.ids, ['130']);
    assert.deepEqual(dup.detail.holders, [
      { title: 'Cache the rate lookup', status: 'planned', created_at: '2026-01-01' },
      { title: 'Retry the webhook', status: 'done', created_at: '2026-01-01' },
    ]);
    assert.deepEqual(dup.detail.dependents, [{ id: '131' }, { id: '132' }]);
    assert.deepEqual(dup.detail.trailer_commits, [sha]);
    assert.equal(dup.detail.trailer_commit_count, 1);
    // The message stands on its own for a reader who never opens `detail`.
    assert.match(dup.message, /id 130 appears on 2 lines/);
    assert.match(dup.message, /"Cache the rate lookup" \(planned, created 2026-01-01\)/);
    assert.match(dup.message, /depended on by 131, 132/);
    assert.match(dup.message, new RegExp(`1 commit carries "Foreman: 130" \\(${sha}\\)`));
    assert.match(dup.message, /reassign-id/);
  });

  test('an archived holder is described too, and reported on the cross-file finding', () => {
    writeRoadmap(project, [entry('130', { title: 'Active side' }), entry('131', { depends_on: ['130'] })]);
    writeArchiveFile([entry('130', { title: 'Archived side', status: 'done', notes: 'done last month' })]);

    const { json } = run(['doctor']);
    const across = findingFor(json, 'duplicate_across_files');

    assert.deepEqual(across.detail.holders, [
      { title: 'Active side', status: 'planned', created_at: '2026-01-01' },
      { title: 'Archived side', status: 'done', created_at: '2026-01-01', archived: true },
    ]);
    assert.deepEqual(across.detail.dependents, [{ id: '131' }]);
  });

  test('no git to ask leaves the trailer facts absent rather than reported as none', () => {
    mergedRoadmap();

    const dup = findingFor(run(['doctor']).json, 'duplicate_id');

    assert.equal('trailer_commits' in dup.detail, false);
    assert.equal('trailer_commit_count' in dup.detail, false);
    assert.equal(dup.detail.holders.length, 2);
  });

  test('a healthy roadmap gets no duplicate detail at all', () => {
    initGitRepo(project);
    writeRoadmap(project, [entry('129'), entry('130')]);

    const { json } = run(['doctor']);

    assert.equal(json.ok, true);
    assert.equal(json.findings.some((item) => 'detail' in item), false);
  });
});

describe('reassign-id repairs the duplicate', () => {
  test('the named title keeps the id, the other holder is renumbered to max+1 with a note', () => {
    initGitRepo(project);
    mergedRoadmap();
    const sha = commitWithMessage('src/a.js', 'a', 'Retry the webhook\n\nForeman: 130');

    const { status, json } = run(['reassign-id'], { id: '130', keep: 'Cache the rate lookup' });

    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.deepEqual(json.kept, { id: '130', title: 'Cache the rate lookup' });
    assert.equal(json.reassigned.length, 1);
    assert.equal(json.reassigned[0].from, '130');
    assert.equal(json.reassigned[0].to, '133');
    assert.equal(json.reassigned[0].title, 'Retry the webhook');
    // Commit history is immutable: the mismatch is surfaced, never rewritten.
    assert.deepEqual(json.reassigned[0].trailer_commits, [sha]);
    assert.deepEqual(json.dependents_on_kept, ['131', '132']);

    const rows = readFileRows('ROADMAP.jsonl');
    const kept = rows.find((row) => row.title === 'Cache the rate lookup');
    const moved = rows.find((row) => row.title === 'Retry the webhook');
    assert.equal(kept.id, '130');
    assert.equal(kept.updated_at, '2026-01-01', 'the kept holder is not rewritten');
    assert.equal(moved.id, '133');
    assert.match(
      moved.notes,
      /id reassigned from 130 during duplicate repair; commit trailers Foreman: 130 predate the reassignment/
    );
    assert.match(moved.notes, /^landed on branch B\n\d{4}-\d{2}-\d{2} id reassigned/);
    assert.notEqual(moved.updated_at, '2026-01-01');
  });

  test('dependents are untouched and still point at the kept holder', () => {
    mergedRoadmap();

    run(['reassign-id'], { id: '130', keep: 'Retry the webhook' });

    const rows = readFileRows('ROADMAP.jsonl');
    for (const id of ['131', '132']) {
      const dependent = rows.find((row) => row.id === id);
      assert.deepEqual(dependent.depends_on, ['130']);
      assert.equal(dependent.updated_at, '2026-01-01');
    }
    assert.equal(rows.find((row) => row.title === 'Retry the webhook').id, '130');
    assert.equal(rows.find((row) => row.title === 'Cache the rate lookup').id, '133');
  });

  test('the repaired file passes the write gate and doctors clean', () => {
    mergedRoadmap();

    run(['reassign-id'], { id: '130', keep: 'Cache the rate lookup' });
    const { json } = run(['doctor']);

    assert.equal(json.ok, true);
    assert.equal(json.summary.errors, 0);
    // Still mutable afterwards, through the ordinary path.
    const annotated = run(['annotate'], { id: '133', notes: 'still writable' });
    assert.equal(annotated.json.ok, true);
  });

  test('id continuity: the next add takes the id after the renumbered one', () => {
    mergedRoadmap();

    run(['reassign-id'], { id: '130', keep: 'Cache the rate lookup' });
    const added = run(['add'], { title: 'Next thing', why: 'w', what: 'x', source: 'user' });

    assert.equal(added.json.entry.id, '134');
  });

  test('three holders are renumbered one each, in file order', () => {
    writeRoadmap(project, [
      entry('130', { title: 'Branch A' }),
      entry('130', { title: 'Branch B' }),
      entry('130', { title: 'Branch C' }),
    ]);

    const { json } = run(['reassign-id'], { id: '130', keep: 'Branch B' });

    assert.deepEqual(
      json.reassigned.map((item) => [item.title, item.to]),
      [['Branch A', '131'], ['Branch C', '132']]
    );
    assert.equal(run(['doctor']).json.summary.errors, 0);
  });
});

describe('reassign-id across the active/archive boundary', () => {
  function splitDuplicate() {
    writeRoadmap(project, [entry('130', { title: 'Active side' }), entry('131', { depends_on: ['130'] })]);
    writeArchiveFile([entry('130', { title: 'Archived side', status: 'done', notes: 'done last month' })]);
  }

  test('the active holder keeps the id and the archived twin is renumbered in place', () => {
    splitDuplicate();

    const { json } = run(['reassign-id'], { id: '130', keep: 'Active side' });

    assert.deepEqual(json.kept, { id: '130', title: 'Active side' });
    assert.deepEqual(json.reassigned.map((item) => item.to), ['132']);
    assert.deepEqual(json.dependents_on_kept, ['131']);

    const archived = readFileRows('.foreman/archive.jsonl');
    assert.equal(archived[0].id, '132');
    assert.match(archived[0].notes, /id reassigned from 130 during duplicate repair/);
    assert.equal(readFileRows('ROADMAP.jsonl').find((row) => row.title === 'Active side').id, '130');
    assert.equal(run(['doctor']).json.summary.errors, 0);
  });

  test('the archived holder can keep it instead, renumbering the active one', () => {
    splitDuplicate();

    const { json } = run(['reassign-id'], { id: '130', keep: 'Archived side' });

    assert.deepEqual(json.kept, { id: '130', title: 'Archived side' });
    assert.deepEqual(json.reassigned.map((item) => [item.title, item.to]), [['Active side', '132']]);

    assert.equal(readFileRows('.foreman/archive.jsonl')[0].id, '130');
    assert.equal(readFileRows('ROADMAP.jsonl').find((row) => row.title === 'Active side').id, '132');
    // The dependent still names 130, which now unambiguously means the
    // archived holder — the link is preserved, not re-pointed.
    assert.deepEqual(readFileRows('ROADMAP.jsonl').find((row) => row.id === '131').depends_on, ['130']);
    assert.equal(run(['doctor']).json.summary.errors, 0);
  });
});

describe('reassign-id refusals', () => {
  test('an id only one entry holds has nothing to repair', () => {
    writeRoadmap(project, [entry('129'), entry('130')]);

    const { status, json } = run(['reassign-id'], { id: '130', keep: 'Task 130' });

    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /id 130 is held by exactly one entry/);
  });

  test('an id no entry holds says so', () => {
    writeRoadmap(project, [entry('129')]);

    const { json } = run(['reassign-id'], { id: '130', keep: 'Task 130' });

    assert.match(json.error, /no entry with id 130 in ROADMAP\.jsonl or \.foreman\/archive\.jsonl/);
  });

  test('a keep title no holder has names the titles that are available', () => {
    mergedRoadmap();

    const { status, json } = run(['reassign-id'], { id: '130', keep: 'Cache the rate lookups' });

    assert.equal(status, 1);
    assert.match(json.error, /no holder of 130 has the title "Cache the rate lookups"/);
    assert.match(json.error, /"Cache the rate lookup", "Retry the webhook"/);
    assert.equal(readFileRows('ROADMAP.jsonl').filter((row) => row.id === '130').length, 2);
  });

  test('two holders with the same title are a manual dedup, not a renumbering', () => {
    writeRoadmap(project, [
      entry('130', { title: 'Add the retry' }),
      entry('130', { title: 'Add the retry', status: 'done', notes: 'branch B' }),
    ]);

    const { status, json } = run(['reassign-id'], { id: '130', keep: 'Add the retry' });

    assert.equal(status, 1);
    assert.match(json.error, /2 holders of 130 share the title "Add the retry"/);
    assert.match(json.error, /manual dedup/);
    assert.equal(readFileRows('ROADMAP.jsonl').length, 2, 'nothing was written');
  });

  test('a stale expected_updated_at_kept refuses without writing', () => {
    mergedRoadmap();

    const { status, json } = run(['reassign-id'], {
      id: '130',
      keep: 'Cache the rate lookup',
      expected_updated_at_kept: '2020-01-01',
    });

    assert.equal(status, 1);
    assert.match(json.error, /was last updated 2026-01-01, not 2020-01-01/);
    assert.equal(readFileRows('ROADMAP.jsonl').filter((row) => row.id === '130').length, 2);
  });

  test('a matching expected_updated_at_kept goes through', () => {
    mergedRoadmap();

    const { json } = run(['reassign-id'], {
      id: '130',
      keep: 'Cache the rate lookup',
      expected_updated_at_kept: '2026-01-01',
    });

    assert.equal(json.ok, true);
  });

  test('id and keep are both required', () => {
    mergedRoadmap();

    assert.match(run(['reassign-id'], { keep: 'Cache the rate lookup' }).json.error, /requires id/);
    assert.match(run(['reassign-id'], { id: '130' }).json.error, /requires keep/);
  });
});

describe('a duplicated file stays readable before the repair', () => {
  test('list returns both holders as separate rows', () => {
    mergedRoadmap();

    const { status, json } = run(['list', '--summary']);

    assert.equal(status, 0);
    assert.deepEqual(
      json.entries.filter((row) => row.id === '130').map((row) => row.title),
      ['Cache the rate lookup', 'Retry the webhook']
    );
  });

  test('next-candidates and check-duplicate both run and see both holders', () => {
    mergedRoadmap();

    const candidates = run(['next-candidates', '--limit', '5']);
    assert.equal(candidates.status, 0);
    assert.equal(candidates.json.candidates.some((row) => row.title === 'Cache the rate lookup'), true);

    const duplicate = run(['check-duplicate'], { title: 'Retry the webhook', why: 'Task 130 matters' });
    assert.equal(duplicate.status, 0);
    assert.equal(duplicate.json.matches.filter((row) => row.id === '130').length, 2);
  });

  test('a mutation on the duplicated id resolves to the FIRST holder only', () => {
    mergedRoadmap();

    const { status, json } = run(['update-status'], { id: '130', status: 'in_progress' });

    assert.equal(status, 0);
    assert.equal(json.entry.title, 'Cache the rate lookup');
    const rows = readFileRows('ROADMAP.jsonl').filter((row) => row.id === '130');
    assert.deepEqual(rows.map((row) => row.status), ['in_progress', 'done']);
  });

  test('a mutation elsewhere in the file is not blocked by the inherited duplicate', () => {
    mergedRoadmap();

    const { status, json } = run(['annotate'], { id: '129', notes: 'unrelated breadcrumb' });

    assert.equal(status, 0);
    assert.match(json.entry.notes, /unrelated breadcrumb/);
    assert.equal(readFileRows('ROADMAP.jsonl').filter((row) => row.id === '130').length, 2);
  });
});
