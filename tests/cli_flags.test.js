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
  // [Foreman: 780] Only a flag its command splits on commas suggests them.
  test('every CLI with a value flag refuses it twice', () => {
    const head = git('rev-parse', 'HEAD').trim();
    const fix = (name, flag) => `repeated flag for ${name}: --${flag}. Give --${flag} once.`;
    refuses(
      'safe-commit.js',
      ['finish', '--baseline', head, '--baseline=' + head],
      { id: '001', expected: ['src'], message_title: 'Change a' },
      fix('safe-commit.js finish', 'baseline')
    );
    refuses(
      'resolve-symbols.js',
      ['--touches', 'src/a.js', '--touches', 'src/b.js'],
      null,
      'repeated flag for resolve-symbols.js: --touches. Give --touches once; join several values with commas in that one value'
    );
    refuses('resolve-symbols.js', ['--touches', 'src/a.js', '--what', 'a', '--what=b'], null, fix('resolve-symbols.js', 'what'));
    const roadmap = path.join(project, 'ROADMAP.jsonl');
    for (const script of ['roadmap-health.js', 'attention-cost.js']) {
      refuses(`health/${script}`, ['--roadmap', roadmap, '--date', '2026-01-01', '--date=2026-01-02'], null, fix(script, 'date'));
    }
  });

  // [Foreman: 791] check-prompt.js kept the last of a repeated flag, took the
  // next flag as a value and named no valid flag in its unknown-argument error.
  test('check-prompt.js refuses a repeated, valueless or unknown flag', () => {
    const file = path.join(project, 'prompt.md');
    fs.writeFileSync(file, 'x\n');
    const valid = 'Valid flags: --destination, --host, --profile, --entry, --resume, --research, --workflow-stage';
    refuses('check-prompt.js', [file, '--destnation', 'task'], null, `unknown flag for check-prompt.js: --destnation. ${valid}`);
    refuses(
      'check-prompt.js',
      [file, '--destination', 'task', '--destination', 'agent'],
      null,
      'repeated flag for check-prompt.js: --destination. Give --destination once.'
    );
    refuses(
      'check-prompt.js',
      [file, '--destination', '--research'],
      null,
      'missing value for check-prompt.js: --destination. Give it as --destination <value> or --destination=<value>'
    );
    refuses(
      'check-prompt.js',
      [file, '--destination', 'task', '--entry'],
      null,
      'missing value for check-prompt.js: --entry. Give it as --entry <value> or --entry=<value>'
    );
    refuses(
      'check-prompt.js',
      [file, '--destination', 'task', '--resume=yes'],
      null,
      'unexpected value for check-prompt.js: --resume=yes. --resume is a switch and takes no value'
    );
  });

  // [Foreman: 792] A second prompt file was told about the flag before it
  // ("--destination takes one value") or to put a value after its flag.
  test('check-prompt.js names a second prompt file as one', () => {
    const file = path.join(project, 'prompt.md');
    fs.writeFileSync(file, 'x\n');
    const valid = 'Valid flags: --destination, --host, --profile, --entry, --resume, --research, --workflow-stage';
    const second = `unexpected argument for check-prompt.js: other.md. check-prompt.js takes one <file> and ${file} is already given; quote a path that has spaces. ${valid}`;
    refuses('check-prompt.js', [file, '--destination', 'task', 'other.md'], null, second);
    refuses('check-prompt.js', [file, 'other.md', '--destination', 'task'], null, second);
  });

  // [Foreman: 790] A stray argument after a value flag names that flag, and
  // only a flag its command splits on commas suggests them.
  test('a stray argument after a value flag names the flag', () => {
    refuses(
      'resolve-symbols.js',
      ['--touches', 'src/a.js', 'src/b.js'],
      null,
      'unexpected argument for resolve-symbols.js: src/b.js. --touches takes one value: join several with commas and quote one that has spaces. Valid flags: --touches, --what, --verify'
    );
    refuses(
      'resolve-symbols.js',
      ['--touches', 'src/a.js', '--what', 'fix', 'the', 'bug'],
      null,
      'unexpected argument for resolve-symbols.js: the. --what takes one value: quote one that has spaces. Valid flags: --touches, --what, --verify'
    );
  });

  // [Foreman: 779] `--help` prints the CLI's usage and runs nothing, even
  // beside a bad flag: it failed as an unknown flag everywhere but roadmap.js
  // and the first argument of trial-log.js.
  test('every CLI answers --help with its usage and writes nothing', () => {
    const hooks = path.join(__dirname, '..', 'hooks', 'codex-hooks.json');
    const hooksBefore = fs.readFileSync(hooks, 'utf-8');
    const roadmap = path.join(project, 'ROADMAP.jsonl');
    const cases = [
      ['scripts/safe-commit.js', ['--help'], 'safe-commit.js -- the one task-owned commit path.'],
      ['scripts/safe-commit.js', ['begin', '--help'], 'safe-commit.js -- the one task-owned commit path.'],
      ['scripts/safe-commit.js', ['finish', '--no-comit', '--help'], 'safe-commit.js -- the one task-owned commit path.'],
      ['scripts/resolve-symbols.js', ['--touches', 'src/a.js', '--touch', 'x', '--help'], 'resolve-symbols.js -- craft-time symbol resolver.'],
      ['scripts/health/roadmap-health.js', ['--roadmap', roadmap, '--trial', 'x', '--help'], 'usage: roadmap-health.js --roadmap <ROADMAP.jsonl>'],
      ['scripts/health/attention-cost.js', ['--help'], 'usage: attention-cost.js --roadmap <ROADMAP.jsonl>'],
      ['hooks/codex-task.js', ['start', '--id', '001', '--help'], 'usage: codex-task.js start|check --id ID'],
      ['hooks/codex-task.js', ['--help'], 'usage: codex-task.js start|check --id ID'],
      ['scripts/craft-handoff.js', ['--host', 'codex', '--help'], 'craft-handoff.js -- assembles a gate-checked handoff prompt'],
      ['scripts/render-sections.js', ['--help'], 'render-sections.js -- reads the project'],
      ['scripts/build-windows-launchers.js', ['--write', '--help'], 'build-windows-launchers.js [--write] -- checks'],
      ['scripts/trial-log.js', ['question_asked', '--help'], '{"ok":true,"usage":"trial-log.js <event>'],
      ['scripts/check-prompt.js', ['--destination', '--help'], 'check-prompt.js -- mechanical gate'],
      ['scripts/check-prompt.js', ['prompt.md', '--destnation', 'x', '--help'], 'check-prompt.js -- mechanical gate'],
      ['scripts/check-prompt.js', ['-h'], 'check-prompt.js -- mechanical gate'],
      ['scripts/check-prompt.js', ['--destination', 'task', '-h'], 'check-prompt.js -- mechanical gate'],
    ];
    for (const [script, argv, usage] of cases) {
      const before = snapshot();
      const result = runNodeScript(path.join(__dirname, '..', script), argv, { id: '001', expected: ['src'] }, env);
      assert.equal(result.status, 0, `${script} ${argv.join(' ')}: ${result.stdout}${result.stderr}`);
      assert.ok(result.stdout.startsWith(usage), `${script} ${argv.join(' ')} printed: ${result.stdout}`);
      assert.equal(snapshot(), before, `${script} ${argv.join(' ')} wrote nothing`);
    }
    assert.equal(fs.readFileSync(hooks, 'utf-8'), hooksBefore);
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
