'use strict';

// Tests for scripts/craft-handoff.js — the craft-time assembler that loads a
// roadmap entry (or entry-less judgment), runs render-sections.js and
// resolve-symbols.js in-process, computes the handoff profile from the five
// mechanical signals, assembles the XML from prompt-template.md's canonical
// blocks, bakes the entry paragraph / checkpoint embed, and
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
const { spawnSync } = require('node:child_process');

const { runNodeScript, makeTmpProject, writeRoadmap, writeConfig, initGitRepo, commitFile, SCRIPTS_DIR } = require('./helpers.js');
const { today } = require(path.join(SCRIPTS_DIR, 'roadmap.js'));
const { TEMPLATE_PATH, WORKFLOW_STAGE_SENTENCE } = require(path.join(SCRIPTS_DIR, 'check-prompt.js'));
const { assemble, relevantFilesText, rankSymbols, SYMBOL_KEEP, checkpointEmbedText } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));

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

  // [Foreman: 271] planned_touches is a plan, so a task that adds a file names
  // that file before it exists. The gate used to refuse the whole handoff for
  // it, which refused every create-a-file task.
  test('a planned path that does not exist yet still crafts a passing handoff', () => {
    writeRoadmap(project, [entryFields({
      title: 'Add a retry wrapper',
      what: 'Add src/auth/retry.js with exponential backoff and call it from middleware.',
      planned_touches: ['src/auth/middleware.js', 'src/auth/retry.js'],
    })]);
    const { status, json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(status, 0, JSON.stringify(json));
    assert.equal(json.ok, true);
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate.errors));
    assert.match(json.prompt, /src\/auth\/retry\.js — MISSING:/);
    assert.match(json.prompt, /Either this task creates the file, or the plan is stale/);
    assert.ok(json.gate.warnings.some((w) => w.includes('MISSING:')), JSON.stringify(json.gate.warnings));
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

describe('verification preflight — every command, not just the first', () => {
  test('a second command that does not resolve warns, and the warning names it', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({
        verification: [
          { run: 'node --test tests/*.test.js', expected: 'all tests pass' },
          { run: 'definitelynotarealbinary --run', expected: 'the check passes' },
        ],
      }),
    });
    const hits = json.warnings.filter((w) => w.includes('does not resolve'));
    assert.equal(hits.length, 1, `expected one unresolvable-command warning, got ${JSON.stringify(json.warnings)}`);
    assert.ok(hits[0].includes('definitelynotarealbinary --run'), hits[0]);
  });

  test('the same command twice is one finding, not two', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({
        verification: [
          { run: 'definitelynotarealbinary --run', expected: 'the check passes' },
          { run: 'definitelynotarealbinary --run', expected: 'still passes' },
        ],
      }),
    });
    assert.equal(json.warnings.filter((w) => w.includes('does not resolve')).length, 1, JSON.stringify(json.warnings));
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
    assert.ok(json.gate.errors.some((e) => e.error.includes('task_rules')));
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

describe('decision entries and the clipboard checkpoint embed', () => {
  // Foreman authors no decision document any more: one ledger records what a
  // close learned, and where a project writes its decisions down is the
  // project's own business. Neither the write block nor the forced `doc`
  // close field survives.
  // The anchor channel's end-to-end path: a comment in a planned file
  // reaches the assembled prompt, so the destination reads what governs this
  // code before it starts, not after a hook catches it mid-edit.
  test('an anchor in a planned file rides into the background block', () => {
    writeRoadmap(project, [
      entryFields(),
      { ...entryFields(), id: '019', title: 'Expire sessions server-side' },
    ]);
    const full = path.join(project, 'src', 'auth', 'middleware.js');
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '// [Foreman: 019]\nfunction refreshToken() {}\n', 'utf-8');
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.match(json.prompt, /Anchored in the files this task plans to touch/);
    assert.match(json.prompt, /\[Foreman: 019\] — Expire sessions server-side/);
  });

  test('a planned file carrying no anchor adds nothing at all', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.ok(!json.prompt.includes('Anchored in the files'), json.prompt);
  });

  test('a kind:"decision" entry is never handed a document to write', () => {
    writeConfig(project, { ledger: { enabled: true, dir: 'docs/foreman' } });
    writeRoadmap(project, [entryFields({ kind: 'decision' })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(!json.prompt.includes('<decision_log>'), json.prompt);
    assert.ok(!json.prompt.includes('"doc":'), json.prompt);
  });

  // The synthesized request sentence is the one line carrying the actual ask,
  // and `task_rules` on a decision entry already forbid writing code. It used
  // to read `Implement: <title>.` regardless of `kind`.
  test('a kind:"decision" entry synthesizes a Decide: request sentence, never Implement:', () => {
    writeRoadmap(project, [entryFields({ kind: 'decision' })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(!json.prompt.includes('Implement:'), json.prompt);
    assert.match(json.prompt, /Decide: Fix token refresh bug, and state why the chosen option wins\./);
  });

  test('an ordinary entry still synthesizes an Implement: request sentence', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.match(json.prompt, /Implement: Fix token refresh bug\./);
  });

  test('an explicit request overrides the decision fallback', () => {
    writeRoadmap(project, [entryFields({ kind: 'decision' })]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      request: 'Pick a cache eviction policy and record it.',
      judgment: goodJudgment(),
    });
    assert.match(json.prompt, /Pick a cache eviction policy and record it\./);
    assert.ok(!json.prompt.includes('Decide: Fix token refresh bug'), json.prompt);
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

  // [Foreman: 273] The embed used to say "chain each to the previous one" and
  // name no tool, so the ordering was advice. The pasted session is a Claude
  // Code session — the prompt already bakes ${CLAUDE_PLUGIN_ROOT} and names
  // AskUserQuestion — so naming the tools costs nothing and hands the ordering
  // to that session's own harness, the same way the task destination does.
  test('the embed names the task tools, so the reading session enforces the order', () => {
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
    assert.ok(json.prompt.includes('with `TaskCreate`'), json.prompt);
    assert.ok(json.prompt.includes('`addBlockedBy: ["<the previous task\'s id>"]`'), json.prompt);
    assert.ok(!json.prompt.includes('has no Foreman scripts to call'), json.prompt);
  });

  // [Foreman: 262] The embed and the entry paragraph used to contradict each
  // other on the last commit: the paragraph says commit once with a
  // `Foreman: <id>` trailer, the embed said commit `task <n>/<total>`. The
  // template reconciles them, but the pasted session never reads the
  // template — so the reconciliation is baked into the embed itself.
  test('the embed defers its last commit to the roadmap close, id baked in', () => {
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
    assert.ok(json.prompt.includes("the last task carries the roadmap close instead of a `task <n>/<total>` commit"), json.prompt);
    assert.ok(json.prompt.includes("make that one commit with `Foreman: 001` as its final line"), json.prompt);
  });

  test('a handoff with no roadmap entry gets no roadmap-close bullet', () => {
    const embed = checkpointEmbedText({ baseBranch: null, branch: true, onFinish: 'ask' }, 2, null);
    assert.ok(!embed.includes('carries the roadmap close'), embed);
    assert.ok(embed.includes("commit `task <n>/<total>: <task subject>`"), embed);
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

  test('an agent destination gets the both-fields instruction', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'agent', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.match(json.prompt, /Also add `model` and `effort` to that close call/);
    assert.ok(!json.prompt.includes('"model":"'));
  });

  // [Foreman: 260] Foreman no longer asks which model should run a task, so
  // nothing upstream can know one to bake in. A caller passing `model` anyway
  // is passing a value nothing confirmed: it is ignored, and the destination
  // still self-reports what actually ran.
  test('a passed model is ignored — the destination always self-reports both', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'agent', model: 'sonnet', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(!json.prompt.includes('"model":"sonnet"'), 'a passed model was baked into the close call');
    assert.match(json.prompt, /Also add `model` and `effort` to that close call/);
  });
});

// The autonomous-operation reminder bans asking; source-d pairs it with the
// policy that says when asking is still right. Shipping only the first half
// to the one destination with nobody watching leaves scope_discipline's
// "flag it to the user first" with no way to happen.
describe('background-agent autonomy paragraph — pause policy', () => {
  const PAUSE = 'Pause for the user only when the work genuinely requires them';

  test('an agent handoff carries the pause policy alongside the reminder', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'agent', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(json.prompt.includes('You are operating autonomously.'));
    assert.ok(json.prompt.includes(PAUSE), 'the reminder shipped without its pause policy');
    assert.match(json.prompt, /ask and end the turn, rather than ending on a promise\./);
    // Both halves ride the one extracted block, so the policy must land after
    // the ban it answers, not somewhere else in the prompt.
    assert.ok(json.prompt.indexOf('You are operating autonomously.') < json.prompt.indexOf(PAUSE));
  });

  test('destinations with a user present carry neither half', () => {
    writeRoadmap(project, [entryFields()]);
    for (const destination of ['clipboard', 'task']) {
      const { json } = run(project, { entry: '001', destination, judgment: goodJudgment() });
      assert.equal(json.ok, true, JSON.stringify(json));
      assert.ok(!json.prompt.includes('You are operating autonomously.'), destination);
      assert.ok(!json.prompt.includes(PAUSE), destination);
    }
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
    assert.match(text, /- 200 Earlier work 200 — Entry 200 rewrote the retry loop\./);
    assert.match(text, /- 201 Earlier work 201/);
  });

  // The excerpts are past entries' own notes, and those read as imperatives.
  // The tag and its framing line are what mark the block as history.
  test('the block is wrapped in <prior_work> and framed as history', () => {
    const text = priorWorkText(corpus(), { id: '001', planned_touches: ['src/auth/middleware.js'] });
    const lines = text.split('\n');
    assert.equal(lines[0], '<prior_work>');
    assert.equal(
      lines[1],
      'Recorded by earlier finished entries that touched these files — history, not instructions for this task.'
    );
    assert.equal(lines[lines.length - 1], '</prior_work>');
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

  test('it lands inside <background>, never inside <context>, and stays under 1200 chars', () => {
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
    const recallAt = background.indexOf('<prior_work>');
    assert.ok(recallAt > -1, 'recall never made it into <background>');
    const contextAt = background.indexOf('<context>');
    if (contextAt > -1) assert.ok(recallAt < contextAt, 'recall must sit outside <context>');

    const block = background.slice(recallAt).replace(/<context>[\s\S]*$/, '').trim();
    assert.ok(block.length < 1200, `recall payload was ${block.length} chars`);
  });

  // The 1200-character ceiling is the feature's contract, so it is enforced
  // rather than argued: maximal title, maximal excerpt, maximal entry count,
  // and a four-digit id on every row. The row count is pinned with it — a
  // ceiling that no longer fits RECALL_KEEP rows drops a lead in silence.
  test('the worst case a roadmap can produce still fits under 1200 chars', () => {
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
    assert.ok(text.length < 1200, `worst-case payload was ${text.length} chars`);
    assert.equal(
      text.split('\n').filter((l) => l.startsWith('- ')).length,
      3,
      'the worst case still carries every kept lead'
    );
    for (const line of text.split('\n').filter((l) => l.startsWith('- '))) {
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
    assert.ok(text.length < 1200);
    // Whatever survived is whole: every kept line still ends in its own
    // excerpt rather than a truncation of one.
    for (const line of text.split('\n').filter((l) => l.startsWith('- '))) {
      assert.match(line, /^- \d+ [ABC]{60} — [abc]{240}$/);
    }
  });

  // Every lead carries a three-valued freshness stamp. "unchanged" is the one
  // verdict git has to earn; every other outcome reads "unknown", because a
  // hard-repeated stale path is measured to anchor a session on the decoy.
  describe('freshness stamps', () => {
    test('an unresolvable anchor stamps unknown rather than fresh', () => {
      const bare = makeTmpProject();
      const rows = [
        finished('300', ['src/auth/middleware.js'], { commits: ['deadbee'] }),
        ...pad(4, 900),
      ];
      const text = priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] }, bare);
      assert.match(text, /- 300 .*\[freshness unknown\]/);
      assert.ok(!text.includes('unchanged since'), 'an undatable lead must never read as fresh');
    });

    test('a lead whose recorded files have not changed reads as unchanged', () => {
      const repo = makeTmpProject();
      initGitRepo(repo);
      const sha = commitFile(repo, 'src/auth/middleware.js', 'function refreshToken() {}\n');
      commitFile(repo, 'src/unrelated.js', 'module.exports = 1;\n');
      const rows = [
        finished('300', ['src/auth/middleware.js'], { commits: [sha] }),
        ...pad(4, 900),
      ];
      const text = priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] }, repo);
      assert.match(text, new RegExp(`- 300 .*\\[at ${sha} — its files unchanged since\\]`));
    });

    test('a lead whose recorded files changed since reads as possibly stale', () => {
      const repo = makeTmpProject();
      initGitRepo(repo);
      const sha = commitFile(repo, 'src/auth/middleware.js', 'function refreshToken() {}\n');
      commitFile(repo, 'src/auth/middleware.js', 'function refreshToken() { return 1; }\n');
      const rows = [
        finished('300', ['src/auth/middleware.js'], { commits: [sha] }),
        ...pad(4, 900),
      ];
      const text = priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] }, repo);
      assert.match(text, /- 300 .*possibly stale: 1 of its 1 files changed since\]/);
    });

    // The P1 decoy: a lead recorded against a path that has since MOVED. The
    // recall still names the old path, which is exactly what anchors a session
    // on a file nothing imports any more — so the stamp has to fire. It does
    // because the diff runs without `-M`, which reports a rename as a delete.
    test('a moved file makes its lead read stale, not fresh', () => {
      const repo = makeTmpProject();
      initGitRepo(repo);
      const sha = commitFile(repo, 'src/parser.js', 'const split = (s) => s.split(/\\s+/);\n');
      spawnSync('git', ['mv', 'src/parser.js', 'src/tokenizer.js'], { cwd: repo });
      commitFile(repo, 'src/tokenizer.js', 'const split = (s) => s.split(/[^a-z0-9\']+/);\n');
      const rows = [
        finished('300', ['src/parser.js'], { commits: [sha] }),
        ...pad(4, 900),
      ];
      const text = priorWorkText(rows, { id: '001', planned_touches: ['src/parser.js'] }, repo);
      assert.match(text, /- 300 .*possibly stale: 1 of its 1 files changed since\]/);
    });

    test('with no root the block carries no stamp at all', () => {
      const rows = [finished('300', ['src/auth/middleware.js']), ...pad(4, 900)];
      const text = priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] });
      assert.match(text, /- 300 /);
      assert.ok(!text.includes('['), 'selection-only callers get no freshness claim either way');
    });
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
    assert.ok(json.prompt.includes('<prior_work>'));
  });
});

// [Foreman: 074] The file list is the one interview answer that must produce a
// real path, and a hand-typed path aimed at the wrong file is the failure
// truth_grounding spends the destination's tokens rescuing. The skill now
// grounds that question in one Explore pass before it asks. This is prose, so
// the pin is on the properties that make it safe rather than on the wording.
describe('craft-prompt grounds its file options before asking', () => {
  const SKILL = fs.readFileSync(
    path.join(__dirname, '..', 'skills', 'craft-prompt', 'SKILL.md'),
    'utf-8'
  );
  const flat = SKILL.replace(/\s+/g, ' ');

  test('the grounding pass runs before Call 2, not after it', () => {
    const ground = SKILL.indexOf('## Ground the file options');
    const call2 = SKILL.indexOf('## Call 2 — required fields');
    assert.ok(ground > 0, 'the grounding section is gone');
    assert.ok(call2 > 0);
    assert.ok(ground < call2, 'grounding must happen before the questions it grounds');
  });

  test('it dispatches exactly one read-only Explore pass, never a second', () => {
    assert.ok(/`Explore`/.test(SKILL), 'the grounding pass names no agent');
    assert.ok(/\*\*one\*\* `Explore`/.test(flat), 'the single-pass bound is gone');
    assert.ok(/[Nn]ever a second one/.test(flat), 'nothing stops a follow-up Explore');
    assert.ok(/read-only/.test(flat));
  });

  test('what Explore returns is a proposal the user can overrule', () => {
    assert.ok(/proposal, not a finding/.test(flat), 'the offer-never-assert rule is gone');
    assert.ok(
      /`Other` answer always wins/.test(flat),
      'nothing says the user overrules a grounded option'
    );
    assert.ok(
      /reaches `touches` until the user has chosen it/.test(flat),
      'a candidate could reach touches without being picked'
    );
  });

  test('every grounded question degrades to its old free-text wording', () => {
    assert.ok(
      /never a precondition for asking it/.test(flat),
      'the empty-Explore fallback is gone'
    );
    // Q3 keeps its hand-typed path, and Q1 keeps all four generic commands.
    assert.ok(flat.includes("`I'll list them`"));
    assert.ok(flat.includes('`I can only name the area`'));
    for (const cmd of ['npm test', 'pytest', 'cargo test', 'go test ./...']) {
      assert.ok(flat.includes(cmd), `the generic ${cmd} fallback is gone`);
    }
  });

  test('a detected command is still settled by resolve-symbols, not by Explore', () => {
    assert.ok(
      /verification\.resolves: false/.test(flat),
      'the real verification check is no longer what settles the command'
    );
  });
});

// [Foreman 4.2] The standard profile ends on the closure-evidence sentence and
// says nothing about the final message — the one part of a handoff a human
// reads. Giving it the canonical <output_format> costs words on the profile
// whose stated purpose is the length it saves, so the switch ships before the
// default does and a measurement decides the default.
describe('the standard profile output shape switch', () => {
  const shaped = { FOREMAN_STANDARD_OUTPUT_SHAPE: '1' };

  function standardRun(env) {
    // No signals set, so computeSignals leaves this on the standard profile.
    return run(project, {
      title: 'Fix the token refresh bug',
      what: 'Fix the retry path in the auth middleware so the failing test passes.',
      planned_touches: ['src/auth/middleware.js'],
      destination: 'clipboard',
      request: 'Fix the token refresh bug in the auth middleware.',
      judgment: goodJudgment(),
    }, env);
  }

  test('standard carries no output_format by default', () => {
    const { json } = standardRun();
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.equal(json.profile, 'standard');
    assert.ok(!json.prompt.includes('<output_format>'));
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));
  });

  test('the switch adds it, and the prompt still passes the gate', () => {
    const { json } = standardRun(shaped);
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.equal(json.profile, 'standard', 'the switch must not promote the profile');
    assert.ok(json.prompt.includes('<output_format>'), 'the switch did not add the block');
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));
  });

  test('the switch is the only difference the prompt shows', () => {
    const plain = standardRun().json.prompt;
    const withShape = standardRun(shaped).json.prompt;
    const removed = withShape.replace(/\n*<output_format>[\s\S]*?<\/output_format>/, '');
    assert.equal(removed.trim(), plain.trim(), 'the switch changed something other than the block');
  });

  test('an unset or unrecognised value keeps today behaviour', () => {
    for (const value of ['', '0', 'false', 'yes', 'on']) {
      const { json } = standardRun({ FOREMAN_STANDARD_OUTPUT_SHAPE: value });
      assert.ok(
        !json.prompt.includes('<output_format>'),
        `"${value}" turned the shape on; only 1 and true may`
      );
    }
  });

  test('omitSections still wins over the switch', () => {
    writeConfig(project, { omitSections: ['output_format'] });
    const { json } = standardRun(shaped);
    assert.ok(!json.prompt.includes('<output_format>'), 'the switch overrode an explicit opt-out');
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));
  });
});

// [Foreman 4.1] The testFirst branch is the one place a session authors the
// very check it is graded on. The anti-gaming clause names that shortcut, and
// the house's own recorded lesson is that naming a failure can prime it — so
// the clause ships behind a switch and a measurement decides the default.
describe('the anti-test-gaming clause', () => {
  const CLAUSE = 'The test verifies the rule; it does not define it.';
  const on = { FOREMAN_TEST_GAMING_CLAUSE: '1' };

  function testFirstRun(env, judgmentOverrides = {}) {
    return run(project, {
      title: 'Fix the token refresh bug',
      what: 'Fix the retry path in the auth middleware so the failing test passes.',
      planned_touches: ['src/auth/middleware.js'],
      destination: 'clipboard',
      request: 'Fix the token refresh bug in the auth middleware.',
      judgment: goodJudgment({ testFirst: true, ...judgmentOverrides }),
    }, env);
  }

  test('it is absent by default, even on the testFirst branch', () => {
    const { json } = testFirstRun();
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(json.prompt.includes('Write the invariant test first'), 'the branch did not fire');
    assert.ok(!json.prompt.includes(CLAUSE));
  });

  test('the switch adds it, and the prompt still passes the gate', () => {
    const { json } = testFirstRun(on);
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(json.prompt.includes(CLAUSE), 'the switch did not add the clause');
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));
  });

  test('it costs nothing on a handoff that is not testFirst', () => {
    const { json } = run(project, {
      title: 'Fix the token refresh bug',
      what: 'Fix the retry path in the auth middleware so the failing test passes.',
      planned_touches: ['src/auth/middleware.js'],
      destination: 'clipboard',
      request: 'Fix the token refresh bug in the auth middleware.',
      judgment: goodJudgment(),
    }, on);
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(!json.prompt.includes(CLAUSE), 'the clause leaked outside the testFirst branch');
  });

  test('the clause is the only difference the prompt shows', () => {
    const plain = testFirstRun().json.prompt;
    const clause = testFirstRun(on).json.prompt;
    assert.equal(clause.replace(CLAUSE + ' Write it to hold for every input the rule covers, not only the one named here.\n', ''), plain);
  });

  test('an unrecognised value keeps today behaviour', () => {
    for (const value of ['', '0', 'false', 'yes']) {
      const { json } = testFirstRun({ FOREMAN_TEST_GAMING_CLAUSE: value });
      assert.ok(!json.prompt.includes(CLAUSE), `"${value}" turned the clause on; only 1 and true may`);
    }
  });
});

// [Foreman 4a] The extras clause — "if you find a pre-existing bug next door,
// report it, don't fix it here" — was measured over 48 sessions and DECLINED:
// zero extras in either control on two task shapes and two models, and +40%
// output tokens on Sonnet. Unlike §4.1-4.3 no switch was kept, so nothing in
// the product emits it; the arms live entirely in the benchmark harness. This
// test guards the absence, so a future edit cannot reintroduce it silently.
describe('the extras clause is not in the product', () => {
  test('no crafted prompt carries it, on either profile', () => {
    const build = (judgmentOverrides) => run(project, {
      title: 'Fix the token refresh bug',
      what: 'Fix the retry path in the auth middleware so the failing test passes.',
      planned_touches: ['src/auth/middleware.js'],
      destination: 'clipboard',
      request: 'Fix the token refresh bug in the auth middleware.',
      judgment: goodJudgment(judgmentOverrides),
    }, { FOREMAN_EXTRAS_CLAUSE: '1' });

    for (const overrides of [{}, { testFirst: true }, { constraints: [] }]) {
      const { json } = build(overrides);
      assert.equal(json.ok, true, JSON.stringify(json));
      assert.ok(
        !json.prompt.includes('you find a pre-existing bug'),
        'the extras clause is back in the product — it was measured and declined'
      );
    }
  });
});


// [Foreman: 259] The symbol list was the one block this assembler printed
// without a ceiling — prior work has RECALL_MAX_CHARS, notes NOTES_KEEP,
// anchors ANCHOR_KEEP. A long single-file module resolved to hundreds of
// names and buried the handful the task touches.
describe('relevant_files symbol cap', () => {
  function file(count) {
    return {
      path: 'src/big.js',
      symbols: Array.from({ length: count }, (_, i) => ({ name: 'sym' + i, line: i + 1 })),
    };
  }

  test('a file at or under the cap prints every symbol and no tail', () => {
    const text = relevantFilesText([file(SYMBOL_KEEP)], [], []);
    assert.equal(text.split(', ').length, SYMBOL_KEEP);
    assert.ok(!text.includes('more top-level definitions'), text);
  });

  test('a file over the cap prints exactly the cap and states what was cut', () => {
    const text = relevantFilesText([file(SYMBOL_KEEP + 30)], [], []);
    assert.ok(text.includes('sym' + (SYMBOL_KEEP - 1) + ' (' + SYMBOL_KEEP + ')'), text);
    assert.ok(!text.includes('sym' + SYMBOL_KEEP + ' '), 'a symbol past the cap was printed');
    assert.ok(text.includes('and 30 more top-level definitions — read the file'), text);
  });

  test("names the entry's own prose uses lead, however late they sit in the file", () => {
    const record = { title: 'Fix it', what: 'Make `sym99` call `sym98` before returning' };
    const text = relevantFilesText([file(120)], [], [], record);
    assert.match(text, /^src\/big\.js — sym98 \(99\), sym99 \(100\), sym0 \(1\)/);
    assert.ok(text.includes('and 108 more top-level definitions'), text);
  });

  test('rankSymbols reports the count it dropped, never a silent truncation', () => {
    const { kept, dropped } = rankSymbols(file(40).symbols, new Set());
    assert.equal(kept.length, SYMBOL_KEEP);
    assert.equal(dropped, 40 - SYMBOL_KEEP);
  });

  test('an entry with no prose still caps, in file order', () => {
    const text = relevantFilesText([file(20)], [], [], { title: '', what: '' });
    assert.match(text, /^src\/big\.js — sym0 \(1\), sym1 \(2\)/);
    assert.ok(text.includes('and 8 more top-level definitions'), text);
  });

  test('a real assembled handoff carries the capped block', () => {
    const project = makeTmpProject();
    fs.writeFileSync(
      path.join(project, 'big.js'),
      Array.from({ length: 60 }, (_, i) => 'function widget' + i + '() {}').join('\n')
    );
    writeConfig(project, {});
    writeRoadmap(project, [{
      id: '001',
      title: 'Rework widget3',
      why: 'it is wrong',
      what: 'Make `widget3` return early',
      status: 'planned',
      source: 'user',
      depends_on: [],
      planned_touches: ['big.js'],
      observed_touches: [],
      commits: [],
      created_at: today(),
      updated_at: today(),
      notes: '',
    }]);
    const { prompt } = assemble(project, { entry: '001', destination: 'task', judgment: goodJudgment() });
    assert.ok(prompt.includes('widget3 ('), 'the prose-named symbol is missing');
    assert.ok(prompt.includes('more top-level definitions — read the file'), 'the cap note is missing');
    assert.ok(!prompt.includes('widget59 ('), 'the whole file surface leaked into the prompt');
  });
});

// [Foreman] `<context>` renders on the reinforced profile only. That is
// deliberate, but it used to be silent: a crafting session could put a
// load-bearing fact in `judgment.context` and never learn the standard
// handoff shipped without it. Found by rendering a benchmark arm and diffing
// it against the facts it was built from — the `fix location:` line was gone.
describe('judgment.context and the standard profile', () => {
  const dropped = (json) => (json.warnings || []).some((w) => w.includes('judgment.context was dropped'));

  test('standard drops it and says so', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.profile, 'standard');
    assert.ok(!json.prompt.includes('<context>'), 'standard rendered <context> after all');
    assert.ok(dropped(json), `no drop warning: ${JSON.stringify(json.warnings)}`);
  });

  test('reinforced renders it and stays quiet', () => {
    writeRoadmap(project, [entryFields({ commits: ['a1b2c3d'] })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.profile, 'reinforced');
    assert.ok(json.prompt.includes('<context>'), 'reinforced dropped <context>');
    assert.ok(!dropped(json), `warned on a profile that carries it: ${JSON.stringify(json.warnings)}`);
  });

  test('no context supplied, nothing to warn about', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({ context: '' }),
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(!dropped(json), `warned with no context given: ${JSON.stringify(json.warnings)}`);
  });
});
