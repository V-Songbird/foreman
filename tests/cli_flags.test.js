'use strict';

// [Foreman: 692] Every Foreman CLI refuses a flag it does not take, the way
// roadmap.js does (tests/roadmap.test.js "unknown flags"): exit 1, the error
// names the flags that CLI takes, and nothing is written. Each case below
// used to exit 0 with the flag dropped; safe-commit's `--no-comit` committed.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  makeTmpProject,
  writeConfig,
  writeRoadmap,
  runNodeScript,
  initGitRepo,
  commitFile,
  SCRIPTS_DIR,
} = require('./helpers');

let project;
let env;

// A git project with the trial log on, one commit and an uncommitted change,
// so a CLI that ignored the bad flag would stage, commit or log something.
beforeEach(() => {
  project = makeTmpProject();
  initGitRepo(project);
  writeRoadmap(project, []);
  writeConfig(project, { trialLog: true });
  commitFile(project, 'src/a.js', 'one\n');
  spawnSync('git', ['add', '-A'], { cwd: project });
  spawnSync('git', ['commit', '-q', '-m', 'base'], { cwd: project });
  fs.writeFileSync(path.join(project, 'src/a.js'), 'two\n');
  env = { FOREMAN_PROJECT_DIR: project };
});

function git(...args) {
  return spawnSync('git', args, { cwd: project, encoding: 'utf-8' }).stdout;
}

function snapshot() {
  return [
    git('rev-parse', 'HEAD'),
    git('status', '--porcelain', '--untracked-files=all'),
    git('diff'),
    git('diff', '--cached'),
  ].join('\n--\n');
}

function refuses(script, argv, stdin, error) {
  const before = snapshot();
  const result = runNodeScript(path.join(SCRIPTS_DIR, script), argv, stdin, env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { ok: false, error });
  assert.equal(snapshot(), before, 'nothing was written');
}

describe('Foreman CLIs refuse a flag they do not take', () => {
  test('safe-commit.js finish refuses a mistyped --no-commit instead of committing', () => {
    const head = git('rev-parse', 'HEAD').trim();
    refuses(
      'safe-commit.js',
      ['finish', '--baseline', head, '--no-comit'],
      { id: '001', expected: ['src'], message_title: 'Change a' },
      'unknown flag for safe-commit.js finish: --no-comit. Valid flags: --baseline, --no-commit, --allow-unexpected'
    );
  });

  test('safe-commit.js begin takes no flags', () => {
    refuses('safe-commit.js', ['begin', '--force'], null, 'unknown flag for safe-commit.js begin: --force. safe-commit.js begin takes no flags');
  });

  test('trial-log.js refuses a flag or an extra argument', () => {
    refuses(
      'trial-log.js',
      ['question_asked', '{"flow":"pick"}', '--quiet'],
      null,
      "unexpected argument for trial-log.js: --quiet. It takes <event> ['<json fields>'] and no flags but --help"
    );
    refuses(
      'trial-log.js',
      ['--quiet'],
      null,
      "unexpected argument for trial-log.js: --quiet. It takes <event> ['<json fields>'] and no flags but --help"
    );
  });

  test('resolve-symbols.js names its three flags', () => {
    refuses(
      'resolve-symbols.js',
      ['--touches', 'src/a.js', '--touch', 'src/b.js'],
      null,
      'unknown flag for resolve-symbols.js: --touch. Valid flags: --touches, --what, --verify'
    );
  });

  test('craft-handoff.js takes no flags', () => {
    refuses('craft-handoff.js', ['--host', 'codex'], {}, 'unknown flag for craft-handoff.js: --host. craft-handoff.js takes no flags');
  });

  test('render-sections.js takes no flags', () => {
    refuses('render-sections.js', ['--omit'], null, 'unknown flag for render-sections.js: --omit. render-sections.js takes no flags');
  });

  for (const script of ['roadmap-health.js', 'attention-cost.js']) {
    test(`health/${script} names its four flags`, () => {
      refuses(
        `health/${script}`,
        ['--roadmap', path.join(project, 'ROADMAP.jsonl'), '--trial', 'log.jsonl'],
        null,
        `unknown flag for ${script}: --trial. Valid flags: --roadmap, --archive, --date, --trial-log`
      );
    });
  }

  // [Foreman: 735] parseFlags kept the last of a repeated value flag, so
  // `--baseline a --baseline b` compared against b alone.
  test('every CLI with a value flag refuses it twice', () => {
    const head = git('rev-parse', 'HEAD').trim();
    const fix = (name, flag) => `repeated flag for ${name}: --${flag}. Give --${flag} once; join several values with commas in that one value`;
    refuses(
      'safe-commit.js',
      ['finish', '--baseline', head, '--baseline=' + head],
      { id: '001', expected: ['src'], message_title: 'Change a' },
      fix('safe-commit.js finish', 'baseline')
    );
    refuses('resolve-symbols.js', ['--touches', 'src/a.js', '--touches', 'src/b.js'], null, fix('resolve-symbols.js', 'touches'));
    const roadmap = path.join(project, 'ROADMAP.jsonl');
    for (const script of ['roadmap-health.js', 'attention-cost.js']) {
      refuses(`health/${script}`, ['--roadmap', roadmap, '--date', '2026-01-01', '--date=2026-01-02'], null, fix(script, 'date'));
    }
  });

  test('build-windows-launchers.js refuses a mistyped --write and rewrites nothing', () => {
    const hooks = path.join(__dirname, '..', 'hooks', 'codex-hooks.json');
    const before = fs.readFileSync(hooks, 'utf-8');
    const result = runNodeScript(path.join(SCRIPTS_DIR, 'build-windows-launchers.js'), ['--wirte'], null, env);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /unknown flag for build-windows-launchers\.js: --wirte\. Valid flags: --write/);
    assert.equal(fs.readFileSync(hooks, 'utf-8'), before);
  });
});
