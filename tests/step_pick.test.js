'use strict';

// `roadmap.js step pick`: the pick branch's decisions as data. These pin each
// code and transition, the trial events each answer records, the host forms
// of the labels, the destination rules it mirrors from
// skills/roadmap/destination-question.md, and its refusals.

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { makeTmpProject, writeRoadmap, writeConfig, initGitRepo, runRoadmap, SCRIPTS_DIR } = require('./helpers.js');
const { cmdStepPick, destinationOptions, today } = require(path.join(SCRIPTS_DIR, 'roadmap.js'));
const trial = require(path.join(SCRIPTS_DIR, 'trial-log.js'));

let project;

beforeEach(() => {
  project = makeTmpProject();
  delete process.env.FOREMAN_HOST;
});

afterEach(() => {
  delete process.env.FOREMAN_HOST;
});

function daysAgo(n) {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function entry(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    why: `Why ${id}`,
    what: `What ${id}`,
    status: 'planned',
    source: 'user',
    depends_on: [],
    planned_touches: [`src/${id}.js`],
    observed_touches: [],
    commits: [],
    created_at: `2026-07-${id.slice(-2)}`,
    updated_at: today(),
    notes: '',
    ...overrides,
  };
}

const step = (flags = {}) => cmdStepPick(project, { flow: 'pick', ...flags });

function events() {
  try {
    return fs.readFileSync(trial.logPath(project), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

const pickEvents = () =>
  events()
    .filter((e) => ['question_asked', 'pick_accepted', 'pick_overridden', 'menu_shown'].includes(e.event))
    .map(({ event, flow, rank, chosen_rank }) => ({ event, ...(flow && { flow }), ...(rank && { rank }), ...(chosen_rank !== undefined && { chosen_rank }) }));

function commitAll() {
  spawnSync('git', ['add', '-A'], { cwd: project });
  spawnSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: project });
}

describe('step pick: the task question', () => {
  test('an empty roadmap says empty', () => {
    writeRoadmap(project, []);
    assert.deepEqual(step(), { next: 'empty' });
  });

  test('settle rows lead, two of each and oldest first, then three candidates; the first is recommended', () => {
    writeRoadmap(project, [
      entry('001'), entry('002'), entry('003'), entry('004'),
      entry('011', { status: 'awaiting_acceptance', commits: ['abc1234'], updated_at: daysAgo(3) }),
      entry('012', { status: 'awaiting_acceptance', commits: ['bcd2345'], updated_at: daysAgo(5) }),
      entry('013', { status: 'awaiting_acceptance', commits: ['cde3456'], updated_at: daysAgo(1) }),
      entry('021', { status: 'in_progress', updated_at: daysAgo(2) }),
      entry('022', { status: 'in_progress', updated_at: daysAgo(4) }),
      entry('023', { status: 'in_progress', updated_at: daysAgo(1) }),
    ]);
    const out = step();
    assert.equal(out.next, 'ask_q1');
    assert.equal(out.question, 'Which task next?');
    assert.deepEqual(out.options.map((o) => [o.id, o.kind]), [
      ['012', 'accept'], ['011', 'accept'], ['022', 'resume'], ['021', 'resume'],
      ['001', 'planned'], ['002', 'planned'], ['003', 'planned'],
    ]);
    assert.equal(out.options[0].label, 'Accept: Task 012 (012) (Recommended)');
    assert.equal(out.options[2].label, 'Resume: Task 022 (022)');
    assert.equal(out.options[4].label, 'Task 001 (001)');
    assert.match(out.options[0].reason, /^finished, waiting on you since /);
    assert.match(out.options[2].reason, /^in progress since /);
    assert.equal(out.options[4].why, 'Why 001');
    assert.ok(out.options.every((o) => !('updated_at' in o)));
    assert.match(out.then, /roadmap\.js' step pick --chose <id> --after q1$/);
    assert.equal(out.stale, undefined);
  });

  test('a Codex option string leads with the id', () => {
    process.env.FOREMAN_HOST = 'codex';
    writeRoadmap(project, [entry('001'), entry('002', { status: 'in_progress' })]);
    const out = step();
    assert.deepEqual(out.options.map((o) => o.label), ['002 - Resume: Task 002 (Recommended)', '001 - Task 001']);
  });

  test('a settle row older than 30 days marks the menu stale', () => {
    writeRoadmap(project, [entry('001'), entry('002', { status: 'in_progress', updated_at: daysAgo(31) })]);
    assert.equal(step().stale, true);
  });

  test('a hint that matches nothing says so and keeps the hint in the next command', () => {
    writeRoadmap(project, [entry('001'), entry('002')]);
    const out = step({ hint: 'zebra crossing' });
    assert.equal(out.hint_matched, false);
    assert.ok(out.then.endsWith("--after q1 --hint 'zebra crossing'"));
  });

  test('a hint keeps only the words its ranking reads, so no shell sees a quote or a $', () => {
    writeRoadmap(project, [entry('001'), entry('002')]);
    assert.ok(step({ hint: `the "auth" $HOME it's sesión` }).then.endsWith("--hint 'the auth HOME it s sesión'"));
  });

  test('one option skips the question and opens Q2 with the entry', () => {
    writeRoadmap(project, [entry('001')]);
    const out = step();
    assert.equal(out.next, 'gather_checks');
    assert.equal(out.entry.id, '001');
    assert.ok(Array.isArray(out.entry.depends_on_docs), 'the entry is not the targeted list --ids row');
    assert.match(out.then, /--entry 001 --intro --checks <n>$/);
  });

  test('one option still reports an unmatched hint and a stale settle row', () => {
    writeRoadmap(project, [entry('001')]);
    assert.equal(step({ hint: 'zebra crossing' }).hint_matched, false);
    writeRoadmap(project, [entry('006', { status: 'in_progress', updated_at: daysAgo(40) })]);
    const out = step();
    assert.equal(out.next, 'resume');
    assert.equal(out.stale, true);
    assert.match(out.then, /--entry 006 --intro --checks <n>$/);
  });

  test('the menu records menu_shown once, and nothing else', () => {
    writeConfig(project, { trialLog: true });
    writeRoadmap(project, [entry('001'), entry('002')]);
    step();
    assert.deepEqual(pickEvents(), [{ event: 'menu_shown' }]);
  });
});

describe('step pick: the answer to Q1', () => {
  beforeEach(() => {
    writeConfig(project, { trialLog: true });
    writeRoadmap(project, [
      entry('001'), entry('002'),
      entry('005', { status: 'awaiting_acceptance', commits: ['abc1234'] }),
      entry('006', { status: 'in_progress' }),
      entry('009', { status: 'done' }),
    ]);
  });

  test('the recommended planned row records pick_accepted', () => {
    writeRoadmap(project, [entry('001'), entry('002')]);
    const out = step({ chose: '001', after: 'q1' });
    assert.equal(out.next, 'gather_checks');
    assert.match(out.then, /--entry 001 --checks <n>$/);
    assert.deepEqual(pickEvents(), [{ event: 'question_asked', flow: 'pick' }, { event: 'pick_accepted', rank: 1 }]);
  });

  test('another planned row records pick_overridden with its rank', () => {
    step({ chose: '002', after: 'q1' });
    assert.deepEqual(pickEvents(), [{ event: 'question_asked', flow: 'pick' }, { event: 'pick_overridden', chosen_rank: 4 }]);
  });

  test('accept and resume choices record no pick event', () => {
    assert.equal(step({ chose: '005', after: 'q1' }).next, 'accept');
    const resume = step({ chose: '006', after: 'q1' });
    assert.equal(resume.next, 'resume');
    assert.match(resume.then, /--entry 006 --checks <n>$/);
    assert.deepEqual(pickEvents(), [{ event: 'question_asked', flow: 'pick' }, { event: 'question_asked', flow: 'pick' }]);
  });

  test('defer records the question only and re-runs the menu', () => {
    const out = step({ chose: 'defer', after: 'q1' });
    assert.equal(out.next, 'defer');
    assert.match(out.then, /step pick$/);
    assert.deepEqual(pickEvents(), [{ event: 'question_asked', flow: 'pick' }]);
  });

  test('an answer off the list records an override with no rank and says what to do', () => {
    assert.throws(() => step({ chose: 'other', after: 'q1' }), /names no listed entry.*--chose <id>/);
    assert.deepEqual(pickEvents(), [{ event: 'question_asked', flow: 'pick' }, { event: 'pick_overridden', chosen_rank: null }]);
  });

  test('a named entry without Q1 records nothing and opens Q2 with it', () => {
    const out = step({ chose: '002' });
    assert.match(out.then, /--entry 002 --intro --checks <n>$/);
    assert.deepEqual(pickEvents(), []);
  });

  test('a finished entry or an unknown id is refused before Q1 is recorded, so a retry logs one question', () => {
    assert.throws(() => step({ chose: '009', after: 'q1' }), /is done, so there is nothing to start/);
    assert.throws(() => step({ chose: '404', after: 'q1' }), /no entry "?404"? in ROADMAP\.jsonl/);
    assert.deepEqual(pickEvents(), []);
  });

  test('a deferred entry the user names is taken as given', () => {
    writeRoadmap(project, [entry('001'), entry('003', { status: 'deferred' })]);
    assert.equal(step({ chose: '003' }).next, 'gather_checks');
  });

  test('a survey breadcrumb in the notes marks the pick stale', () => {
    writeRoadmap(project, [entry('001', { notes: 'survey (unconfirmed): the retry path moved' })]);
    assert.equal(step({ chose: '001' }).stale, true);
  });
});

describe('step pick: the destination question', () => {
  const labels = (out) => out.options.map((o) => o.label);

  beforeEach(() => {
    initGitRepo(project);
    writeRoadmap(project, [
      entry('001'),
      entry('002', { planned_touches: ['src/shared.js'] }),
      entry('006', { status: 'in_progress', planned_touches: ['src/shared.js'] }),
    ]);
    commitAll();
  });

  test('all four options, in order, and the plain case recommends Execute here', () => {
    const out = step({ entry: '002', checks: '1' });
    assert.equal(out.next, 'ask_q2');
    assert.equal(out.question, 'How do you want to run this?');
    assert.deepEqual(out.options.map((o) => o.dest), ['here', 'split', 'agent', 'clipboard']);
    assert.deepEqual(labels(out), [
      'Execute here (Recommended)',
      'Execute here, split by check (Caution)',
      'Execute with a background agent (Caution)',
      'Copy prompt to clipboard',
    ]);
    assert.match(out.options[2].description, /another running task also plans to touch/);
    assert.match(out.then, /--entry 002 --dest <dest> --after q2$/);
  });

  test('other work running, no collision, a clean tree and a check recommend the background agent', () => {
    const out = step({ entry: '001', checks: '1' });
    assert.equal(labels(out)[2], 'Execute with a background agent (Recommended)');
    assert.match(out.options[2].description, /Other work is running/);
  });

  test('the agent never leads without a delegation tool, or in Codex without a reviewer', () => {
    assert.equal(labels(step({ entry: '001', checks: '1', 'no-delegate': true }))[2], 'Execute with a background agent (Caution)');
    assert.equal(labels(step({ entry: '001', checks: '1', 'no-reviewer': true }))[2], 'Execute with a background agent (Caution)');
  });

  test('a resume row never recommends the agent: its collision is unknown', () => {
    writeRoadmap(project, [entry('006', { status: 'in_progress' }), entry('007', { status: 'in_progress' })]);
    commitAll();
    assert.equal(labels(step({ entry: '006', checks: '1' }))[0], 'Execute here (Recommended)');
  });

  test('two sliced checks on a clean tree recommend the split', () => {
    writeRoadmap(project, [entry('001')]);
    commitAll();
    assert.equal(labels(step({ entry: '001', checks: '2', slices: '1' }))[1], 'Execute here, split by check (Recommended)');
    assert.match(step({ entry: '001', checks: '2' }).options[1].description, /one task holds everything/);
  });

  test('some rows naming a slice neither caution nor recommend the split', () => {
    writeRoadmap(project, [entry('001')]);
    commitAll();
    assert.deepEqual(labels(step({ entry: '001', checks: '3', slices: '1' })).slice(0, 2), ['Execute here (Recommended)', 'Execute here, split by check']);
  });

  test('rows with no run command count for the split but not for the agent', () => {
    const out = step({ entry: '001', checks: '2', runnable: '0', slices: '1' });
    assert.equal(labels(out)[1], 'Execute here, split by check (Recommended)');
    assert.match(out.options[2].description, /Nothing runnable/);
  });

  test('a dirty tree cautions the split and the agent', () => {
    fs.writeFileSync(path.join(project, 'scratch.txt'), 'uncommitted');
    const out = step({ entry: '001', checks: '2', slices: '1' });
    assert.deepEqual(labels(out), [
      'Execute here (Recommended)',
      'Execute here, split by check (Caution)',
      'Execute with a background agent (Caution)',
      'Copy prompt to clipboard',
    ]);
    assert.match(out.options[1].description, /uncommitted changes/);
  });

  test('a roadmap-only change is bookkeeping, not a dirty tree', () => {
    writeRoadmap(project, [entry('001', { notes: 'touched' })]);
    assert.equal(labels(step({ entry: '001', checks: '2', slices: '1' }))[1], 'Execute here, split by check (Recommended)');
  });

  test('no repository at all counts as dirty', () => {
    fs.rmSync(path.join(project, '.git'), { recursive: true, force: true });
    assert.equal(labels(step({ entry: '001', checks: '2', slices: '1' }))[1], 'Execute here, split by check (Caution)');
  });

  test('a high context reading recommends the clipboard over everything', () => {
    assert.equal(labels(step({ entry: '001', checks: '1', 'context-high': true }))[3], 'Copy prompt to clipboard (Recommended)');
  });

  test('exactly one option is recommended, never a cautioned one', () => {
    for (const flags of [{}, { slices: '1' }, { 'context-high': true }, { 'no-delegate': true }]) {
      for (const checks of ['0', '1', '2']) {
        const out = step({ entry: '001', checks, ...flags });
        const recommended = labels(out).filter((l) => l.includes('(Recommended)'));
        assert.equal(recommended.length, 1, JSON.stringify({ checks, flags }));
        assert.ok(!recommended[0].includes('(Caution)'), recommended[0]);
      }
    }
  });

  test('--intro names the entry inside the question', () => {
    const out = step({ entry: '001', checks: '0', intro: true });
    assert.equal(out.question, 'Task 001 (001): Why 001. How do you want to run this?');
    assert.equal(out.intro, undefined);
  });

  test('--entry without --checks or --dest, or with a count that is not a number, is refused', () => {
    assert.throws(() => step({ entry: '001' }), /needs --checks <n>/);
    assert.throws(() => step({ entry: '001', checks: 'two' }), /--checks takes a whole number, not two/);
    assert.throws(() => step({ entry: '001', checks: '2', slices: 'all' }), /--slices takes a whole number/);
  });

  test('done or awaiting work gets no destination question', () => {
    writeRoadmap(project, [entry('001', { status: 'done' }), entry('005', { status: 'awaiting_acceptance', commits: ['abc1234'] })]);
    assert.throws(() => step({ entry: '001', checks: '1' }), /is done, so there is nothing to start/);
    assert.throws(() => step({ entry: '005', dest: 'here' }), /awaiting_acceptance, so it is accepted, not crafted/);
  });

  test('every caution and the context reason are worded as destination-question.md words them', () => {
    const words = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const doc = words(fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'skills', 'roadmap', 'destination-question.md'), 'utf-8'));
    const base = { otherWork: true, collision: false, dirty: false, checks: 2, runnable: 2, slices: 1, contextHigh: false, canDelegate: true, reviewer: true };
    const cases = [{ dirty: true }, { checks: 1, runnable: 1, slices: 0 }, { slices: 0 }, { collision: true }, { runnable: 0 }, { canDelegate: false }, { reviewer: false }];
    const reasons = new Set();
    for (const c of cases) {
      for (const o of destinationOptions({ ...base, ...c })) {
        if (o.label.includes('(Caution)')) reasons.add(o.description.split('. ').slice(1).join('. '));
      }
    }
    reasons.add(destinationOptions({ ...base, contextHigh: true })[3].description.split('. ').slice(1).join('. '));
    assert.equal(reasons.size, 9);
    for (const r of reasons) assert.ok(doc.includes(words(r)), `destination-question.md lacks: ${r}`);
  });
});

describe('step pick: craft', () => {
  beforeEach(() => {
    writeConfig(project, { trialLog: true });
    writeRoadmap(project, [entry('001'), entry('006', { status: 'in_progress' })]);
  });

  test('each destination maps to the craft-handoff fields', () => {
    assert.deepEqual(step({ entry: '001', dest: 'split', after: 'q2' }), {
      next: 'craft',
      dest: 'split',
      craft: { entry: '001', host: 'claude', destination: 'task', resume: false, split: true },
    });
    assert.deepEqual(step({ entry: '006', dest: 'agent' }).craft, { entry: '006', host: 'claude', destination: 'agent', resume: true, split: false });
    assert.equal(step({ entry: '001', dest: 'clipboard' }).craft.destination, 'clipboard');
    process.env.FOREMAN_HOST = 'antigravity';
    assert.equal(step({ entry: '001', dest: 'here' }).craft.host, 'antigravity');
    assert.deepEqual(pickEvents(), [{ event: 'question_asked', flow: 'pick' }]);
  });

  test('a destination the user named carries the intro instead of a question', () => {
    assert.equal(step({ entry: '001', dest: 'here', intro: true }).intro.id, '001');
  });

  test('a bad destination or a missing entry is refused', () => {
    assert.throws(() => step({ entry: '001', dest: 'cloud' }), /--dest cloud\. Give here, split, agent or clipboard/);
    assert.throws(() => step({ dest: 'here' }), /needs --entry <id>/);
  });
});

describe('step pick: the command line', () => {
  test('the flow is a positional argument and the reply is one JSON line', () => {
    writeRoadmap(project, [entry('001'), entry('002')]);
    const res = runRoadmap(['step', 'pick'], null, { FOREMAN_PROJECT_DIR: project });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.next, 'ask_q1');
  });

  test('a missing or unknown flow, a bad --after and an unknown flag fail with ok:false', () => {
    writeRoadmap(project, [entry('001')]);
    for (const [argv, pattern] of [
      [['step'], /step takes one flow, pick/],
      [['step', 'add'], /step takes one flow, pick, not add/],
      [['step', 'pick', '--chose', '001', '--after', 'q3'], /--after q3/],
      [['step', 'pick', '--limit', '5'], /--limit/],
    ]) {
      const res = runRoadmap(argv, null, { FOREMAN_PROJECT_DIR: project });
      assert.equal(res.status, 1, argv.join(' '));
      const out = JSON.parse(res.stdout);
      assert.equal(out.ok, false);
      assert.match(out.error, pattern);
    }
  });

  test('the next command runs as given', () => {
    writeRoadmap(project, [entry('001'), entry('002')]);
    const first = JSON.parse(runRoadmap(['step', 'pick'], null, { FOREMAN_PROJECT_DIR: project }).stdout);
    const [, script, ...rest] = first.then.replace('<id>', '002').match(/^node '([^']+)' (.*)$/);
    assert.equal(path.resolve(script), path.join(SCRIPTS_DIR, 'roadmap.js'));
    const res = spawnSync('node', [script, ...rest[0].split(' ')], { encoding: 'utf-8', env: { ...process.env, FOREMAN_PROJECT_DIR: project } });
    assert.equal(JSON.parse(res.stdout).next, 'gather_checks');
  });
});
