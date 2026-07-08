'use strict';

// Tests for hooks/post-commit.js — the only hook Foreman ships post-redesign.
//
// Covers:
//   - only fires on Bash/PowerShell tool calls that are actually `git commit`
//   - silent when ROADMAP.jsonl doesn't exist (zero-config: never ran /foreman:init)
//   - status-sync block appears whenever an in_progress entry exists, or a
//     done entry was updated earlier today (same-day follow-up fix commit)
//   - discovery block appears only when .foreman/config.json has discoverySuggestions:true
//   - requireVerification:true withholds the done transition until the user
//     confirms, without affecting the freshly-done follow-up branch
//   - malformed/missing config is treated as discoverySuggestions:false and
//     requireVerification:false
//   - a failed commit (confirmed nonzero exit code) stays silent
//   - a commit with no confirmed exit code fails open (still fires)

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { runScriptRaw, makeTmpProject, writeRoadmap, writeConfig } = require('./helpers');

let project;
let env;

beforeEach(() => {
  project = makeTmpProject();
  env = { CLAUDE_PROJECT_DIR: project };
});

function bashPayload(command, extra) {
  return { tool_name: 'Bash', tool_input: { command }, ...(extra || {}) };
}

function run(payload) {
  const result = runScriptRaw('post-commit.js', payload, env);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

describe('non-matching tool calls', () => {
  test('non-Bash/PowerShell tool stays silent', () => {
    const out = run({ tool_name: 'Read', tool_input: { file_path: 'x' } });
    assert.equal(out, '');
  });

  test('Bash command that is not a git commit stays silent', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git status'));
    assert.equal(out, '');
  });

  test('git commit as a substring of another word stays silent', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('echo "not-a-git-commit-invocation"'));
    assert.equal(out, '');
  });
});

describe('no ROADMAP.jsonl', () => {
  test('stays completely silent — never ran /foreman:init', () => {
    const out = run(bashPayload('git commit -m "wip"'));
    assert.equal(out, '');
  });
});

describe('status-sync block', () => {
  test('fires when an in_progress entry exists, discovery off', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.match(out, /status-sync|in-progress ROADMAP/i);
    assert.doesNotMatch(out, /Roadmap discovery is enabled/);
  });

  test('does not fire when nothing is in_progress', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    const out = run(bashPayload('git commit -m "unrelated"'));
    assert.equal(out, '');
  });

  test('mentions that touches auto-folds from the commit, no manual listing needed', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.match(out, /auto-folds/);
  });

  test('git commit --amend still fires', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit --amend --no-edit'));
    assert.notEqual(out, '');
  });

  test('git commit inside a && chain still fires', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git add -A && git commit -m "wip"'));
    assert.notEqual(out, '');
  });

  test('PowerShell tool_name also matches', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const result = runScriptRaw(
      'post-commit.js',
      { tool_name: 'PowerShell', tool_input: { command: 'git commit -m "wip"' } },
      env
    );
    assert.notEqual(result.stdout, '');
  });
});

describe('freshly-done follow-up fix', () => {
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  test('fires when a done entry was updated earlier today', () => {
    writeRoadmap(project, [
      { id: '001', title: 'ship the thing', status: 'done', updated_at: todayStr() },
    ]);
    const out = run(bashPayload('git commit -m "fix bug found right after"'));
    assert.match(out, /follow-up fix/i);
    assert.match(out, /001/);
    assert.match(out, /auto-folds/);
  });

  test('does not fire for a done entry updated on an earlier day', () => {
    writeRoadmap(project, [
      { id: '001', title: 'ship the thing', status: 'done', updated_at: '2020-01-01' },
    ]);
    const out = run(bashPayload('git commit -m "unrelated later work"'));
    assert.equal(out, '');
  });

  test('in_progress and freshly-done both surface together', () => {
    writeRoadmap(project, [
      { id: '001', title: 'older task', status: 'in_progress' },
      { id: '002', title: 'ship the thing', status: 'done', updated_at: todayStr() },
    ]);
    const out = run(bashPayload('git commit -m "wip"'));
    assert.match(out, /in-progress ROADMAP/i);
    assert.match(out, /follow-up fix/i);
  });
});

describe('requireVerification gate', () => {
  test('default (off): nudges to mark done directly', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.match(out, /may complete an in-progress/i);
    assert.doesNotMatch(out, /requireVerification is on/);
  });

  test('on: records the commit but withholds done until the user confirms', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    writeConfig(project, { requireVerification: true });
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.match(out, /requireVerification is on/);
    assert.match(out, /AskUserQuestion/);
    assert.match(out, /don't close it out yet/);
    assert.match(out, /confirmation/i);
  });

  test('on: does not affect the freshly-done follow-up branch', () => {
    writeRoadmap(project, [
      { id: '001', title: 'ship the thing', status: 'done', updated_at: new Date().toISOString().slice(0, 10) },
    ]);
    writeConfig(project, { requireVerification: true });
    const out = run(bashPayload('git commit -m "fix bug found right after"'));
    assert.match(out, /follow-up fix/i);
    assert.doesNotMatch(out, /requireVerification is on/);
  });

  test('malformed config treated as requireVerification:false', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.doesNotMatch(out, /requireVerification is on/);
  });
});

describe('discovery block', () => {
  test('fires when discoverySuggestions is true', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    writeConfig(project, { discoverySuggestions: true });
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.match(out, /Roadmap discovery is enabled/);
  });

  test('also asks Claude to scan for already-implemented, unplanned scope creep', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    writeConfig(project, { discoverySuggestions: true });
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.match(out, /inverse case/);
    assert.match(out, /Log it/);
  });

  test('does not fire when config is missing', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.equal(out, '');
  });

  test('does not fire when config is malformed JSON', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.equal(out, '');
  });

  test('does not fire when discoverySuggestions is explicitly false', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    writeConfig(project, { discoverySuggestions: false });
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.equal(out, '');
  });

  test('both blocks fire together when applicable', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    writeConfig(project, { discoverySuggestions: true });
    const out = run(bashPayload('git commit -m "wip"'));
    assert.match(out, /Roadmap discovery is enabled/);
    assert.match(out, /in-progress ROADMAP/i);
  });
});

describe('exit-code gating (best-effort)', () => {
  test('confirmed nonzero exit code stays silent', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "wip"', { exit_code: 1 }));
    assert.equal(out, '');
  });

  test('confirmed zero exit code still fires', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "wip"', { exit_code: 0 }));
    assert.notEqual(out, '');
  });

  test('missing exit code field fails open (still fires)', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "wip"'));
    assert.notEqual(out, '');
  });
});
