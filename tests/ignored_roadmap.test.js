'use strict';

// [Foreman: 335] A private roadmap: the project git-ignores ROADMAP.jsonl and
// .foreman/. init's commit step, a staged close and safe-commit finish all run
// there without a git error, and each says what it left unstaged. A project
// that tracks its roadmap behaves as before.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { makeTmpProject, initGitRepo, writeConfig, runRoadmap, runNodeScript, SCRIPTS_DIR } = require('./helpers');

const SAFE_COMMIT = path.join(SCRIPTS_DIR, 'safe-commit.js');
const INIT_SKILL = fs.readFileSync(path.join(__dirname, '..', 'skills', 'init', 'SKILL.md'), 'utf-8');
const PRIVATE = ['ROADMAP.jsonl', '.foreman/'];

let project;
let env;

beforeEach(() => {
  project = makeTmpProject();
  env = { CLAUDE_PROJECT_DIR: project };
});

afterEach(() => {
  fs.rmSync(path.dirname(project), { recursive: true, force: true });
});

function git(...args) {
  const r = spawnSync('git', args, { cwd: project, encoding: 'utf-8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function writeFile(rel, content) {
  const full = path.join(project, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

/** A repository whose one commit is a .gitignore holding `ignore`. */
function repo(ignore) {
  initGitRepo(project);
  writeFile('.gitignore', ignore.map((line) => `${line}\n`).join(''));
  git('add', '.gitignore');
  git('commit', '-q', '-m', 'base');
  return git('rev-parse', 'HEAD').trim();
}

function roadmap(argv, payload) {
  const r = runRoadmap(argv, payload, env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
}

function safeCommit(argv, payload) {
  const r = runNodeScript(SAFE_COMMIT, argv, payload, env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
}

function committedFiles() {
  return git('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean).sort();
}

/** One entry moved to in_progress, the way a picked task starts. */
function startEntry() {
  roadmap(['add'], { title: 'ship the thing', why: 'w', what: 'x', source: 'user' });
  roadmap(['update-status'], { id: '001', status: 'in_progress' });
}

// init's step 4 exactly as the skill writes it: the check-ignore command, then
// the commit command with every printed file dropped from both halves, and no
// commit at all when nothing is left.
const DETECT = INIT_SKILL.match(/`(git check-ignore -- [^`]+)`/);
const COMMIT = INIT_SKILL.match(/`(git add -- ROADMAP\.jsonl [^`]+ && git commit [^`]+)`/);

function words(command) {
  return command.match(/"[^"]*"|\S+/g).map((word) => word.replace(/^"(.*)"$/, '$1'));
}

function runInitCommitStep() {
  const [, ...detectArgs] = words(DETECT[1]);
  const detect = spawnSync('git', detectArgs, { cwd: project, encoding: 'utf-8' });
  assert.ok(detect.status === 0 || detect.status === 1, `check-ignore failed: ${detect.stderr}`);
  assert.equal(detect.stderr, '');
  const ignored = detect.stdout.split(/\r?\n/).filter(Boolean);
  const left = detectArgs.slice(2).filter((file) => !ignored.includes(file));
  if (left.length) {
    for (const half of COMMIT[1].split(' && ')) {
      const [, ...args] = words(half).filter((word) => !ignored.includes(word));
      const r = spawnSync('git', args, { cwd: project, encoding: 'utf-8' });
      assert.equal(r.status, 0, `${half} failed: ${r.stderr}`);
    }
  }
  return { ignored, left };
}

function initWritePhase() {
  roadmap(['add'], { title: 'first task', why: 'w', what: 'x', source: 'user' });
  writeFile('.foreman/config.json', '{}');
}

describe("init's commit step", () => {
  test('the skill checks what git ignores before committing', () => {
    assert.ok(DETECT, 'step 4 names its git check-ignore command');
    assert.ok(COMMIT, 'step 4 keeps its pathspec commit command');
    const flat = INIT_SKILL.replace(/\s+/g, ' ');
    assert.match(flat, /never force it with `git add -f`/);
    assert.match(flat, /When no file is left, skip the command/);
    assert.match(flat, /Report back: task count, each file written but not committed because git ignores it/);
  });

  test('a private roadmap is written, and nothing is staged or committed', () => {
    const base = repo(PRIVATE);
    initWritePhase();

    const { ignored, left } = runInitCommitStep();

    assert.deepEqual(ignored, ['ROADMAP.jsonl', '.foreman/config.json']);
    assert.deepEqual(left, []);
    assert.equal(git('rev-parse', 'HEAD').trim(), base, 'no commit was made');
    assert.equal(git('status', '--porcelain').trim(), '', 'and nothing was staged');
    assert.ok(fs.existsSync(path.join(project, 'ROADMAP.jsonl')));
    assert.ok(fs.existsSync(path.join(project, '.foreman', 'config.json')));
  });

  test('an ignored .foreman/ alone drops only the config from the commit', () => {
    repo(['.foreman/']);
    initWritePhase();

    const { ignored } = runInitCommitStep();

    assert.deepEqual(ignored, ['.foreman/config.json']);
    assert.deepEqual(committedFiles(), ['ROADMAP.jsonl']);
    assert.equal(git('log', '-1', '--format=%s').trim(), 'chore: init foreman roadmap');
  });

  test('a tracked roadmap is committed as before', () => {
    repo([]);
    initWritePhase();

    const { ignored } = runInitCommitStep();

    assert.deepEqual(ignored, []);
    assert.deepEqual(committedFiles(), ['.foreman/config.json', 'ROADMAP.jsonl']);
    assert.equal(git('log', '-1', '--format=%s').trim(), 'chore: init foreman roadmap');
  });
});

describe('a staged close', () => {
  test('in a private roadmap it stages the task alone and says the roadmap was not staged', () => {
    const base = repo(PRIVATE);
    startEntry();
    const begin = safeCommit(['begin'], null);
    assert.equal(begin.dirty, false);
    assert.equal(begin.baseline.head, base);
    writeFile('src/a.js', 'x\n');

    const finish = safeCommit(['finish', '--baseline', base, '--no-commit'], { id: '001', expected: ['src'] });
    assert.equal(finish.ok, true, JSON.stringify(finish));
    assert.deepEqual(finish.files, ['src/a.js']);
    assert.equal(finish.warnings, undefined, 'the roadmap is not this call to report');

    const close = roadmap(['update-status'], { id: '001', status: 'awaiting_acceptance', staged: true });
    assert.equal(close.entry.status, 'awaiting_acceptance');
    assert.deepEqual(close.entry.observed_touches, ['src/a.js']);
    assert.equal(close.trailer, 'Foreman: 001');
    assert.equal(close.roadmap_staged, false);
    assert.equal(close.warnings.length, 1);
    assert.match(close.warnings[0], /^git-ignored here, so not staged: ROADMAP\.jsonl\./);
    assert.match(close.warnings[0], /through its "Foreman: 001" trailer/);
    assert.equal(git('diff', '--cached', '--name-only').trim(), 'src/a.js');

    git('commit', '-q', '-m', 'ship the thing', '-m', close.trailer);
    assert.deepEqual(committedFiles(), ['src/a.js']);
    assert.equal(git('status', '--porcelain').trim(), '');
    assert.match(fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8'), /"status":"awaiting_acceptance"/);
  });

  test('a recorded lesson in a private roadmap is named as not staged too', () => {
    repo(PRIVATE);
    writeConfig(project, { ledger: { enabled: true } });
    startEntry();
    writeFile('src/a.js', 'x\n');
    git('add', 'src/a.js');

    const close = roadmap(['update-status'], {
      id: '001',
      status: 'awaiting_acceptance',
      staged: true,
      lesson: 'src/a.js holds the thing',
    });
    assert.equal(close.lesson.stored, true, JSON.stringify(close.lesson));
    assert.equal(close.roadmap_staged, false);
    assert.match(close.warnings[0], /^git-ignored here, so not staged: ROADMAP\.jsonl, \.foreman\/notes\.jsonl\./);
    assert.equal(git('diff', '--cached', '--name-only').trim(), 'src/a.js');
  });

  test('an ignored .foreman/ alone still stages the roadmap and names the notes file', () => {
    repo(['.foreman/']);
    writeConfig(project, { ledger: { enabled: true } });
    startEntry();
    writeFile('src/a.js', 'x\n');
    git('add', 'src/a.js');

    const close = roadmap(['update-status'], {
      id: '001',
      status: 'awaiting_acceptance',
      staged: true,
      lesson: 'src/a.js holds the thing',
    });
    assert.equal(close.roadmap_staged, true);
    assert.deepEqual(close.warnings, ['git-ignored here, so not staged: .foreman/notes.jsonl.']);
    assert.deepEqual(git('diff', '--cached', '--name-only').split('\n').filter(Boolean).sort(), ['ROADMAP.jsonl', 'src/a.js']);
  });

  test('a tracked roadmap is staged as before, with nothing to warn about', () => {
    repo([]);
    startEntry();
    writeFile('src/a.js', 'x\n');
    git('add', 'src/a.js');

    const close = roadmap(['update-status'], { id: '001', status: 'awaiting_acceptance', staged: true });
    assert.equal(close.roadmap_staged, true);
    assert.equal(close.warnings, undefined);
    assert.deepEqual(git('diff', '--cached', '--name-only').split('\n').filter(Boolean).sort(), ['ROADMAP.jsonl', 'src/a.js']);
  });
});

describe('safe-commit finish with a declared roadmap close', () => {
  test('in a private roadmap it commits the task alone and says the roadmap was not staged', () => {
    const base = repo(PRIVATE);
    startEntry();
    assert.equal(safeCommit(['begin'], null).baseline.head, base);
    writeFile('src/a.js', 'x\n');
    assert.equal(roadmap(['update-status'], { id: '001', status: 'awaiting_acceptance', staged: true }).roadmap_staged, false);

    const finish = safeCommit(['finish', '--baseline', base], {
      id: '001',
      expected: ['src'],
      message_title: 'ship the thing',
      roadmap_close: true,
    });

    assert.equal(finish.ok, true, JSON.stringify(finish));
    assert.equal(finish.committed, true);
    assert.deepEqual(finish.files, ['src/a.js']);
    assert.equal(finish.attested.ok, true);
    assert.equal(finish.warnings.length, 1);
    assert.match(finish.warnings[0], /^git-ignored here, so not staged: ROADMAP\.jsonl\./);
    assert.match(finish.warnings[0], /through its "Foreman: 001" trailer/);
    assert.equal(git('log', '-1', '--format=%B').trim(), 'ship the thing\n\nForeman: 001');
    assert.equal(git('status', '--porcelain').trim(), '');
  });

  test('a tracked roadmap rides along as before, with nothing to warn about', () => {
    const base = repo([]);
    startEntry();
    assert.equal(safeCommit(['begin'], null).baseline.head, base);
    writeFile('src/a.js', 'x\n');
    roadmap(['update-status'], { id: '001', status: 'awaiting_acceptance', staged: true });

    const finish = safeCommit(['finish', '--baseline', base], {
      id: '001',
      expected: ['src'],
      message_title: 'ship the thing',
      roadmap_close: true,
    });

    assert.equal(finish.ok, true, JSON.stringify(finish));
    assert.deepEqual(finish.files, ['ROADMAP.jsonl', 'src/a.js']);
    assert.equal(finish.warnings, undefined);
  });
});
