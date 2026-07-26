'use strict';

// hooks/user-suggestion.js — UserPromptSubmit capture for suggestions the
// user voices in conversation:
//   - opt-in: silent unless .foreman/config.json has userSuggestions:true
//   - missing, malformed, and absent-key configs all read as off
//   - silent with no ROADMAP.jsonl (never ran /foreman:init)
//   - fires as raw stdout, no JSON envelope
//   - carries the check-duplicate call, the ask-first rule, and the
//     spawn_task ban

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runScriptRaw, makeTmpProject, writeRoadmap, writeConfig } = require('./helpers');

let project;
let env;

beforeEach(() => {
  project = makeTmpProject();
  env = { CLAUDE_PROJECT_DIR: project };
});

function run(payload = { prompt: 'the picker feels clunky' }) {
  const result = runScriptRaw('user-suggestion.js', payload, env);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

describe('user-suggestion opt-in', () => {
  test('fires when userSuggestions is true', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    writeConfig(project, { userSuggestions: true });
    assert.match(run(), /User-suggestion capture is on/);
  });

  test('stays silent when userSuggestions is false', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    writeConfig(project, { userSuggestions: false });
    assert.equal(run(), '');
  });

  test('stays silent when the key is absent — the default is off', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    writeConfig(project, { discoverySuggestions: true });
    assert.equal(run(), '');
  });

  test('stays silent with no config file at all', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    assert.equal(run(), '');
  });

  test('stays silent on a malformed config rather than failing open', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    assert.equal(run(), '');
  });

  test('a truthy non-true value does not count as enabled', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    writeConfig(project, { userSuggestions: 'yes' });
    assert.equal(run(), '');
  });

  test('stays silent with no ROADMAP.jsonl even when enabled', () => {
    writeConfig(project, { userSuggestions: true });
    assert.equal(run(), '');
  });
});

describe('user-suggestion block content', () => {
  beforeEach(() => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    writeConfig(project, { userSuggestions: true });
  });

  test('emits raw stdout, not a JSON envelope', () => {
    const out = run();
    assert.ok(out.startsWith('[Foreman]'), out.slice(0, 40));
    assert.throws(() => JSON.parse(out));
  });

  test('routes through check-duplicate before proposing anything', () => {
    assert.match(run(), /check-duplicate/);
  });

  test('records the suggestion as user-sourced, not claude-suggested', () => {
    const out = run();
    assert.match(out, /"source":"user"/);
    assert.doesNotMatch(out, /claude-suggested/);
  });

  test('never acts without asking, and never uses spawn_task', () => {
    const out = run();
    assert.match(out, /Never act without asking/);
    assert.match(out, /Never call mcp__ccd_session__spawn_task/);
  });

  test('an ordinary request produces no commentary', () => {
    assert.match(run(), /Say nothing at all when the message is an ordinary request/);
  });

  test('executing the suggestion still logs it', () => {
    assert.match(run(), /Executing it does not excuse logging it/);
  });
});

describe('user-suggestion registration', () => {
  test('the hook is wired to UserPromptSubmit', () => {
    const hooks = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf-8')
    );
    const entries = hooks.hooks.UserPromptSubmit;
    assert.ok(Array.isArray(entries) && entries.length, 'UserPromptSubmit is not registered');
    const commands = entries.flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(
      commands.some((c) => c.includes('user-suggestion.js')),
      'user-suggestion.js is not wired to UserPromptSubmit'
    );
    for (const entry of entries) {
      for (const hook of entry.hooks) {
        assert.ok(hook.commandWindows, 'the hook lost its Windows command variant');
        assert.ok(hook.command.includes('${CLAUDE_PLUGIN_ROOT}'), 'plugin root must stay unexpanded');
      }
    }
  });
});
