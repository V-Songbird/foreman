'use strict';

// [Foreman: 296] These tests prove transport and the real notes/checkpoint
// CLI contract. A separate Codex rehearsal must demonstrate actual waiting.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assemble } = require('../scripts/craft-handoff');
const { today } = require('../scripts/roadmap');
const { makeTmpProject, writeRoadmap, writeConfig, initGitRepo, commitFile, runRoadmap, runNodeScript, SCRIPTS_DIR, HOOKS_DIR } = require('./helpers');

function fixture(t, { git = false } = {}) {
  const root = makeTmpProject();
  t.after(() => fs.rmSync(path.dirname(root), { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'panel.md'), 'Panel draft\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const entry = {
    id: '001', title: 'Document the panel', why: 'Help users open and close the panel.',
    what: 'Document the panel in panel.md.', status: 'in_progress', source: 'user',
    depends_on: [], planned_touches: ['panel.md'], observed_touches: [], commits: [],
    created_at: today(), updated_at: today(), notes: '',
  };
  writeRoadmap(root, [entry, { ...entry, id: '002', title: 'Dependent work', status: 'planned', depends_on: ['001'] }]);
  writeConfig(root, { ledger: { enabled: false } });
  if (git) {
    initGitRepo(root);
    // Commit fixture setup only. Tests never stage or commit in the real repo.
    const result = spawnSync('git', ['add', '--', 'panel.md', 'package.json', 'ROADMAP.jsonl', '.foreman/config.json'], { cwd: root });
    assert.equal(result.status, 0);
    commitFile(root, '.gitignore', '.foreman/*\n!.foreman/config.json\n');
  }
  return root;
}

const row = {
  goal: 'Explain how to open the panel', files: ['panel.md'],
  run: 'npm test', expected: 'The documentation checks pass',
  review: { action: 'Read the opening instructions', expected: 'They explain opening, without claiming closing works yet' },
};
function input(destination, count = 1) {
  return {
    entry: '001', destination, split: true, reviewEachIncrement: true,
    judgment: { goal: 'to document the panel', steps: ['Document opening, then closing as separate results.'],
      verification: Array.from({ length: count }, (_, i) => ({ ...row, goal: `Document part ${i + 1}` })) },
  };
}
function cli(root, verb, payload) {
  const result = runRoadmap([verb], payload, { FOREMAN_PROJECT_DIR: root });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, true);
  return json;
}

for (const destination of ['task', 'clipboard', 'agent']) {
  for (const count of [1, 2]) {
    test(`${destination} with ${count} rows includes the same complete review protocol`, (t) => {
      const root = fixture(t);
      const result = assemble(root, input(destination, count));
      assert.equal(result.ok, true, JSON.stringify(result.gate));
      const blocks = result.prompt.match(/<increment_review>\n([\s\S]*?)\n<\/increment_review>/g);
      assert.equal(blocks.length, 1, 'one review protocol per handoff, not one per check');
      const canonical = fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'skills', 'roadmap', 'increment-review.md'), 'utf8').trim();
      assert.ok(blocks[0].includes(canonical), 'portable prompt carries the full shared protocol');
      const record = JSON.parse(blocks[0].match(/JSON stdin: `([^`]+)`/)[1]);
      assert.equal(record.id, '001');
      assert.ok(record.notes);
      assert.match(blocks[0], /roadmap\.js' annotate/);
      assert.doesNotMatch(result.prompt, /Record a human-only check only if it is answerable now and beyond those tools/);
      if (count === 1) assert.doesNotMatch(result.prompt, /Checkpoint protocol for this multi-task run/);
      if (destination === 'task') {
        assert.equal(result.tasks.length, count);
        assert.ok(result.tasks[0].description.includes(canonical));
        if (count > 1) assert.doesNotMatch(result.tasks[0].description, /ROADMAP\.jsonl entry/);
        assert.match(result.tasks.at(-1).description, /close instructions below apply only to the whole task/);
      }
    });
  }
}

test('portable review is embedded rather than depending on a reference file at the destination', (t) => {
  const root = fixture(t);
  const result = assemble(root, input('clipboard'));
  fs.writeFileSync(path.join(root, 'pasted-prompt.txt'), result.prompt);
  assert.equal(fs.existsSync(path.join(root, 'skills', 'roadmap', 'increment-review.md')), false);
  const pasted = fs.readFileSync(path.join(root, 'pasted-prompt.txt'), 'utf8');
  assert.match(pasted, /## Present and wait/);
  assert.match(pasted, /## Record the observed decision/);
  assert.match(pasted, /## Checkpoint and parent/);
});

test('entry-less review never invents an entry or an annotate payload', (t) => {
  const request = input('clipboard');
  delete request.entry;
  request.title = 'Document the panel';
  request.what = 'Document opening in panel.md.';
  request.planned_touches = ['panel.md'];
  const result = assemble(fixture(t), request);
  assert.equal(result.ok, true);
  assert.match(result.prompt, /This handoff has no roadmap entry/);
  const protocol = result.prompt.match(/<increment_review>[\s\S]*?<\/increment_review>/)[0];
  assert.doesNotMatch(protocol, /JSON stdin:/);
});

test('requireVerification false cannot remove the requested intermediate review or mutate config', (t) => {
  const root = fixture(t);
  writeConfig(root, { requireVerification: false, checkpoints: { branch: false } });
  const before = fs.readFileSync(path.join(root, '.foreman', 'config.json'), 'utf8');
  const result = assemble(root, input('clipboard', 2));
  assert.equal(result.ok, true);
  assert.match(result.prompt, /<increment_review>/);
  assert.match(result.prompt, /keep the parent in_progress/);
  assert.match(result.prompt, /safe-commit begin\/finish boundaries/);
  assert.doesNotMatch(result.prompt, /stage only the files that task changed \(`git add/);
  assert.equal(fs.readFileSync(path.join(root, '.foreman', 'config.json'), 'utf8'), before);
});

test('ordinary Run-only handoffs keep the former close and checkpoint instructions', (t) => {
  const root = fixture(t);
  const request = input('clipboard', 2);
  request.reviewEachIncrement = false;
  request.judgment.verification = request.judgment.verification.map(({ review, ...automatic }) => automatic);
  const result = assemble(root, request);
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.prompt, /<increment_review>/);
  assert.match(result.prompt, /Record a human-only check only if it is answerable now and beyond those tools/);
  assert.match(result.prompt, /stage only the files that task changed \(`git add/);
});

test('reviewed closure carries the shared evidence reconciliation protocol', (t) => {
  const result = assemble(fixture(t), input('clipboard'));
  const protocol = fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'skills', 'roadmap', 'close-increments.md'), 'utf8').trim();
  assert.ok(result.prompt.includes(protocol));
  assert.match(result.prompt, /Offer Test first only for checks still unverified/);
  assert.doesNotMatch(result.prompt, /If recorded `unverified:` checks remain, offer Test first/);
});

test('disabling final verification keeps explicit intermediate review and closure scope', (t) => {
  const root = fixture(t);
  writeConfig(root, { requireVerification: false });
  const result = assemble(root, input('task', 2));
  assert.equal(result.ok, true);
  assert.match(result.prompt, /The last increment's acceptance alone is not final acceptance/);
  assert.match(result.prompt, /An explicit user instruction to continue without a particular review/);
  assert.match(result.prompt, /record it as `unverified:`/i);
});

test('review notes preserve feedback and decisions without closing the parent or unblocking dependents', (t) => {
  const root = fixture(t);
  const feedback = 'changes requested: opening instructions at panel.md need the exact button label; closing remains pending.';
  const notes = [
    'review pending: panel.md opening instructions; npm test passed; awaiting reviewer, closing not implemented.',
    feedback,
    'paused: preserve panel.md draft and its requested correction; no acceptance.',
    'accepted: reviewer accepted corrected opening text in panel.md; npm test passed; closing remains pending; no commit.',
  ];
  for (const note of notes) {
    const result = cli(root, 'annotate', { id: '001', notes: note });
    assert.equal(result.entry.status, 'in_progress');
  }
  const entries = cli(root, 'list').entries;
  assert.ok(entries.find((e) => e.id === '001').notes.includes(feedback));
  const before = fs.readFileSync(path.join(root, 'ROADMAP.jsonl'), 'utf8');
  const started = runNodeScript(path.join(HOOKS_DIR, 'codex-task.js'), ['start', '--id', '002'], null, { FOREMAN_PROJECT_DIR: root });
  const out = JSON.parse(started.stdout);
  assert.equal(out.dispatchReady, false);
  assert.equal(fs.readFileSync(path.join(root, 'ROADMAP.jsonl'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.join(root, '.foreman')), ['config.json'], 'no per-increment store created');
});

test('annotate is append-only and a repeated acceptance note does not create an approval count', (t) => {
  const root = fixture(t);
  const note = 'accepted: opening in panel.md; uncommitted; closing pending.';
  cli(root, 'annotate', { id: '001', notes: note });
  const again = cli(root, 'annotate', { id: '001', notes: note });
  assert.equal(again.entry.notes.split(note).length - 1, 2, 'uncertain writes must be reread, not blindly retried');
  assert.equal(again.entry.status, 'in_progress');
  assert.equal(cli(root, 'list').entries.find((e) => e.id === '002').status, 'planned');
});

test('an accepted note before a checkpoint is not a commit and a dirty start offers no baseline', (t) => {
  const root = fixture(t, { git: true });
  const before = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(root, 'panel.md'), 'Opening instructions updated\n');
  cli(root, 'annotate', { id: '001', notes: 'accepted: updated opening in panel.md; npm test passed; uncommitted, closing pending.' });
  const result = runNodeScript(path.join(SCRIPTS_DIR, 'safe-commit.js'), ['begin'], null, { FOREMAN_PROJECT_DIR: root });
  const boundary = JSON.parse(result.stdout);
  assert.equal(boundary.ok, true, result.stdout);
  assert.equal(boundary.dirty, true);
  assert.equal(boundary.baseline, undefined);
  assert.equal(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(), before);
  assert.deepEqual(cli(root, 'list').entries.find((e) => e.id === '001').commits, []);
});

test('an eligible checkpoint after review leaves acceptance notes and the parent open', (t) => {
  const root = fixture(t, { git: true });
  const boundaryRun = runNodeScript(path.join(SCRIPTS_DIR, 'safe-commit.js'), ['begin'], null, { FOREMAN_PROJECT_DIR: root });
  const boundary = JSON.parse(boundaryRun.stdout);
  assert.equal(boundary.dirty, false, boundaryRun.stdout);
  fs.writeFileSync(path.join(root, 'panel.md'), 'Reviewed opening instructions\n');
  cli(root, 'annotate', { id: '001', notes: 'accepted: fixture reviewer accepted opening in panel.md; closing pending; checkpoint not yet created.' });
  const committed = runNodeScript(path.join(SCRIPTS_DIR, 'safe-commit.js'), ['finish', '--baseline', boundary.baseline.head], {
    expected: ['panel.md'], message_title: 'task 1/2: Document opening',
  }, { FOREMAN_PROJECT_DIR: root });
  const result = JSON.parse(committed.stdout);
  assert.equal(result.ok, true, committed.stdout + committed.stderr);
  const parent = cli(root, 'list').entries.find((entry) => entry.id === '001');
  assert.equal(parent.status, 'in_progress');
  assert.match(parent.notes, /accepted: fixture reviewer/);
  const message = spawnSync('git', ['log', '-1', '--format=%B'], { cwd: root, encoding: 'utf8' }).stdout;
  assert.match(message, /task 1\/2: Document opening/);
  assert.doesNotMatch(message, /Foreman: 001/);
  const changed = spawnSync('git', ['show', '--format=', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  assert.equal(changed, 'panel.md', 'shared roadmap notes do not ride along in the increment checkpoint');
});
