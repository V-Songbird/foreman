'use strict';

// hooks/session-start.js — dangling in_progress surfacing:
//   - fires when in_progress entries exist: raw stdout for Claude Code, the
//     SessionStart JSON envelope for Codex
//   - stays silent with no ROADMAP.jsonl, no in_progress entries, a corrupt
//     file, or a resume/compact source
//   - annotates entries with no recent activity with their last-touched date

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runScriptRaw, makeTmpProject, writeRoadmap } = require('./helpers');
const { archiveOfferStatePath } = require('../hooks/session-start');

let project;
let env;
const INSTALLED_ROOT = path.join(os.tmpdir(), 'plugins', 'cache', 'foundry', 'foreman', '9.9.9');

beforeEach(() => {
  project = makeTmpProject();
  // [Foreman: 540] An installed root, so the plugin-root line stays out of
  // the tests that are about the roadmap lines.
  env = { CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_ROOT: INSTALLED_ROOT };
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

// Local date math, not toISOString() — avoids the UTC-day drift near midnight.
function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
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

function terminalEntries(count) {
  const statuses = ['done', 'dropped', 'rejected'];
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1).padStart(3, '0'),
    title: `finished ${i + 1}`,
    status: statuses[i % statuses.length],
  }));
}

describe('session-start archive offer', () => {
  test('stays silent below the threshold', () => {
    writeRoadmap(project, terminalEntries(19));
    assert.equal(run({ source: 'startup' }), '');
  });

  test('offers to archive once the threshold is reached', () => {
    writeRoadmap(project, terminalEntries(20));
    const out = run({ source: 'startup' });
    assert.match(out, /\[Foreman\]/);
    assert.match(out, /20 finished entries/);
    assert.match(out, /archive/);
    assert.equal((out.match(/archive/g) || []).length, 1);
  });

  test('combines with the open-entries line when both apply', () => {
    writeRoadmap(project, [
      { id: '900', title: 'still going', status: 'in_progress', updated_at: localToday() },
      ...terminalEntries(20),
    ]);
    const out = run({ source: 'startup' });
    assert.match(out, /still going/);
    assert.match(out, /20 finished entries/);
  });

  test('stays silent on this line for a corrupt roadmap', () => {
    fs.writeFileSync(path.join(project, 'ROADMAP.jsonl'), '{not json\n', 'utf-8');
    assert.equal(run({ source: 'startup' }), '');
  });

  test('does not repeat on a second session the same day', () => {
    writeRoadmap(project, terminalEntries(20));
    const first = run({ source: 'startup' });
    assert.match(first, /20 finished entries/);
    const second = run({ source: 'startup' });
    assert.equal(second, '');
  });

  test('offers again once the state file says it last fired 8 days ago', () => {
    writeRoadmap(project, terminalEntries(20));
    fs.writeFileSync(
      archiveOfferStatePath(project),
      JSON.stringify({ date: daysAgoStr(8) }),
      'utf-8'
    );
    const out = run({ source: 'startup' });
    assert.match(out, /20 finished entries/);
  });

  test('a corrupt state file fails open — offers anyway', () => {
    writeRoadmap(project, terminalEntries(20));
    fs.writeFileSync(archiveOfferStatePath(project), 'not json', 'utf-8');
    const out = run({ source: 'startup' });
    assert.match(out, /20 finished entries/);
  });

  // [Foreman: 202] Valid JSON with an unparseable `date` must not fail closed
  // forever: daysBetween's NaN guard reads a garbage date as "0 days ago",
  // which would otherwise suppress the offer without ever rewriting the state.
  test('a garbage stored date fails open — offers anyway and rewrites the state', () => {
    writeRoadmap(project, terminalEntries(20));
    const statePath = archiveOfferStatePath(project);
    fs.writeFileSync(statePath, JSON.stringify({ date: 'garbage-not-a-date' }), 'utf-8');

    const out = run({ source: 'startup' });
    assert.match(out, /20 finished entries/);

    const rewritten = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    assert.equal(rewritten.date, localToday());
  });
});

// [Foreman: 540] A session started with --plugin-dir has no install record, so
// session-start names Foreman's root once; an installed session gets no line.
describe('session-start plugin root line', () => {
  test('a --plugin-dir session is told the root, with or without a roadmap', () => {
    const checkout = path.join(os.tmpdir(), 'foreman-checkout');
    const out = runScriptRaw('session-start.js', { source: 'startup' }, { CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_ROOT: checkout }).stdout;
    assert.equal(out.split('\n').filter((line) => line.startsWith('[Foreman] Plugin root: ')).length, 1, out);
    assert.ok(out.includes(checkout.replace(/\\/g, '/')), out);
  });

  test('an installed session and a Codex session get no root line', () => {
    writeRoadmap(project, []);
    assert.equal(run({ source: 'startup' }), '');
    const codex = runScriptRaw('session-start.js', { source: 'startup' }, { CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_ROOT: path.join(os.tmpdir(), 'foreman-checkout'), FOREMAN_HOST: 'codex' }).stdout;
    assert.doesNotMatch(codex, /Plugin root:/);
  });
});

describe('session-start on Codex', () => {
  // [Foreman: 868] Codex reads stdout that starts with "[" as JSON and drops
  // it when it does not parse, so a Codex session gets the notice inside the
  // SessionStart JSON envelope; Claude Code keeps the raw line.
  test('a Codex session gets the notice as SessionStart additionalContext JSON', () => {
    writeRoadmap(project, [
      { id: '001', title: 'Ship the thing', status: 'in_progress', updated_at: localToday() },
    ]);
    const raw = run({ source: 'startup' });
    const codex = runScriptRaw('session-start.js', { source: 'startup' }, { ...env, FOREMAN_HOST: 'codex' });
    assert.equal(codex.status, 0, codex.stderr);
    const parsed = JSON.parse(codex.stdout);
    assert.deepEqual(Object.keys(parsed), ['hookSpecificOutput']);
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(parsed.hookSpecificOutput.additionalContext, /^\[Foreman\] Roadmap entries still open: 001 \("Ship the thing"\)/);
    assert.match(parsed.hookSpecificOutput.additionalContext, /ask Foreman to resume, accept, or review\.$/);
    assert.match(raw, /^\[Foreman\] Roadmap entries still open: 001/);
    assert.equal(
      parsed.hookSpecificOutput.additionalContext,
      raw.replace('/foreman:roadmap offers to resume, accept, or review.', 'ask Foreman to resume, accept, or review.')
    );
  });

  test('a Codex session with nothing to say stays silent, not an empty envelope', () => {
    writeRoadmap(project, [{ id: '001', title: 'a', status: 'planned' }]);
    const codex = runScriptRaw('session-start.js', { source: 'startup' }, { ...env, FOREMAN_HOST: 'codex' });
    assert.equal(codex.stdout, '');
  });
});
