'use strict';

// hooks/session-start.js — dangling in_progress surfacing:
//   - fires (raw stdout, no JSON envelope) when in_progress entries exist
//   - stays silent with no ROADMAP.jsonl, no in_progress entries, a corrupt
//     file, or a resume/compact source
//   - annotates entries with no recent activity with their last-touched date

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

function run(payload) {
  const result = runScriptRaw('session-start.js', payload, env);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('session-start in_progress surfacing', () => {
  test('fires when an in_progress entry exists', () => {
    writeRoadmap(project, [
      { id: '001', title: 'Ship the thing', status: 'in_progress', updated_at: localToday() },
    ]);
    const out = run({ source: 'startup' });
    assert.match(out, /\[Foreman\]/);
    assert.match(out, /001/);
    assert.match(out, /Ship the thing/);
    assert.match(out, /Informational only/);
  });

  test('stays silent when nothing is in_progress', () => {
    writeRoadmap(project, [{ id: '001', title: 'a', status: 'planned' }]);
    assert.equal(run({ source: 'startup' }), '');
  });

  test('stays silent with no ROADMAP.jsonl', () => {
    assert.equal(run({ source: 'startup' }), '');
  });

  test('stays silent on a corrupt roadmap', () => {
    fs.writeFileSync(path.join(project, 'ROADMAP.jsonl'), '{not json\n', 'utf-8');
    assert.equal(run({ source: 'startup' }), '');
  });

  test('stays silent on resume and compact sources (defensive, matcher already gates)', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', status: 'in_progress', updated_at: localToday() },
    ]);
    assert.equal(run({ source: 'resume' }), '');
    assert.equal(run({ source: 'compact' }), '');
  });

  test('clear source fires like startup', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', status: 'in_progress', updated_at: localToday() },
    ]);
    assert.notEqual(run({ source: 'clear' }), '');
  });

  test('a stale entry carries its last-activity date', () => {
    writeRoadmap(project, [
      { id: '002', title: 'old work', status: 'in_progress', updated_at: '2026-01-01' },
    ]);
    const out = run({ source: 'startup' });
    assert.match(out, /no activity since 2026-01-01/);
  });

  test('a recently-touched entry carries no staleness note', () => {
    writeRoadmap(project, [
      { id: '003', title: 'fresh work', status: 'in_progress', updated_at: localToday() },
    ]);
    const out = run({ source: 'startup' });
    assert.doesNotMatch(out, /no activity since/);
  });
});
