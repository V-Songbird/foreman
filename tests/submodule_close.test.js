'use strict';

// [Foreman: 410] An entry whose planned files sit inside a submodule closes
// there: the handoff says to commit inside the submodule with the entry's
// trailer and to record that commit, roadmap.js resolves the sha in the
// submodule and prefixes the observed files, and safe-commit finish never
// stages a gitlink its expected list does not name exactly.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { makeTmpProject, initGitRepo, runRoadmap, runNodeScript, SCRIPTS_DIR } = require('./helpers');

const SAFE_COMMIT = path.join(SCRIPTS_DIR, 'safe-commit.js');
const CRAFT = path.join(SCRIPTS_DIR, 'craft-handoff.js');

let project;
let lib;
let env;

beforeEach(() => {
  project = makeTmpProject();
  lib = path.join(project, 'lib');
  env = { CLAUDE_PROJECT_DIR: project };
});

afterEach(() => {
  fs.rmSync(path.dirname(project), { recursive: true, force: true });
});

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function lines(text) {
  return text.split('\n').filter(Boolean);
}

/**
 * A superproject whose one submodule, `lib`, is registered the way git sees
 * it: a gitlink in the index and a .gitmodules entry naming its path.
 */
function superproject() {
  initGitRepo(project);
  fs.mkdirSync(lib);
  initGitRepo(lib);
  writeFile(lib, 'a.js', 'one\n');
  git(lib, 'add', 'a.js');
  git(lib, 'commit', '-q', '-m', 'lib base');
  writeFile(project, '.gitmodules', '[submodule "lib"]\n\tpath = lib\n\turl = ./lib\n');
  writeFile(project, 'README.md', 'root\n');
  git(project, '-c', 'advice.addEmbeddedRepo=false', 'add', '.gitmodules', 'README.md', 'lib');
  git(project, 'commit', '-q', '-m', 'base');
  assert.match(git(project, 'ls-files', '--stage', '--', 'lib'), /^160000 /, 'lib is a gitlink');
  roadmap(['add'], { title: 'change the lib', why: 'w', what: 'x', source: 'user', planned_touches: ['lib/a.js'] });
  roadmap(['update-status'], { id: '001', status: 'in_progress' });
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

function craft(host) {
  const r = runNodeScript(CRAFT, [], {
    entry: '001',
    destination: 'task',
    host,
    judgment: {
      role: 'an engineer',
      goal: 'to change the lib',
      steps: ['Change lib/a.js.'],
      verification: [{ run: 'node --version', expected: 'prints a version' }],
    },
  }, env);
  const json = JSON.parse(r.stdout);
  assert.equal(json.ok, true, r.stdout + r.stderr);
  return json.prompt;
}

/** Work inside the submodule, committed there with the entry's trailer. */
function commitInLib() {
  writeFile(lib, 'a.js', 'two\n');
  git(lib, 'add', '--', 'a.js');
  git(lib, 'commit', '-q', '-m', 'change the lib', '-m', 'Foreman: 001');
  return git(lib, 'rev-parse', 'HEAD').trim();
}

describe('the handoff close for work inside a submodule', () => {
  for (const host of ['claude', 'codex']) {
    test(`commits inside the submodule and records that commit, on host ${host}`, () => {
      superproject();
      const prompt = craft(host);
      assert.match(prompt, /git -C '?lib'? add -- <the files this task owns>/);
      assert.match(prompt, /Foreman: 001/);
      assert.match(prompt, /git -C '?lib'? rev-parse HEAD/);
      assert.match(prompt, /"commit":"<the submodule commit sha>"/);
      assert.doesNotMatch(prompt, /safe-commit\.js'? finish/);
      assert.doesNotMatch(prompt, /"staged":true/);
    });
  }

  test('a surface outside the submodule keeps the staged close at the root', () => {
    superproject();
    const current = roadmap(['list', '--ids', '001']).entries[0];
    roadmap(['correct'], {
      id: '001',
      expected_updated_at: current.updated_at,
      expected: { planned_touches: ['lib/a.js'] },
      planned_touches: ['README.md', 'lib/a.js'],
    });
    const prompt = craft('claude');
    assert.match(prompt, /safe-commit\.js finish --baseline <baseline\.head> --no-commit/);
    assert.match(prompt, /"staged":true/);
    assert.doesNotMatch(prompt, /git -C lib/);
  });
});

describe('closing an entry from a submodule commit', () => {
  test('records the commit, observes the files with the submodule prefix and stages no gitlink', () => {
    superproject();
    const sha = commitInLib();

    const close = roadmap(['update-status'], { id: '001', status: 'awaiting_acceptance', commit: sha });
    assert.equal(close.entry.status, 'awaiting_acceptance');
    assert.deepEqual(close.entry.commits, [sha]);
    assert.deepEqual(close.entry.observed_touches, ['lib/a.js']);
    assert.equal(git(project, 'diff', '--cached', '--name-only').trim(), '', 'nothing is staged at the root');
    assert.equal(git(lib, 'log', '-1', '--format=%B').trim(), 'change the lib\n\nForeman: 001');
  });
});

describe('safe-commit finish and gitlinks', () => {
  test('refuses a moved gitlink that expected covers only by area, even with --allow-unexpected', () => {
    superproject();
    const baseline = safeCommit(['begin'], null).baseline.head;
    commitInLib();

    for (const flags of [[], ['--allow-unexpected']]) {
      const result = safeCommit(['finish', '--baseline', baseline, '--no-commit', ...flags], { id: '001', expected: ['lib/a.js'] });
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.reason, 'gitlink_not_expected');
      assert.deepEqual(result.gitlinks, ['lib']);
      assert.match(result.error, /lib is a submodule: commit the work inside it/);
      assert.equal(git(project, 'diff', '--cached', '--name-only').trim(), '', 'nothing was staged');
    }
  });

  test('refuses an uncommitted submodule edit the same way', () => {
    superproject();
    const baseline = safeCommit(['begin'], null).baseline.head;
    writeFile(lib, 'a.js', 'dirty\n');

    const result = safeCommit(['finish', '--baseline', baseline, '--no-commit'], { id: '001', expected: ['lib/a.js'] });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.reason, 'gitlink_not_expected');
  });

  test('stages the gitlink when expected names its exact path', () => {
    superproject();
    const baseline = safeCommit(['begin'], null).baseline.head;
    commitInLib();

    const result = safeCommit(['finish', '--baseline', baseline, '--no-commit'], { expected: ['lib'] });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.files, ['lib']);
    assert.deepEqual(lines(git(project, 'diff', '--cached', '--name-only')), ['lib']);
  });
});
