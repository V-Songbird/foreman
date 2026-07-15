'use strict';

// hooks/task-created.js — mechanical planned -> in_progress on a task
// created from a Foreman handoff:
//   - fires only when the task description carries the embedded entry marker
//   - performs exactly the planned -> in_progress transition, nothing else
//   - silent no-op for every other state, a missing/corrupt roadmap, or a
//     description without the marker

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runScriptRaw, makeTmpProject, writeRoadmap } = require('./helpers');

let project;
let env;

beforeEach(() => {
  project = makeTmpProject();
  env = { CLAUDE_PROJECT_DIR: project };
});

function payload(description) {
  return {
    hook_event_name: 'TaskCreated',
    task_id: '1',
    task_subject: 'Do the thing',
    task_description: description,
  };
}

function run(p) {
  const result = runScriptRaw('task-created.js', p, env);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function readEntry(id) {
  const lines = fs
    .readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return lines.find((e) => e.id === id);
}

const MARKER = 'This task is ROADMAP.jsonl entry `001`. Mark it in_progress before doing anything else.';

describe('task-created marks the named entry in_progress', () => {
  test('planned entry named by the marker becomes in_progress', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', status: 'planned', notes: '', commits: [], touches: [], depends_on: [] },
    ]);
    run(payload(MARKER));
    assert.equal(readEntry('001').status, 'in_progress');
  });

  test('stays silent on stdout', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', status: 'planned', notes: '', commits: [], touches: [], depends_on: [] },
    ]);
    assert.equal(run(payload(MARKER)), '');
  });

  test('a description without the marker changes nothing', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', status: 'planned', notes: '', commits: [], touches: [], depends_on: [] },
    ]);
    run(payload('An ordinary task about entry 001 with no marker phrase.'));
    assert.equal(readEntry('001').status, 'planned');
  });

  test('never regresses a non-planned entry', () => {
    for (const status of ['in_progress', 'done', 'dropped', 'deferred', 'rejected']) {
      writeRoadmap(project, [
        { id: '001', title: 'a', status, notes: '', commits: [], touches: [], depends_on: [] },
      ]);
      run(payload(MARKER));
      assert.equal(readEntry('001').status, status, `status ${status} must survive`);
    }
  });

  test('unknown entry id is a silent no-op', () => {
    writeRoadmap(project, [
      { id: '002', title: 'b', status: 'planned', notes: '', commits: [], touches: [], depends_on: [] },
    ]);
    run(payload(MARKER)); // names 001, which does not exist
    assert.equal(readEntry('002').status, 'planned');
  });

  test('no ROADMAP.jsonl is a silent no-op', () => {
    assert.equal(run(payload(MARKER)), '');
  });

  test('corrupt roadmap is a silent no-op', () => {
    fs.writeFileSync(path.join(project, 'ROADMAP.jsonl'), '{broken\n', 'utf-8');
    assert.equal(run(payload(MARKER)), '');
  });

  test('a non-TaskCreated event is ignored defensively', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', status: 'planned', notes: '', commits: [], touches: [], depends_on: [] },
    ]);
    run({ ...payload(MARKER), hook_event_name: 'TaskCompleted' });
    assert.equal(readEntry('001').status, 'planned');
  });
});

describe('task-created marker tolerates a paraphrased (non-backticked) id', () => {
  test('no backticks at all still matches', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', status: 'planned', notes: '', commits: [], touches: [], depends_on: [] },
    ]);
    run(payload('This task is ROADMAP.jsonl entry 001. Mark it in_progress first.'));
    assert.equal(readEntry('001').status, 'in_progress');
  });

  test('one backtick (mixed/malformed) still matches', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', status: 'planned', notes: '', commits: [], touches: [], depends_on: [] },
    ]);
    run(payload('This task is ROADMAP.jsonl entry `001. Mark it in_progress first.'));
    assert.equal(readEntry('001').status, 'in_progress');
  });

  test('multiple numbers in the description: the first marker wins', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', status: 'planned', notes: '', commits: [], touches: [], depends_on: [] },
      { id: '002', title: 'b', status: 'planned', notes: '', commits: [], touches: [], depends_on: [] },
    ]);
    run(
      payload(
        'This task is ROADMAP.jsonl entry `001`. It relates to ROADMAP.jsonl entry `002` as a dependency.'
      )
    );
    assert.equal(readEntry('001').status, 'in_progress');
    assert.equal(readEntry('002').status, 'planned');
  });

  test('garbage description with numbers but no marker phrase changes nothing', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', status: 'planned', notes: '', commits: [], touches: [], depends_on: [] },
    ]);
    run(payload('Random notes: see item 001, ticket #001, section 001 of the doc.'));
    assert.equal(readEntry('001').status, 'planned');
  });
});
