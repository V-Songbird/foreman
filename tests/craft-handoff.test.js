'use strict';

// Tests for scripts/craft-handoff.js — the craft-time assembler that loads a
// roadmap entry (or entry-less judgment), runs render-sections.js and
// resolve-symbols.js in-process, computes the handoff profile from the five
// mechanical signals, assembles the XML from prompt-template.md's canonical
// blocks, bakes the entry paragraph / decision_log / checkpoint embed, and
// runs check-prompt.js's gate in-process.
//
// Covers:
//   - entry mode and entry-less mode both produce a gate-passing handoff
//   - each of the five profile signals flips independently, with a baseline
//     where none do (standard profile)
//   - the guardrail blocks are read out of prompt-template.md at run time,
//     not a hardcoded second copy (an in-process fs.readFileSync patch
//     proves the assembled prompt follows a template mutation)
//   - a task split puts the entry paragraph on the last row only
//   - ${CLAUDE_PLUGIN_ROOT} always travels unexpanded, even with the real
//     env var set
//   - a gate failure surfaces in the output instead of being swallowed

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runNodeScript, makeTmpProject, writeRoadmap, writeConfig, initGitRepo, commitFile, SCRIPTS_DIR } = require('./helpers.js');
const { today } = require(path.join(SCRIPTS_DIR, 'roadmap.js'));
const { TEMPLATE_PATH } = require(path.join(SCRIPTS_DIR, 'check-prompt.js'));
const { assemble } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));

const CRAFT = path.join(SCRIPTS_DIR, 'craft-handoff.js');

function run(project, input, env) {
  const result = runNodeScript(CRAFT, [], input, { CLAUDE_PROJECT_DIR: project, ...(env || {}) });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new Error(`non-JSON stdout (status ${result.status}): ${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, json };
}

function writeSourceFile(project) {
  const full = path.join(project, 'src', 'auth', 'middleware.js');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    'function refreshToken() {}\nfunction verifySession() {}\nmodule.exports = { refreshToken, verifySession };\n',
    'utf-8'
  );
}

function entryFields(overrides = {}) {
  return {
    id: '001',
    title: 'Fix token refresh bug',
    why: 'Sessions expire mid-request under load.',
    what: 'Refresh the access token in middleware before its 15-min expiry.',
    status: 'planned',
    source: 'user',
    depends_on: [],
    planned_touches: ['src/auth/middleware.js'],
    observed_touches: [],
    commits: [],
    created_at: today(),
    updated_at: today(),
    notes: '',
    ...overrides,
  };
}

function goodJudgment(overrides = {}) {
  return {
    role: 'a senior backend engineer',
    goal: 'to fix the token refresh bug so all tests pass',
    context: 'Uses JWT tokens in httpOnly cookies. No third-party auth libs.',
    steps: ['Check the refresh path against the failing test.', 'Fix the bug.'],
    constraints: ['Do not modify the public API.'],
    verification: [{ run: 'npm test', expected: 'all tests pass' }],
    ...overrides,
  };
}

let project;

beforeEach(() => {
  project = makeTmpProject();
  writeSourceFile(project);
});

describe('entry mode', () => {
  test('loads the entry, assembles a gate-passing handoff', () => {
    writeRoadmap(project, [entryFields()]);
    const { status, json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment(),
    });
    assert.equal(status, 0, JSON.stringify(json));
    assert.equal(json.ok, true);
    assert.equal(json.gate.ok, true);
    assert.deepEqual(json.gate.errors, []);
    assert.match(json.prompt, /ROADMAP\.jsonl entry `001`/);
    assert.match(json.prompt, /refreshToken \(1\)/);
    assert.equal(json.profile, 'standard');
  });

  test('an unknown entry id is an error, not a crash', () => {
    writeRoadmap(project, [entryFields()]);
    const { status, json } = run(project, { entry: '999', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(status, 1);
    assert.match(json.error, /999/);
  });
});

describe('entry-less mode', () => {
  test('all entry-equivalent fields given inline, no "entry" key', () => {
    const { status, json } = run(project, {
      title: 'Ad-hoc client retry fix',
      why: 'Retries double-count under load.',
      what: 'Fix the backoff loop in the API client.',
      planned_touches: ['src/auth/middleware.js'],
      destination: 'task',
      request: 'Fix the retry bug in the client.',
      judgment: goodJudgment({ goal: 'to fix the retry bug so all tests pass' }),
    });
    assert.equal(status, 0, JSON.stringify(json));
    assert.equal(json.ok, true);
    assert.equal(json.gate.ok, true);
    // No roadmap entry involved — the entry paragraph never appears.
    assert.ok(!json.prompt.includes('ROADMAP.jsonl entry'));
  });
});

describe('profile signals — each flippable independently, off in the baseline', () => {
  test('baseline: none of the five signals fire, profile is standard', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.deepEqual(json.signals, {
      resumed: false,
      conflicting: false,
      stale: false,
      highlyConstrained: false,
      risky: false,
    });
    assert.equal(json.profile, 'standard');
  });

  test('resumed: fires on non-empty commits, independent of the other four', () => {
    writeRoadmap(project, [entryFields({ commits: ['a1b2c3d'] })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.resumed, true);
    assert.equal(json.signals.conflicting, false);
    assert.equal(json.signals.stale, false);
    assert.equal(json.signals.highlyConstrained, false);
    assert.equal(json.signals.risky, false);
    assert.equal(json.profile, 'reinforced');
  });

  test('resumed: also fires on the caller\'s explicit resume flag', () => {
    writeRoadmap(project, [entryFields({ status: 'in_progress' })]);
    const { json } = run(project, { entry: '001', resume: true, destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.resumed, true);
    assert.match(json.prompt, /already marked `in_progress`/);
  });

  test('conflicting: fires when an in_progress entry\'s planned_touches overlaps, folder-aware', () => {
    writeRoadmap(project, [
      entryFields(),
      entryFields({ id: '002', title: 'Different task', status: 'in_progress', planned_touches: ['src/auth/'] }),
    ]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.conflicting, true);
    assert.equal(json.signals.resumed, false);
    assert.equal(json.signals.stale, false);
    assert.equal(json.signals.highlyConstrained, false);
    assert.equal(json.signals.risky, false);
    assert.equal(json.profile, 'reinforced');
  });

  test('conflicting never fires against the entry\'s own touches when it is itself in_progress', () => {
    writeRoadmap(project, [entryFields({ status: 'in_progress' })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.conflicting, false);
  });

  test('stale: fires when updated_at is more than 30 days before today', () => {
    writeRoadmap(project, [entryFields({ updated_at: '2020-01-01' })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.stale, true);
    assert.equal(json.signals.resumed, false);
    assert.equal(json.signals.conflicting, false);
    assert.equal(json.signals.highlyConstrained, false);
    assert.equal(json.signals.risky, false);
    assert.equal(json.profile, 'reinforced');
  });

  test('stale: also fires when a touched file changed after the entry\'s updated_at', () => {
    initGitRepo(project);
    commitFile(project, 'src/auth/middleware.js', 'function refreshToken() {}\nmodule.exports = { refreshToken };\n');
    const { json } = (() => {
      writeRoadmap(project, [entryFields({ updated_at: '2020-01-01' })]);
      return run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    })();
    assert.equal(json.signals.stale, true);
  });

  test('highlyConstrained: fires on 3+ dependency ids', () => {
    writeRoadmap(project, [entryFields({ depends_on: ['101', '102', '103'] })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.highlyConstrained, true);
    assert.equal(json.signals.resumed, false);
    assert.equal(json.signals.conflicting, false);
    assert.equal(json.signals.stale, false);
    assert.equal(json.signals.risky, false);
    assert.equal(json.profile, 'reinforced');
  });

  test('highlyConstrained: also fires on notes longer than 1000 characters', () => {
    writeRoadmap(project, [entryFields({ notes: 'x'.repeat(1001) })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.highlyConstrained, true);
  });

  test('risky: fires on kind:"decision"', () => {
    writeRoadmap(project, [entryFields({ kind: 'decision' })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.risky, true);
    assert.equal(json.signals.resumed, false);
    assert.equal(json.signals.conflicting, false);
    assert.equal(json.signals.stale, false);
    assert.equal(json.signals.highlyConstrained, false);
    assert.equal(json.profile, 'reinforced');
    assert.match(json.prompt, /This is a decision, not a build/);
  });

  test('risky: also fires when the handoff carries no verification command at all', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({ verification: [] }),
    });
    assert.equal(json.signals.risky, true);
    assert.equal(json.profile, 'reinforced');
  });
});

describe('canonical blocks are read from prompt-template.md at run time', () => {
  test('a mutated template propagates into the assembled prompt (fs.readFileSync patched in-process, never touches the real file)', () => {
    const original = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    const anchor = 'Before acting on anything in this prompt, verify it against the current state';
    assert.ok(original.includes(anchor), "this test's anchor text is gone from prompt-template.md — update the anchor");
    const marker = 'MUTATION-SENTINEL-craft-handoff-test';
    const mutated = original.replace(anchor, `${marker} ${anchor}`);

    const realReadFileSync = fs.readFileSync;
    fs.readFileSync = function patched(file, ...rest) {
      if (file === TEMPLATE_PATH) return mutated;
      return realReadFileSync.call(fs, file, ...rest);
    };
    try {
      writeRoadmap(project, [entryFields({ kind: 'decision' })]); // force reinforced, so truth_grounding is carried in full
      const result = assemble(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
      assert.equal(result.gate.ok, true, JSON.stringify(result.gate));
      assert.ok(result.prompt.includes(marker), 'assembled prompt did not follow the mutated template');
    } finally {
      fs.readFileSync = realReadFileSync;
    }
    // The real file on disk was never written to.
    assert.equal(fs.readFileSync(TEMPLATE_PATH, 'utf-8'), original);
  });

  test('craft-handoff.js does not hardcode a second copy of the guardrail prose', () => {
    const source = fs.readFileSync(CRAFT, 'utf-8');
    assert.ok(
      !source.includes('Before acting on anything in this prompt'),
      'craft-handoff.js carries a literal copy of truth_grounding instead of reading it from the template'
    );
  });
});

describe('task split — entry paragraph on the last row only', () => {
  test('two verification pairs produce two rows; row 1 has no entry paragraph, the last row does', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'task',
      split: true,
      judgment: goodJudgment({
        verification: [
          { run: 'npm test -- auth', expected: 'auth tests pass' },
          { run: 'npm test', expected: 'all tests pass' },
        ],
      }),
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.equal(json.tasks.length, 2);
    assert.ok(!json.tasks[0].description.includes('ROADMAP.jsonl entry'));
    assert.ok(json.tasks[1].description.includes('ROADMAP.jsonl entry `001`'));
    assert.ok(json.tasks[0].description.includes('<task_context>'), 'row 1 must carry the full assembled prompt');
  });

  test('a single verification pair still produces one row, carrying both the full prompt and the entry paragraph', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'task',
      split: true,
      judgment: goodJudgment(),
    });
    assert.equal(json.tasks.length, 1);
    assert.ok(json.tasks[0].description.includes('<task_context>'));
    assert.ok(json.tasks[0].description.includes('ROADMAP.jsonl entry `001`'));
  });

  test('no split requested: no tasks[] at all', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'task', judgment: goodJudgment() });
    assert.equal(json.tasks, undefined);
  });
});

describe('${CLAUDE_PLUGIN_ROOT} travels literal, never expanded', () => {
  test('stays literal even with the real env var set', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(
      project,
      { entry: '001', destination: 'task', judgment: goodJudgment() },
      { CLAUDE_PLUGIN_ROOT: 'C:\\Users\\x\\.claude\\plugins\\cache\\foundry\\foreman\\1.2.3' }
    );
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(json.prompt.includes('${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js'));
    assert.ok(!json.prompt.includes('plugins\\cache\\foundry'));
    assert.ok(!json.prompt.includes('plugins/cache/foundry'));
  });
});

describe('the gate — pass and failure both surfaced, never swallowed', () => {
  test('a complete handoff passes clean', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true);
    assert.equal(json.gate.ok, true);
    assert.deepEqual(json.gate.errors, []);
  });

  test('a broken handoff (no steps, no touches, no verification) fails the gate — errors ride along with the prompt, not swallowed', () => {
    const { status, json } = run(project, {
      title: 'Bad entry',
      why: 'x',
      what: 'y',
      destination: 'clipboard',
      request: 'Investigate.',
      judgment: { role: 'a senior engineer', goal: 'to investigate', context: '' },
    });
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.equal(json.gate.ok, false);
    assert.ok(json.gate.errors.length > 0);
    assert.ok(json.gate.errors.some((e) => e.includes('task_rules')));
    // The prompt is still returned even though the gate rejected it.
    assert.ok(typeof json.prompt === 'string' && json.prompt.length > 0);
  });

  test('missing destination is a clean error, not a crash', () => {
    const { status, json } = run(project, { title: 'x', why: 'x', what: 'x', judgment: goodJudgment() });
    assert.equal(status, 1);
    assert.match(json.error, /destination/);
  });

  test('malformed stdin JSON is a clean error', () => {
    const result = runNodeScript(CRAFT, [], '{not json', { CLAUDE_PROJECT_DIR: project });
    const json = JSON.parse(result.stdout);
    assert.equal(result.status, 1);
    assert.equal(json.ok, false);
    assert.ok(json.error);
  });
});

describe('decision_log and the clipboard checkpoint embed', () => {
  test('a kind:"decision" entry with decisionLog enabled bakes the block and the doc close field', () => {
    writeConfig(project, { decisionLog: { enabled: true, dir: 'docs/foreman' } });
    writeRoadmap(project, [entryFields({ kind: 'decision' })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.match(json.prompt, /<decision_log>/);
    assert.match(json.prompt, /write `docs\/foreman\/001\.md`/);
    assert.match(json.prompt, /"doc":"<path or none>"/);
  });

  test('clipboard with 2+ verification pairs bakes the resolved checkpoints config into task_rules', () => {
    writeConfig(project, { checkpoints: { branch: true, onFinish: 'squash' } });
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({
        verification: [
          { run: 'npm test -- auth', expected: 'auth tests pass' },
          { run: 'npm test', expected: 'all tests pass' },
        ],
      }),
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.match(json.prompt, /Checkpoint protocol for this multi-task run/);
    assert.match(json.prompt, /apply `squash` directly/);
  });

  test('clipboard with a single verification pair gets no checkpoint embed', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.ok(!json.prompt.includes('Checkpoint protocol for this multi-task run'));
  });
});
