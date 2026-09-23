'use strict';

// The staged close + `Foreman: <id>` commit trailer — the inverse pointer
// that lets a roadmap close land inside its own commit:
//   - update-status staged:true derives touches from the index, stages
//     ROADMAP.jsonl itself, returns the trailer line, and records no sha
//   - staged and commit are mutually exclusive
//   - trailerIdsIn parses trailer lines, not anchor comments or prose
//   - post-commit.js: a done-today or awaiting_acceptance entry named by
//     HEAD's trailer gets no follow-up nudge (this commit IS its close, or
//     its acceptance record); an in_progress entry named by the trailer is
//     tagged as the one this commit completes

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  runScriptRaw,
  runRoadmap,
  makeTmpProject,
  writeRoadmap,
  writeConfig,
  initGitRepo,
  runNodeScript,
} = require('./helpers');

const { trailerIdsIn, commitTrailerFor } = require('../scripts/roadmap');

let project;
let env;

beforeEach(() => {
  project = makeTmpProject();
  env = { CLAUDE_PROJECT_DIR: project };
});

function entry(id, status, extra) {
  return {
    id,
    title: 'ship the thing',
    status,
    why: '',
    what: '',
    notes: '',
    commits: [],
    touches: [],
    depends_on: [],
    ...(extra || {}),
  };
}

function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function writeFile(rel, content) {
  const full = path.join(project, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function git(...args) {
  const r = spawnSync('git', args, { cwd: project, encoding: 'utf-8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function commitAllWithMessage(message) {
  git('add', '-A');
  git('commit', '-q', '-m', message);
}

describe('update-status staged mode', () => {
  test('staged and commit together is an error', () => {
    writeRoadmap(project, [entry('001', 'in_progress')]);
    const r = runRoadmap(['update-status'], { id: '001', status: 'done', staged: true, commit: 'abc1234' }, env);
    assert.equal(r.status, 1);
    assert.match(JSON.parse(r.stdout).error, /mutually exclusive/);
  });

  test('staged close derives touches from the index, stages the roadmap, returns the trailer', () => {
    initGitRepo(project);
    writeRoadmap(project, [entry('001', 'in_progress')]);
    writeFile('src/thing.js', 'x\n');
    git('add', '-A'); // stages src/thing.js AND ROADMAP.jsonl

    const r = runRoadmap(['update-status'], { id: '001', status: 'done', staged: true }, env);
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.entry.status, 'done');
    assert.ok(json.entry.observed_touches.includes('src/thing.js'), JSON.stringify(json.entry.observed_touches));
    assert.ok(!json.entry.observed_touches.includes('ROADMAP.jsonl'), 'the roadmap itself is not task footprint');
    assert.deepEqual(json.entry.commits, [], 'a staged close records no sha');
    assert.equal(json.trailer, 'Foreman: 001');
    assert.equal(json.roadmap_staged, true);

    // The rewritten ROADMAP.jsonl is staged, so one commit carries both.
    const staged = git('diff', '--cached', '--name-only');
    assert.ok(staged.split('\n').includes('ROADMAP.jsonl'), staged);
  });

  test('staged close outside a git repo fails soft', () => {
    writeRoadmap(project, [entry('001', 'in_progress')]);
    const r = runRoadmap(['update-status'], { id: '001', status: 'done', staged: true }, env);
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.entry.status, 'done');
    assert.equal(json.trailer, 'Foreman: 001');
    assert.equal(json.roadmap_staged, false);
    assert.equal(json.derived_touches, undefined);
  });
});

describe('trailer parsing', () => {
  test('parses single and multi-id trailer lines, first-seen order, deduped', () => {
    assert.deepEqual(trailerIdsIn('fix the bug\n\nForeman: 042'), ['042']);
    assert.deepEqual(trailerIdsIn('msg\n\nForeman: 041, 042\nForeman: 042'), ['041', '042']);
  });

  test('ignores anchor comments, inline mentions, and ids under three digits', () => {
    assert.deepEqual(trailerIdsIn('code has [Foreman: 042] anchors'), []);
    assert.deepEqual(trailerIdsIn('see Foreman: 042 for details, mid-sentence'), []);
    assert.deepEqual(trailerIdsIn('Foreman: 42'), []);
    assert.deepEqual(trailerIdsIn('Foreman: 7'), []);
    assert.deepEqual(trailerIdsIn(''), []);
  });

  test('parses ids past 999 whole, and rejects the over-padded form', () => {
    assert.deepEqual(trailerIdsIn('Foreman: 1042'), ['1042']);
    assert.deepEqual(trailerIdsIn('msg\n\nForeman: 999, 1000'), ['999', '1000']);
    assert.deepEqual(trailerIdsIn('Foreman: 01000'), []);
  });

  test('commitTrailerFor produces the line trailerIdsIn parses', () => {
    assert.deepEqual(trailerIdsIn(`subject\n\n${commitTrailerFor('007')}`), ['007']);
  });
});

describe('post-commit.js trailer behavior', () => {
  // [Foreman: 193] The hook resolves which repo scope the commit's own cwd
  // belongs to before reading anything — every test here already calls
  // initGitRepo(project) first, so cwd: project lands on the root scope.
  function bashPayload(command) {
    return { tool_name: 'Bash', tool_input: { command }, cwd: project };
  }

  function runHook() {
    const result = runScriptRaw('post-commit.js', bashPayload('git commit -m "wip"'), env);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }

  test('a done-today entry named by HEAD trailer gets no follow-up nudge', () => {
    initGitRepo(project);
    writeConfig(project, { discoverySuggestions: false });
    writeRoadmap(project, [entry('001', 'done', { updated_at: localToday() })]);
    writeFile('src/thing.js', 'x\n');
    commitAllWithMessage('task 1/1: ship the thing\n\nForeman: 001');
    assert.equal(runHook(), '');
  });

  test('a done-today entry NOT named by HEAD trailer still nudges', () => {
    initGitRepo(project);
    writeConfig(project, { discoverySuggestions: false });
    writeRoadmap(project, [entry('001', 'done', { updated_at: localToday() })]);
    writeFile('src/thing.js', 'x\n');
    commitAllWithMessage('unrelated later work');
    assert.match(runHook(), /follow-up fix/);
  });

  test('an in_progress entry named by HEAD trailer is tagged as the one', () => {
    initGitRepo(project);
    writeConfig(project, { discoverySuggestions: false });
    writeRoadmap(project, [entry('001', 'in_progress')]);
    writeFile('src/thing.js', 'x\n');
    commitAllWithMessage('finish it\n\nForeman: 001');
    assert.match(runHook(), /named in this commit's Foreman: trailer/);
  });

  // [Foreman: 194] Same trailer exclusion as a done-today entry: the
  // trailer commit IS the acceptance-recording commit, so it needs no
  // separate follow-up nudge.
  test('an awaiting_acceptance entry named by HEAD trailer gets no follow-up nudge', () => {
    initGitRepo(project);
    writeConfig(project, { discoverySuggestions: false });
    writeRoadmap(project, [entry('001', 'awaiting_acceptance')]);
    writeFile('src/thing.js', 'x\n');
    commitAllWithMessage('record the follow-up\n\nForeman: 001');
    assert.equal(runHook(), '');
  });
});

// [Foreman: 539] A staged close commits Foreman's pending bookkeeping as it
// stands, whoever wrote it, so the committed roadmap never trails the working
// one: other entries' roadmap edits, a lesson a `commit:` close stored, and an
// archive move all ride in the next staged close's commit.
describe('a staged close commits all pending bookkeeping', () => {
  const SAFE_COMMIT = path.join(__dirname, '..', 'scripts', 'safe-commit.js');

  function safeCommit(argv, payload) {
    const r = runNodeScript(SAFE_COMMIT, argv, payload, env);
    return JSON.parse(r.stdout);
  }

  function roadmap(argv, payload) {
    const r = runRoadmap(argv, payload, env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout);
  }

  /** A tracked roadmap with `entries`, committed, and a clean tree. */
  function trackedRoadmap(entries) {
    initGitRepo(project);
    writeRoadmap(project, entries);
    commitAllWithMessage('base');
  }

  /** One task on `001` under the primitive: begin, write, finish, staged close, commit. */
  function closeStaged(file) {
    const begin = safeCommit(['begin']);
    assert.equal(begin.dirty, false, JSON.stringify(begin));
    writeFile(file, 'work\n');
    const finish = safeCommit(['finish', '--baseline', begin.baseline.head, '--no-commit'], { id: '001', expected: [file] });
    assert.equal(finish.ok, true, JSON.stringify(finish));
    const close = roadmap(['update-status'], { id: '001', status: 'done', staged: true });
    assert.equal(close.roadmap_staged, true, JSON.stringify(close));
    git('commit', '-q', '-m', 'close 001', '-m', 'Foreman: 001');
    return finish;
  }

  const atHead = (rel) => git('show', `HEAD:${rel}`);
  const clean = () => git('status', '--porcelain') === '';

  test("another entry's mid-task annotate rides in the close's commit", () => {
    trackedRoadmap([entry('001', 'in_progress'), entry('002', 'planned')]);
    const begin = safeCommit(['begin']);
    writeFile('src/a.js', 'work\n');
    roadmap(['annotate'], { id: '002', notes: 'noted while 001 ran' });
    const finish = safeCommit(['finish', '--baseline', begin.baseline.head, '--no-commit'], { id: '001', expected: ['src/a.js'] });
    assert.equal(finish.ok, true, JSON.stringify(finish));
    roadmap(['update-status'], { id: '001', status: 'done', staged: true });
    git('commit', '-q', '-m', 'close 001', '-m', 'Foreman: 001');
    assert.ok(clean(), git('status', '--porcelain'));
    assert.match(atHead('ROADMAP.jsonl'), /noted while 001 ran/);
  });

  test('a lesson a commit: close stored neither blocks the next finish nor stays uncommitted', () => {
    trackedRoadmap([entry('001', 'in_progress'), entry('002', 'in_progress')]);
    writeConfig(project, { ledger: { enabled: true } });
    commitAllWithMessage('ledger on');
    writeFile('src/b.js', 'work\n');
    git('add', '--', 'src/b.js');
    git('commit', '-q', '-m', 'work for 002', '-m', 'Foreman: 002');
    const sha = git('rev-parse', 'HEAD').trim();
    const stored = roadmap(['update-status'], { id: '002', status: 'done', commit: sha, lesson: 'src/b.js keeps the retry state.' });
    assert.equal(stored.lesson && stored.lesson.stored, true, JSON.stringify(stored));

    const finish = closeStaged('src/a.js');
    assert.ok((finish.ledger_excluded || []).includes('.foreman/notes.jsonl'), JSON.stringify(finish));
    assert.ok(clean(), git('status', '--porcelain'));
    assert.match(atHead('.foreman/notes.jsonl'), /keeps the retry state/);
  });

  test('an archive move is committed whole by the next staged close', () => {
    const full = { why: 'w', what: 'x', source: 'user', created_at: localToday(), updated_at: localToday() };
    trackedRoadmap([entry('001', 'in_progress', full), entry('002', 'done', full), entry('003', 'done', full)]);
    roadmap(['archive'], { ids: ['002', '003'] });
    closeStaged('src/a.js');
    assert.ok(clean(), git('status', '--porcelain'));
    const ids = `${atHead('ROADMAP.jsonl')}\n${atHead('.foreman/archive.jsonl')}`;
    for (const id of ['001', '002', '003']) assert.match(ids, new RegExp(`"id":"${id}"`), `${id} is missing at HEAD`);
  });
});
