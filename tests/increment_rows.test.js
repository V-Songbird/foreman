'use strict';

// [Foreman: 295] Contract tests exercise actual assembly and the public CLI.
// These prove payload/rendering behavior, not that a Codex session waits.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assemble } = require('../scripts/craft-handoff');
const { checkPrompt } = require('../scripts/check-prompt');
const { today } = require('../scripts/roadmap');
const { makeTmpProject, writeRoadmap, writeConfig, runNodeScript, SCRIPTS_DIR } = require('./helpers');

function fixture(t) {
  const root = makeTmpProject();
  t.after(() => fs.rmSync(path.dirname(root), { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'view.js'), 'function openPanel() {}\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  writeRoadmap(root, [{
    id: '001', title: 'Open and close the panel', why: 'Let people inspect the panel.',
    what: 'Open and close the panel in view.js.', source: 'user', status: 'planned',
    depends_on: [], planned_touches: ['view.js'], observed_touches: [], commits: [],
    notes: '', created_at: today(), updated_at: today(),
  }]);
  return root;
}

const automatic = { goal: 'Open the panel', files: ['view.js'], run: 'npm test', expected: 'The panel tests pass' };
const human = { goal: 'Close the panel', files: ['view.js'], review: { action: 'Close the panel with Escape', expected: 'The panel closes and focus returns' } };
const mixed = { ...automatic, review: { action: 'Open the panel and inspect the fields', expected: 'The panel opens as intended; no authentication yet' } };
function input(rows, options = {}) {
  return {
    entry: '001', destination: 'task', split: true,
    judgment: { goal: 'to open and close the panel', steps: ['Implement the panel behavior.'], verification: rows },
    ...options,
  };
}

for (const [name, row, runs, looks] of [
  ['automatic', automatic, 1, 0], ['human', human, 0, 1], ['mixed', mixed, 1, 1],
]) {
  test(`${name} verification is one valid increment with only its required checks`, (t) => {
    const root = fixture(t);
    const result = assemble(root, input([row]));
    assert.equal(result.ok, true, JSON.stringify(result.gate));
    assert.equal(result.tasks.length, 1);
    assert.equal((result.prompt.match(/^Run: /gm) || []).length, runs);
    assert.equal((result.prompt.match(/^Look: /gm) || []).length, looks);
    assert.equal((result.prompt.match(/^Expected: /gm) || []).length, runs + looks);
    assert.doesNotMatch(result.prompt, /undefined/);
    if (row.review) {
      assert.ok(result.prompt.includes(`Look: ${row.review.action}\nExpected: ${row.review.expected}`));
      assert.ok(result.prompt.includes(row.goal));
    }
    const gate = checkPrompt(result.prompt, { root, destination: 'task', entry: '001', profile: result.profile });
    assert.deepEqual(gate.errors, [], 'Human review passes as verification without --research');
  });
}

test('mixed and human rows stay together, keep scope, and close the parent only on the last row', (t) => {
  const root = fixture(t);
  const result = assemble(root, input([mixed, human], { reviewEachIncrement: true }));
  assert.equal(result.ok, true);
  assert.equal(result.tasks.length, 2, 'three checks belong to two increments, not three tasks');
  assert.match(result.tasks[0].description, /<task_context>/);
  assert.doesNotMatch(result.tasks[0].description, /ROADMAP\.jsonl entry/);
  assert.match(result.tasks[1].description, /^Close the panel\nFiles: view.js\nLook:/);
  assert.doesNotMatch(result.tasks[1].description, /^Run:/m);
  assert.match(result.tasks[1].description, /ROADMAP\.jsonl entry `001`/);
  assert.ok(!result.warnings.some((w) => w.includes('carrying no work')));
});

test('a mixed later row retains both checks without adding a task', (t) => {
  const result = assemble(fixture(t), input([human, mixed]));
  assert.equal(result.tasks.length, 2);
  assert.match(result.tasks[1].description, /Run: npm test\nExpected: The panel tests pass\nLook: Open the panel/);
});

test('only actual commands reach preflight, and a human-only row stays non-executable', (t) => {
  const root = fixture(t);
  const review = { action: 'npm run human-review-not-a-command', expected: 'This is a human action' };
  const result = assemble(root, input([{ ...human, review }]));
  assert.equal(result.ok, true);
  assert.equal(result.signals.risky, true);
  assert.ok(!result.warnings.some((w) => w.includes('human-review-not-a-command')));
  const withRun = assemble(root, input([{ ...mixed, run: 'npm run missing-actual-command', review }]));
  assert.ok(withRun.warnings.some((w) => w.includes('missing-actual-command')));
  assert.ok(!withRun.warnings.some((w) => w.includes('human-review-not-a-command')));
});

for (const destination of ['task', 'clipboard', 'agent']) {
  test(`${destination}: absent and false preserve the entire ordinary Run-only output`, (t) => {
    const root = fixture(t);
    const oldInput = input([automatic, { ...automatic, goal: 'Close the panel' }], { destination });
    const implicit = assemble(root, oldInput);
    const explicitFalse = assemble(root, { ...oldInput, reviewEachIncrement: false });
    assert.deepEqual(explicitFalse, implicit);
    assert.equal(implicit.reviewEachIncrement, undefined);
    assert.doesNotMatch(implicit.prompt, /This run explicitly requires human acceptance/);
  });
  test(`${destination}: explicit acceptance request travels even for one reviewed row`, (t) => {
    const root = fixture(t);
    writeConfig(root, { requireVerification: false });
    const result = assemble(root, input([mixed], { destination, reviewEachIncrement: true }));
    assert.equal(result.ok, true);
    assert.equal(result.reviewEachIncrement, true);
    assert.match(result.prompt, /Aceptar \/ Pedir cambios \/ Pausar/);
    assert.match(result.prompt, /wait for the user before dependent work/);
    assert.match(result.prompt, /without a human channel, preserve the pending result and stop/);
    assert.match(result.prompt, /Intermediate acceptance does not close the parent/);
    assert.doesNotMatch(result.prompt, /Checkpoint protocol for this multi-task run/);
  });
}

test('clipboard counts two increments, including the human row, instead of three checks', (t) => {
  const result = assemble(fixture(t), input([mixed, human], { destination: 'clipboard', reviewEachIncrement: true }));
  assert.match(result.prompt, /one local acceptance row per increment \(2 total\)/);
  assert.match(result.prompt, /checks pass and the user accepts that result/);
  assert.doesNotMatch(result.prompt, /one local acceptance row per Run:/);
});

test('the flag is transient and is never inferred from task text or project configuration', (t) => {
  const root = fixture(t);
  writeConfig(root, { reviewEachIncrement: true });
  const before = fs.readFileSync(path.join(root, 'ROADMAP.jsonl'), 'utf8');
  const result = assemble(root, input([automatic], { request: 'Wait for approval after each step.' }));
  assert.equal(result.reviewEachIncrement, undefined);
  assert.equal(fs.readFileSync(path.join(root, 'ROADMAP.jsonl'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.join(root, '.foreman')), ['config.json']);
});

const invalidRows = [
  null, [], {}, { goal: 'No check' },
  { run: 'npm test' }, { expected: 'Pass' }, { run: '', expected: 'Pass' },
  { run: 'npm test', expected: ' ' }, { run: 12, expected: 'Pass' },
  { review: null }, { review: [] }, { review: 'Look' }, { review: {} },
  { review: { action: 'Inspect' } }, { review: { expected: 'Looks right' } },
  { review: { action: ' ', expected: 'Looks right' } },
  { review: { action: 'Inspect', expected: 7 } },
  { ...human, run: 'npm test' }, { ...automatic, review: { action: 'Inspect' } },
  { ...human, goal: 12 }, { ...human, files: 'view.js' }, { ...human, files: [''] },
];
for (const [i, row] of invalidRows.entries()) {
  test(`invalid row ${i + 1} is rejected by the public CLI without a prompt`, (t) => {
    const root = fixture(t);
    const out = runNodeScript(path.join(SCRIPTS_DIR, 'craft-handoff.js'), [], input([row]), { FOREMAN_PROJECT_DIR: root });
    assert.equal(out.status, 1, out.stderr);
    const result = JSON.parse(out.stdout);
    assert.equal(result.ok, false);
    assert.match(result.error, /judgment\.verification\[0\]/);
    assert.equal(result.prompt, undefined);
    assert.equal(result.tasks, undefined);
  });
}

test('explicit review mode rejects missing reviews, missing rows and empty work slices', (t) => {
  const root = fixture(t);
  for (const rows of [undefined, [], [automatic], [mixed, automatic]]) {
    assert.throws(() => assemble(root, input(rows, { reviewEachIncrement: true })), /requires review/);
  }
  assert.throws(() => assemble(root, input([mixed, { review: human.review }], { reviewEachIncrement: true })), /needs its own goal/);
  for (const flag of ['true', null, 1]) {
    assert.throws(() => assemble(root, input([mixed], { reviewEachIncrement: flag })), /must be a boolean/);
  }
});

test('human-only verification does not synthesize test-first commands', (t) => {
  const request = input([human]);
  request.judgment.testFirst = true;
  assert.throws(() => assemble(fixture(t), request), /requires an executable verification command/);
});

test('legacy Run-only rows retain empty optional scope metadata', (t) => {
  const root = fixture(t);
  const row = { run: 'npm test', expected: 'Tests pass' };
  assert.deepEqual(
    assemble(root, input([{ ...row, goal: '', subject: '', files: [] }])),
    assemble(root, input([row]))
  );
});

test('review transport retains the authorized scope of an investigation', (t) => {
  const request = input([human], { reviewEachIncrement: true });
  request.judgment.question = 'Why does the panel remain open?';
  const result = assemble(fixture(t), request);
  assert.equal(result.ok, true);
  assert.match(result.prompt, /Do not implement a fix unless the user separately authorizes it/);
  assert.match(result.prompt, /current increment's authorized work/);
  assert.doesNotMatch(result.prompt, /Implement only the current increment/);
});
