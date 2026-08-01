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
const { TEMPLATE_PATH, WORKFLOW_STAGE_SENTENCE } = require(path.join(SCRIPTS_DIR, 'check-prompt.js'));
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

  // Defect 1 (adversarial review): the branch-settling line hardcoded "with
  // branch creation on, " ahead of branchAction, so branch:false produced
  // "...with branch creation on, checkpoint in place (branch creation is
  // off)" — self-contradicting.
  test('branch:true keeps the "with branch creation on" wording', () => {
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
    assert.match(
      json.prompt,
      /settle the branch first: detect the base branch.*; with branch creation on, create `foreman\/<slug>`/
    );
  });

  test('branch:false drops the "with branch creation on" clause entirely — no contradiction', () => {
    writeConfig(project, { checkpoints: { baseBranch: 'develop', branch: false, onFinish: 'pr' } });
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
    assert.ok(!json.prompt.includes('with branch creation on'), 'branch:false must not carry the on-wording');
    assert.match(
      json.prompt,
      /settle the branch first: the base branch is `develop`; checkpoint in place \(branch creation is off\)/
    );
  });
});

// Defect 2 (adversarial review): the baked entry paragraph dropped the
// model/effort self-report channel roadmap-schema.md:112-113 documents.
describe('entry paragraph — model/effort self-report channel', () => {
  test('task/clipboard destinations get the self-report instruction for both fields', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.match(json.prompt, /Also add `model` and `effort` to that close call — what actually ran this task/);
  });

  test('an agent destination with no confirmed model also gets the both-fields instruction', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'agent', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.match(json.prompt, /Also add `model` and `effort` to that close call/);
    assert.ok(!json.prompt.includes('"model":"'));
  });

  test('an agent destination with a confirmed model bakes it and asks only for effort', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'agent', model: 'sonnet', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.match(json.prompt, /"model":"sonnet"/);
    assert.match(json.prompt, /Also add `effort` to that close call — the reasoning effort you actually ran at/);
    assert.ok(!json.prompt.includes('Also add `model` and `effort`'));
  });
});

// Reviewer style note (a): a malformed judgment field must fail loudly at
// assembly time, never ride through as "Run: undefined"/"undefined → undefined".
describe('judgment shape validation', () => {
  test('a verification pair missing run/expected is a clean error, never reaches the gate', () => {
    writeRoadmap(project, [entryFields()]);
    const { status, json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({ verification: [{ run: 'npm test' }] }),
    });
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /judgment\.verification\[0\]/);
    assert.ok(!('prompt' in json), 'a validation failure must not assemble/return a prompt at all');
  });

  test('a non-object judgment.example is a clean error', () => {
    writeRoadmap(project, [entryFields()]);
    const { status, json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({ example: 'before -> after' }),
    });
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /judgment\.example/);
  });
});

// entry 204: craft-prompt/SKILL.md's Workflow-stage output flavor needs
// this wired through — the gap flagged in entry 201's own header comment.
describe('workflow-stage flavor', () => {
  test('drops tone, replaces output_format with the fixed sentence, and passes the flag through to the gate', () => {
    // kind:"decision" forces `reinforced`, so tone/output_format would
    // otherwise both be included — proving workflowStage overrides that.
    writeRoadmap(project, [entryFields({ kind: 'decision' })]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      workflowStage: true,
      judgment: goodJudgment(),
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));
    assert.deepEqual(json.gate.errors, []);
    assert.ok(!json.prompt.includes('<tone>'));
    assert.ok(!json.prompt.includes('<output_format>'));
    assert.ok(json.prompt.includes(WORKFLOW_STAGE_SENTENCE));
  });

  test('entry-less mode carries the flag the same way', () => {
    const { json } = run(project, {
      title: 'Ad-hoc research task',
      what: 'Investigate the retry bug.',
      planned_touches: ['src/auth/middleware.js'],
      destination: 'clipboard',
      workflowStage: true,
      request: 'Investigate the retry bug.',
      judgment: { role: 'a senior engineer', goal: 'to investigate', context: '', question: 'Does the retry path double-count?' },
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(!json.prompt.includes('<output_format>'));
    assert.ok(json.prompt.includes(WORKFLOW_STAGE_SENTENCE));
  });

  test('without the flag, the same reinforced handoff carries tone and output_format as usual', () => {
    writeRoadmap(project, [entryFields({ kind: 'decision' })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));
    assert.ok(json.prompt.includes('<tone>'));
    assert.ok(json.prompt.includes('<output_format>'));
    assert.ok(!json.prompt.includes(WORKFLOW_STAGE_SENTENCE));
  });
});

// Prior-work recall: a planned path only a handful of finished entries ever
// reached is a lead, so the handoff names them and what each recorded.
describe('prior-work recall', () => {
  const { priorWorkText, recallExcerpt } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));

  function finished(id, observed, overrides = {}) {
    return entryFields({
      id,
      title: `Earlier work ${id}`,
      status: 'done',
      planned_touches: observed,
      observed_touches: observed,
      commits: ['abc1234'],
      ...overrides,
    });
  }

  // 20 finished entries so the 20% ceiling sits at 4: a path 2 entries
  // reached survives, one 9 reached does not.
  // Padding: finished entries touching nothing the picked task plans, there
  // only to give the 20% ceiling a corpus to be 20% of.
  function pad(count, base) {
    return Array.from({ length: count }, (_, i) => finished(String(base + i), [`src/pad-${base + i}.js`]));
  }

  function corpus() {
    const rows = [];
    for (let i = 0; i < 20; i += 1) {
      const id = String(200 + i);
      const observed = i < 9 ? ['src/common.js'] : [`src/other-${i}.js`];
      if (i === 0 || i === 1) observed.push('src/auth/middleware.js');
      rows.push(finished(id, observed, { notes: `${today()} Entry ${id} rewrote the retry loop.` }));
    }
    return rows;
  }

  test('a rare path names the finished entries that touched it', () => {
    const text = priorWorkText(corpus(), { id: '001', planned_touches: ['src/auth/middleware.js'] });
    assert.match(text, /Finished work that already touched these files:/);
    assert.match(text, /- 200 Earlier work 200 — Entry 200 rewrote the retry loop\./);
    assert.match(text, /- 201 Earlier work 201/);
  });

  test('a path above the 20% ceiling is dropped as a query term', () => {
    const text = priorWorkText(corpus(), { id: '001', planned_touches: ['src/common.js'] });
    assert.equal(text, '');
  });

  test('a path nothing has touched recalls nothing', () => {
    const text = priorWorkText(corpus(), { id: '001', planned_touches: ['src/brand-new.js'] });
    assert.equal(text, '');
  });

  test('open entries and evidence-less closes are not corpus', () => {
    const rows = [
      finished('300', ['src/auth/middleware.js'], { status: 'planned' }),
      finished('301', ['src/auth/middleware.js'], { status: 'in_progress' }),
      finished('302', [], { observed_touches: [] }),
    ];
    assert.equal(priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] }), '');
  });

  test('awaiting_acceptance counts — it is finished work waiting on a yes', () => {
    const rows = [finished('303', ['src/auth/middleware.js'], { status: 'awaiting_acceptance' }), ...pad(4, 700)];
    assert.match(
      priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] }),
      /- 303 Earlier work 303/
    );
  });

  test('at most three entries, rarest path first', () => {
    const rows = [];
    for (let i = 0; i < 5; i += 1) rows.push(finished(String(400 + i), ['src/wide.js']));
    rows.push(finished('500', ['src/narrow.js']));
    for (let i = 0; i < 24; i += 1) rows.push(finished(String(600 + i), [`src/pad-${i}.js`]));
    const text = priorWorkText(rows, { id: '001', planned_touches: ['src/narrow.js', 'src/wide.js'] });
    const named = text.split('\n').filter((line) => line.startsWith('- '));
    assert.equal(named.length, 3);
    assert.match(named[0], /- 500 /);
  });

  test('the excerpt strips the date stamp and every machine-written line', () => {
    const notes = [
      `${today()} scope drift — untouched: src/a.js`,
      `${today()} correction applied: what`,
      `${today()} The retry loop double-counted attempts after a 429.`,
      `${today()} short`,
    ].join('\n');
    assert.equal(recallExcerpt(notes), 'The retry loop double-counted attempts after a 429.');
  });

  test('an excerpt is capped at 240 characters', () => {
    const long = `${today()} ${'x'.repeat(400)}`;
    assert.equal(recallExcerpt(long).length, 240);
  });

  test('notes that are entirely machine-written excerpt to nothing', () => {
    assert.equal(recallExcerpt(`${today()} scope drift — unpredicted: src/b.js`), null);
  });

  // Titles here are deliberately long. A real roadmap's titles run well past
  // 60 characters, and a short-title fixture passes the length assertion
  // below for the wrong reason.
  const LONG_TITLE = 'Rework the auth middleware refresh path and its expiry accounting end to end';

  test('it lands inside <background>, never inside <context>, and stays under 1000 chars', () => {
    writeRoadmap(project, [
      entryFields(),
      finished('300', ['src/auth/middleware.js'], {
        title: `${LONG_TITLE} (first pass)`,
        notes: `${today()} ${'The earlier pass moved the refresh call above the expiry check. '.repeat(6)}`,
      }),
      finished('301', ['src/auth/middleware.js'], {
        title: `${LONG_TITLE} (second pass)`,
        notes: `${today()} ${'It also renamed verifySession and left one caller behind. '.repeat(6)}`,
      }),
      finished('302', ['src/auth/middleware.js'], {
        title: `${LONG_TITLE} (third pass)`,
        notes: `${today()} ${'A third pass rewrote the cookie flags and nothing else. '.repeat(6)}`,
      }),
      ...pad(17, 800),
    ]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));

    const background = json.prompt.slice(
      json.prompt.indexOf('<background>'),
      json.prompt.indexOf('</background>')
    );
    const recallAt = background.indexOf('Finished work that already touched these files:');
    assert.ok(recallAt > -1, 'recall never made it into <background>');
    const contextAt = background.indexOf('<context>');
    if (contextAt > -1) assert.ok(recallAt < contextAt, 'recall must sit outside <context>');

    const block = background.slice(recallAt).replace(/<context>[\s\S]*$/, '').trim();
    assert.ok(block.length < 1000, `recall payload was ${block.length} chars`);
  });

  // The 1000-character ceiling is the feature's contract, so it is enforced
  // rather than argued: maximal title, maximal excerpt, maximal entry count,
  // and a four-digit id on every row.
  test('the worst case a roadmap can produce still fits under 1000 chars', () => {
    const rows = [];
    for (let i = 0; i < 3; i += 1) {
      rows.push(finished(String(1000 + i), ['src/auth/middleware.js'], {
        title: 'T'.repeat(200),
        notes: `${today()} ${'N'.repeat(600)}`,
      }));
    }
    rows.push(...pad(17, 2000));
    const text = priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] });
    assert.ok(text.length > 0, 'the worst case must still recall something');
    assert.ok(text.length < 1000, `worst-case payload was ${text.length} chars`);
    for (const line of text.split('\n').slice(1)) {
      assert.ok(line.includes('T'.repeat(60)), 'the title is cut at 60, not dropped');
      assert.ok(!line.includes('T'.repeat(61)), 'the title must be cut at 60');
    }
  });

  test('a lead that would overflow the ceiling is dropped whole, never halved', () => {
    const rows = [
      finished('300', ['src/auth/middleware.js'], { title: 'A'.repeat(60), notes: `${today()} ${'a'.repeat(240)}` }),
      finished('301', ['src/auth/middleware.js'], { title: 'B'.repeat(60), notes: `${today()} ${'b'.repeat(240)}` }),
      finished('302', ['src/auth/middleware.js'], { title: 'C'.repeat(60), notes: `${today()} ${'c'.repeat(240)}` }),
      ...pad(17, 3000),
    ];
    const text = priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] });
    assert.ok(text.length < 1000);
    // Whatever survived is whole: every kept line still ends in its own
    // excerpt rather than a truncation of one.
    for (const line of text.split('\n').slice(1)) {
      assert.match(line, /^- \d+ [ABC]{60} — [abc]{240}$/);
    }
  });

  test('recall never promotes a handoff to the reinforced profile', () => {
    writeRoadmap(project, [
      entryFields(),
      finished('300', ['src/auth/middleware.js'], { notes: `${today()} A real finding.` }),
      ...pad(4, 900),
    ]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.profile, 'standard');
    assert.equal(Object.keys(json.signals).length, 5);
    assert.ok(json.prompt.includes('Finished work that already touched these files:'));
  });
});
