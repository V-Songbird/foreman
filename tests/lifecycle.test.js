'use strict';

// [Foreman: 184] The whole tracked-roadmap task lifecycle, end to end, with
// the real scripts against a real repository — the seam the per-script
// suites never cross: the in_progress flip dirties a tracked roadmap BEFORE
// safe-commit begin, and the close still lands as one clean commit.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  makeTmpProject,
  writeRoadmap,
  writeConfig,
  initGitRepo,
  runNodeScript,
  runRoadmap,
  SCRIPTS_DIR,
} = require('./helpers');

const SAFE_COMMIT = path.join(SCRIPTS_DIR, 'safe-commit.js');

let project;
let env;

beforeEach(() => {
  project = makeTmpProject();
  env = { CLAUDE_PROJECT_DIR: project };
});

function git(...args) {
  const r = spawnSync('git', args, { cwd: project, encoding: 'utf-8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

describe('tracked-roadmap lifecycle', () => {
  test('flip -> begin -> work -> finish --no-commit -> staged close -> one clean commit', () => {
    initGitRepo(project);
    writeConfig(project, { requireVerification: false });
    writeRoadmap(project, [
      {
        id: '001',
        title: 'ship the thing',
        why: 'w',
        what: 'x',
        status: 'planned',
        source: 'user',
        depends_on: [],
        touches: [],
        commits: [],
        notes: '',
      },
    ]);
    git('add', '-A');
    git('commit', '-q', '-m', 'baseline');

    // 1. The destination session flips the entry first — the tracked
    //    roadmap is dirty from here on.
    const flip = JSON.parse(
      runRoadmap(['update-status'], { id: '001', status: 'in_progress' }, env).stdout
    );
    assert.equal(flip.entry.status, 'in_progress');
    assert.match(git('status', '--porcelain'), /ROADMAP\.jsonl/);

    // 2. begin still hands out the boundary.
    const begin = JSON.parse(runNodeScript(SAFE_COMMIT, ['begin'], null, env).stdout);
    assert.equal(begin.ok, true);
    assert.equal(begin.dirty, false, JSON.stringify(begin));
    assert.deepEqual(begin.ledger_dirty, ['ROADMAP.jsonl']);
    const baseline = begin.baseline.head;

    // 3. The work.
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.writeFileSync(path.join(project, 'src', 'thing.js'), 'done\n', 'utf-8');

    // 4. Stage the task's own files; the ledger stays out.
    const finish = JSON.parse(
      runNodeScript(
        SAFE_COMMIT,
        ['finish', '--baseline', baseline, '--no-commit'],
        { id: '001', expected: ['src'] },
        env
      ).stdout
    );
    assert.equal(finish.ok, true, JSON.stringify(finish));
    assert.deepEqual(finish.files, ['src/thing.js']);
    assert.deepEqual(finish.ledger_excluded, ['ROADMAP.jsonl']);
    assert.equal(finish.trailer, 'Foreman: 001');

    // 5. The staged close folds the index into observed_touches and stages
    //    the roadmap — flip and close now ride the same index.
    const close = JSON.parse(
      runRoadmap(['update-status'], { id: '001', status: 'done', staged: true, notes: 'shipped' }, env).stdout
    );
    assert.equal(close.entry.status, 'done');
    assert.equal(close.roadmap_staged, true);
    assert.deepEqual(close.entry.observed_touches, ['src/thing.js']);

    // 6. One commit carries the work, the flip, and the close.
    git('commit', '-q', '-m', 'Ship the thing', '-m', close.trailer);
    assert.equal(git('status', '--porcelain').trim(), '', 'the tree ends clean');
    const files = git('show', '--name-only', '--format=', 'HEAD')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .sort();
    assert.deepEqual(files, ['ROADMAP.jsonl', 'src/thing.js']);
    assert.match(git('log', '-1', '--format=%B'), /Foreman: 001/);
  });
});
