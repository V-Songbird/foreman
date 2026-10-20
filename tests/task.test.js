'use strict';

// [Foreman: 1078] scripts/task.js: a handoff's entry bookkeeping, every host,
// as `start` and `finish`, each returning a `next` code. These pin the codes,
// each close form (the staged close, a git-ignored roadmap, an investigation;
// tests/submodule_close.test.js pins the submodule one), the acceptance step
// and its options, the refusals, and that finish never stages into a tree
// that held someone else's changes.

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { makeTmpProject, writeRoadmap, writeArchiveFile, writeConfig, initGitRepo, runNodeScript, runBash, unlessTimedOut, SPAWN_TIMEOUT_MS, SCRIPTS_DIR } = require('./helpers.js');
const { withTrailer, plannedSubmodule } = require(path.join(SCRIPTS_DIR, 'task.js'));
const { claudeEntryParagraphText, codexEntryParagraphText } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));

const TASK = path.join(SCRIPTS_DIR, 'task.js');

let project;
let env;

beforeEach(() => {
  project = makeTmpProject();
  env = { FOREMAN_PROJECT_DIR: project };
});

afterEach(() => {
  fs.rmSync(path.dirname(project), { recursive: true, force: true });
});

function git(...args) {
  const r = spawnSync('git', args, { cwd: project, encoding: 'utf-8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function write(rel, content) {
  const full = path.join(project, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function entry(overrides = {}) {
  return {
    id: '001',
    title: 'Change a',
    why: 'w',
    what: 'x',
    status: 'planned',
    source: 'user',
    depends_on: [],
    planned_touches: ['src/a.js'],
    observed_touches: [],
    commits: [],
    created_at: '2026-10-01',
    updated_at: '2026-10-01',
    notes: '',
    ...overrides,
  };
}

/** A git project with src/a.js and a tracked roadmap, all committed. */
function repo({ ignoreRoadmap = false, config = null, fields = {} } = {}) {
  initGitRepo(project);
  write('src/a.js', 'one\n');
  write('.gitignore', ignoreRoadmap ? 'ROADMAP.jsonl\n' : '');
  writeRoadmap(project, [entry(fields)]);
  if (config) writeConfig(project, config);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
}

function task(argv, payload) {
  const r = runNodeScript(TASK, argv, payload, env);
  const json = JSON.parse(r.stdout);
  return { status: r.status, json };
}

function ok(argv, payload) {
  const { status, json } = task(argv, payload);
  assert.equal(status, 0, JSON.stringify(json));
  assert.equal(json.ok, true, JSON.stringify(json));
  return json;
}

/** Run a returned `then` command without a shell: `node '<script>' <args>`. */
function runThen(then, payload) {
  const m = /^node '([^']+)' (.+)$/.exec(then);
  assert.ok(m, `unexpected command shape: ${then}`);
  const r = runNodeScript(m[1], m[2].split(' '), payload, env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
}

const stored = () => JSON.parse(fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8').split('\n')[1]);
const head = () => git('rev-parse', 'HEAD').trim();
const stagedNames = () => git('diff', '--cached', '--name-only').split('\n').filter(Boolean);

describe('task.js start', () => {
  test('opens a planned entry and takes the boundary', () => {
    repo();
    const result = ok(['start', '--id', '001']);
    assert.equal(result.next, 'work');
    assert.equal(result.baseline, head());
    assert.match(result.then, new RegExp(`^node '[^']+/scripts/task\\.js' finish --id 001 --baseline ${head()}$`));
    assert.equal(stored().status, 'in_progress');
  });

  test('leaves an in_progress entry as it is and carries the flags into then', () => {
    repo({ fields: { status: 'in_progress', updated_at: '2026-10-02' } });
    const result = ok(['start', '--id', '001', '--agent', '--orchestrator', 'orch 1']);
    assert.equal(stored().updated_at, '2026-10-02', 'no second in_progress write');
    assert.match(result.then, / --agent --orchestrator 'orch 1'$/);
  });

  test('an investigation takes no boundary', () => {
    repo();
    write('src/a.js', 'dirty\n');
    const result = ok(['start', '--id', '001', '--investigation']);
    assert.deepEqual(Object.keys(result).sort(), ['next', 'ok', 'then']);
    assert.equal(result.next, 'work');
    assert.match(result.then, /finish --id 001 --investigation$/);
  });

  test('refuses an entry with nothing to start and a missing id', () => {
    repo({ fields: { status: 'done' } });
    assert.match(task(['start', '--id', '001']).json.error, /entry 001 is done, so there is nothing to start/);
    assert.match(task(['start']).json.error, /needs --id <entry id>/);
    assert.match(task(['start', '--id', '001', '--baseline', 'x']).json.error, /unknown flag for task\.js start: --baseline/);
  });

  // [Foreman: 1112] Only a tree that holds changes is blamed on someone else.
  test('outside git, start says git could not read the project', () => {
    writeRoadmap(project, [entry()]);
    const start = ok(['start', '--id', '001']);
    assert.equal(start.next, 'report_dirty');
    assert.ok(['git_status_unavailable', 'not_a_git_worktree'].includes(start.reason), start.reason);
    assert.match(start.say, /^(Git could not read the project's status|The project is not a git work tree), so this run stages and commits nothing/);
    assert.doesNotMatch(start.say, /not this task's/);
  });
});

describe('task.js finish', () => {
  test('the staged close commits the task files and the roadmap with the trailer last, then asks for acceptance', () => {
    repo();
    const start = ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    const result = runThen(start.then, {
      status: 'done',
      files: ['src/a.js'],
      message: 'Change a\n\nCo-Authored-By: Someone <someone@example.com>',
      notes: 'changed a',
      model: 'opus',
    });
    assert.equal(result.next, 'ask_acceptance');
    assert.equal(result.status, 'awaiting_acceptance');
    assert.equal(result.commit, head());
    assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean).sort(), ['ROADMAP.jsonl', 'src/a.js']);
    assert.equal(git('log', '-1', '--format=%B').trim(), 'Change a\n\nCo-Authored-By: Someone <someone@example.com>\nForeman: 001');
    assert.equal(git('status', '--porcelain'), '', 'nothing left behind');
    assert.equal(stored().status, 'awaiting_acceptance');
    assert.equal(stored().model, 'opus');
    assert.deepEqual(result.options.map((o) => o.label), ['Accept (Recommended)', 'Review it first']);
    assert.ok(!result.unverified);
    // The Accept option's command closes the entry as done.
    runThen(result.options[0].then.replace(/^echo '([^']+)' \| /, ''), JSON.parse(/^echo '([^']+)'/.exec(result.options[0].then)[1]));
    assert.equal(stored().status, 'done');
  });

  test('a listed unverified check is annotated once and offers Test first', () => {
    repo();
    const start = ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a', unverified: ['the banner renders'] });
    assert.deepEqual(result.options.map((o) => o.label), ['Test it first (Recommended)', 'Accept', 'Review it first']);
    assert.deepEqual(result.unverified, ['the banner renders']);
    assert.equal(stored().notes.split('unverified: the banner renders').length, 2);
    assert.equal(git('log', '-1', '--format=%B').trim(), 'Change a\n\nForeman: 001');
  });

  test('without requireVerification a done close is closed', () => {
    repo({ config: { requireVerification: false } });
    const start = ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(result.next, 'closed');
    assert.equal(stored().status, 'done');
  });

  test('an agent or an orchestrator reports instead of asking', () => {
    repo();
    const agent = ok(['start', '--id', '001', '--agent']);
    write('src/a.js', 'two\n');
    const reported = runThen(agent.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(reported.next, 'report_acceptance');
    assert.match(reported.say, /entry 001 now needs the user's accept or decline/);

    fs.rmSync(path.join(project, '.git'), { recursive: true, force: true });
    repo({ config: { requireVerification: false } });
    const orchestrated = ok(['start', '--id', '001', '--orchestrator', 'orch-1']);
    write('src/a.js', 'three\n');
    const delegated = runThen(orchestrated.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(delegated.next, 'report_acceptance', 'the orchestrator holds even with requireVerification off');
    assert.match(delegated.say, /belongs to the orchestrator orch-1, so don't ask the user/);
  });

  // [Foreman: 1078] The close-protocol review found the old paragraph closed
  // with staged:true after a dirty begin, staging ROADMAP.jsonl into the
  // user's own pending index.
  test('a tree dirty at start: nothing is staged into the user\'s index and nothing is committed', () => {
    repo();
    write('notes.txt', 'mine\n');
    git('add', 'notes.txt');
    write('src/b.js', 'also mine\n');
    const before = head();
    const start = ok(['start', '--id', '001']);
    assert.equal(start.next, 'report_dirty');
    // [Foreman: 1118] One label for the tree, as the other causes use.
    assert.match(start.say, /^The project already holds changes that are not this task's, so/);
    assert.ok(!('baseline' in start));
    assert.doesNotMatch(start.then, /--baseline/);
    write('src/a.js', 'two\n');
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a', notes: 'changed a' });
    assert.equal(result.next, 'report_dirty');
    assert.equal(result.reason, 'no_baseline');
    assert.equal(result.after.next, 'ask_acceptance');
    assert.equal(head(), before, 'no commit');
    assert.deepEqual(stagedNames(), ['notes.txt'], 'the index holds only what the user staged');
    assert.equal(stored().status, 'awaiting_acceptance');
    assert.deepEqual(stored().observed_touches, ['src/a.js']);
  });

  test('changes staged after a clean start are someone else\'s, so nothing is staged', () => {
    repo();
    const start = ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    write('notes.txt', 'mine\n');
    git('add', 'notes.txt');
    const before = head();
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(result.next, 'report_dirty');
    assert.equal(result.reason, 'index_has_other_changes');
    assert.deepEqual(result.staged_files, ['notes.txt']);
    assert.equal(head(), before);
    assert.deepEqual(stagedNames(), ['notes.txt']);
  });

  test('a commit since start closes unstaged with its own reason, not as foreign changes', () => {
    repo();
    const start = ok(['start', '--id', '001']);
    write('notes.txt', 'theirs\n');
    git('add', 'notes.txt');
    git('commit', '-q', '-m', 'someone else');
    write('src/a.js', 'two\n');
    const before = head();
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(result.next, 'report_dirty');
    assert.equal(result.reason, 'head_moved_since_baseline');
    assert.equal(result.baseline, start.baseline);
    assert.equal(result.head, before);
    assert.match(result.say, /^Something was committed since this task started/);
    assert.doesNotMatch(result.say, /not this task's/);
    assert.equal(result.after.next, 'ask_acceptance');
    assert.equal(head(), before, 'no commit');
    assert.deepEqual(stagedNames(), []);
    assert.equal(stored().status, 'awaiting_acceptance');
    assert.deepEqual(stored().observed_touches, ['src/a.js']);
  });

  // [Foreman: 1078] The checkpoint embed's order: the second start comes
  // right after task 1's checkpoint commit, before task 2 touches a file.
  test('a two-task run takes the second boundary before the last task\'s edits', () => {
    repo({ fields: { planned_touches: ['src/a.js', 'src/b.js'] } });
    ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    git('add', '--', 'src/a.js');
    git('commit', '-q', '-m', 'task 1/2: change a');
    const second = ok(['start', '--id', '001']);
    assert.equal(second.next, 'work');
    assert.equal(second.baseline, head());
    write('src/b.js', 'two\n');
    const result = runThen(second.then, { status: 'done', files: ['src/b.js'], message: 'Change b' });
    assert.equal(result.next, 'ask_acceptance');
    assert.equal(result.commit, head());
    assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean).sort(), ['ROADMAP.jsonl', 'src/b.js']);
    assert.match(git('log', '-1', '--format=%B'), /\nForeman: 001\n*$/);
  });

  test('a changed file outside files is refused before anything is staged or closed', () => {
    repo();
    const start = ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    write('src/c.js', 'stray\n');
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(result.next, 'refused');
    assert.equal(result.reason, 'unexpected_files');
    assert.deepEqual(result.unexpected_files, ['src/c.js']);
    assert.match(result.then, / --allow-unexpected$/);
    assert.deepEqual(stagedNames(), []);
    assert.equal(stored().status, 'in_progress');
  });

  test('a git-ignored roadmap commits the task files first and records the sha', () => {
    repo({ ignoreRoadmap: true });
    const start = ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(result.next, 'ask_acceptance');
    assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean), ['src/a.js']);
    assert.deepEqual(stored().commits, [head()]);
    assert.match(git('log', '-1', '--format=%B'), /\n\nForeman: 001\n*$/);
  });

  test('an investigation closes with its notes and commits nothing', () => {
    repo();
    const start = ok(['start', '--id', '001', '--investigation']);
    const before = head();
    const result = runThen(start.then, { status: 'done', notes: 'the cause is x', files: ['ignored.js'] });
    assert.equal(result.next, 'ask_acceptance');
    assert.equal(head(), before);
    assert.match(stored().notes, /the cause is x/);
  });

  // [Foreman: 1112] finish staged without roadmap_close, so bookkeeping the
  // index already held read as unexpected_files and the whole index was reset.
  test('bookkeeping already in the index rides in the staged close', () => {
    repo();
    const start = ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    writeArchiveFile(project, []);
    git('add', 'ROADMAP.jsonl', '.foreman/archive.jsonl');
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(result.next, 'ask_acceptance', JSON.stringify(result));
    assert.equal(result.commit, head());
    assert.ok(!result.warnings, JSON.stringify(result.warnings));
    assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean).sort(), ['.foreman/archive.jsonl', 'ROADMAP.jsonl', 'src/a.js']);
  });

  test('listed files that did not change are still refused at the root', () => {
    repo();
    const start = ok(['start', '--id', '001']);
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(result.next, 'refused');
    assert.equal(result.reason, 'no_task_changes');
    assert.equal(stored().status, 'in_progress');
  });

  // [Foreman: 1112] commit_failed was missing from trial-log's vocabulary, so
  // the event was dropped, and the recorded close came back without after.
  test('a commit refused after the close is recorded is logged and still leads to acceptance', () => {
    repo({ config: { trialLog: true } });
    const hooks = path.join(path.dirname(project), 'hooks');
    fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho refused >&2\nexit 1\n', { mode: 0o755 });
    git('config', 'core.hooksPath', hooks);
    const start = ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(result.next, 'refused');
    assert.equal(result.reason, 'commit_failed');
    assert.equal(result.closed, true);
    assert.equal(result.after?.next, 'ask_acceptance', JSON.stringify(result));
    const events = fs.readFileSync(path.join(project, '.foreman', 'trial-log.jsonl'), 'utf-8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(events.some((e) => e.event === 'commit_interrupted' && e.reason_class === 'commit_failed'), JSON.stringify(events));
  });

  // [Foreman: 1112] Without a baseline, finish knows only that start took no
  // boundary, not that someone else's changes were there.
  test('a hand-run finish without --baseline names the missing boundary, not foreign changes', () => {
    repo();
    ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    const result = ok(['finish', '--id', '001'], { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(result.next, 'report_dirty');
    assert.equal(result.reason, 'no_baseline');
    assert.match(result.say, /no --baseline from start/);
    assert.doesNotMatch(result.say, /changes that are not this task's/);
  });

  test('refuses a bad status, files without a message and an entry that is not open', () => {
    repo();
    ok(['start', '--id', '001']);
    assert.match(task(['finish', '--id', '001'], { status: 'awaiting_acceptance' }).json.error, /`status` must be one of done\|dropped\|rejected/);
    assert.match(task(['finish', '--id', '001'], { status: 'done', files: ['src/a.js'] }).json.error, /`message` is required with `files`/);
    fs.rmSync(path.join(project, '.git'), { recursive: true, force: true });
    repo();
    assert.match(task(['finish', '--id', '001'], { status: 'done' }).json.error, /entry 001 is planned, not in_progress/);
  });
});

describe('the trailer and the submodule answer', () => {
  test('the trailer joins a trailer block and starts its own otherwise', () => {
    assert.equal(withTrailer('Subject', '001'), 'Subject\n\nForeman: 001');
    assert.equal(withTrailer('Subject\n\nBody text.\n', '001'), 'Subject\n\nBody text.\n\nForeman: 001');
    assert.equal(withTrailer('Subject\n\nCo-Authored-By: A <a@b.c>', '001'), 'Subject\n\nCo-Authored-By: A <a@b.c>\nForeman: 001');
    assert.equal(withTrailer('Subject\n\nForeman: 001\n', '001'), 'Subject\n\nForeman: 001');
  });

  test('only a surface wholly inside one submodule names it', () => {
    write('.gitmodules', '[submodule "lib"]\n\tpath = lib\n\turl = ./lib\n');
    assert.equal(plannedSubmodule(project, ['lib/a.js', 'lib/b']), 'lib');
    assert.equal(plannedSubmodule(project, ['README.md', 'lib/a.js']), null);
    assert.equal(plannedSubmodule(project, []), null);
  });
});

// [Foreman: 1139] An install path and an orchestrator name holding a single
// quote and a dollar sign: start's `then` runs as written under bash and
// under PowerShell on Windows, or sh elsewhere, whichever host wrote it.
describe('then runs from an install path holding a quote and a dollar', () => {
  const windows = process.platform === 'win32';
  const shells = {
    bash: (command, hostEnv) => runBash(command, hostEnv),
    [windows ? 'PowerShell' : 'sh']: (command, hostEnv) => unlessTimedOut(spawnSync(windows ? 'powershell.exe' : 'sh', windows
      ? ['-NoProfile', '-NonInteractive', '-Command', command]
      : ['-c', command], { encoding: 'utf-8', windowsHide: true, timeout: SPAWN_TIMEOUT_MS, env: { ...process.env, ...hostEnv } }), 'the then command'),
  };
  for (const host of ['claude', 'codex']) for (const [name, shell] of Object.entries(shells)) {
    test(`from ${host} under ${name}`, (t) => {
      repo();
      const plugin = path.join(path.dirname(project), "it's $x plugin");
      fs.cpSync(SCRIPTS_DIR, path.join(plugin, 'scripts'), { recursive: true });
      fs.copyFileSync(path.join(SCRIPTS_DIR, '..', 'prompt-template.md'), path.join(plugin, 'prompt-template.md'));
      const hostEnv = { ...env, FOREMAN_HOST: host };
      const started = runNodeScript(path.join(plugin, 'scripts', 'task.js'), ['start', '--id', '001', '--orchestrator', "o'$x"], null, hostEnv);
      assert.equal(started.status, 0, started.stdout + started.stderr);
      const { then } = JSON.parse(started.stdout);
      const payload = path.join(project, 'payload.json').replaceAll('\\', '/');
      fs.writeFileSync(payload, JSON.stringify({ status: 'dropped' }), 'utf-8');
      const pipe = name === 'PowerShell' ? `Get-Content -LiteralPath '${payload}' -Raw -Encoding utf8` : `cat '${payload}'`;
      const r = shell(`${pipe} | ${then}`, hostEnv);
      if (r === null) return t.skip('no bash found');
      assert.equal(r.status, 0, then + '\n' + r.stdout + r.stderr);
      assert.equal(JSON.parse(r.stdout).next, 'closed', r.stdout);
      assert.equal(stored().status, 'dropped');
    });
  }
});

// The paragraph's commands run as written: its start call, then its close JSON
// piped into the `then` start returned.
describe('the Claude Code entry paragraph drives task.js', () => {
  test('its start command and close payload run end to end', () => {
    repo();
    const paragraph = claudeEntryParagraphText({ id: '001', resume: false, requireVerification: true, destination: 'task', investigation: false });
    const start = /`node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/task\.js (start [^`]+)`/.exec(paragraph);
    assert.ok(start, paragraph);
    const opened = ok(start[1].split(' '));
    // [Foreman: 1112] A quoted heredoc: in a single-quoted echo an apostrophe
    // in the message or notes ended the quoting.
    assert.doesNotMatch(paragraph, /echo '\{/);
    const payload = JSON.parse(/\n<start's then> <<'EOF'\n(\{.+\})\nEOF$/m.exec(paragraph)[1]);
    assert.deepEqual(Object.keys(payload), ['status', 'files', 'message', 'notes', 'unverified']);
    write('src/a.js', 'two\n');
    const closed = runThen(opened.then, { ...payload, status: 'done', files: ['src/a.js'], message: 'Change a', notes: 'done' });
    assert.equal(closed.next, 'ask_acceptance');
    assert.match(paragraph, /- `ask_acceptance`:/);
    for (const code of ['closed', 'report_dirty', 'refused']) assert.match(paragraph, new RegExp(`- \`${code}\`:`));
    assert.doesNotMatch(paragraph, /report_acceptance|safe-commit|"staged"/);
  });
});

// [Foreman: 1120] The reference pages describe task.js as it runs on every
// host. A rename of a task.js reason or a trial-log reason class, or a page
// that drifts back to the old Codex close, fails here.
describe('the reference pages describe task.js on every host', () => {
  const ROOT = path.join(SCRIPTS_DIR, '..');
  const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf-8').replace(/\r\n/g, '\n');
  const flat = (text) => text.replace(/\s+/g, ' ');
  const row = (text, step) => text.split('\n').find((line) => line.startsWith(`| ${step} |`)) || '';

  test('HOW-IT-WORKS.md opens and finishes a task through task.js on all three hosts', () => {
    const page = read('HOW-IT-WORKS.md');
    const [, claude, codex, antigravity] = row(page, 'Opening a task').split(' | ');
    assert.match(claude, /`TaskCreated` hook marks the entry in progress.*`scripts\/task\.js start` opens the entry on every other destination and, outside an investigation, takes the commit boundary/);
    assert.match(codex, /`hooks\/codex-task\.js start`.*outside an investigation, `scripts\/task\.js start` then takes the commit boundary/);
    assert.match(antigravity, /The same two starts/);
    const [, claudeEnd, codexEnd, antigravityEnd] = row(page, 'Finishing a task').split(' | ');
    for (const cell of [claudeEnd, codexEnd]) assert.match(cell, /`scripts\/task\.js finish` stages the task's files, closes the entry and commits once/);
    assert.match(codexEnd, /an investigation closes with `roadmap\.js update-status`.*`hooks\/codex-task\.js check` reports what is still open/);
    assert.match(antigravityEnd, /The same close and `hooks\/codex-task\.js check`; there is no stop reminder/);
  });

  test('CODEX.md names task.js beside the TaskCreated hook and codex-task.js', () => {
    const page = read('CODEX.md');
    assert.match(row(page, 'Opening a task'), /`TaskCreated` hook, or the prompt's `scripts\/task\.js start` where no task is created; that start runs either way and takes the commit boundary \| `hooks\/codex-task\.js start` with readiness and status guards, then `scripts\/task\.js start` for the commit boundary/);
    assert.match(row(page, 'Closing a task'), /`scripts\/task\.js finish` stages the task's files, closes the entry and commits once \| The same `scripts\/task\.js finish`, then `hooks\/codex-task\.js check`/);
    assert.ok(flat(page).includes('Between those two calls, an entry handoff takes the commit boundary with `scripts/task.js start --id 001` and closes the entry with `scripts/task.js finish --id 001 --baseline <baseline>`'));
  });

  test('the runtimes run the entry paragraph through task.js on every host', () => {
    const shared = flat(read('skills', 'foreman', 'runtime.md'));
    // [Foreman: 1141] Two paragraphs never call task.js: a Codex or Antigravity
    // investigation and a Codex or Antigravity delegated subagent's, as
    // craft-handoff.js writes them; a Claude Code background Agent still calls it.
    assert.ok(shared.includes("On every host, a handoff's entry paragraph runs that boundary through `scripts/task.js`, except two paragraphs that never call it: a Codex or Antigravity investigation, which takes no boundary and closes with `roadmap.js update-status`, and a Codex or Antigravity delegated subagent's, whose coordinator owns the start, the close and the check and closes with `update-status`. A Claude Code background Agent's paragraph does call it. Where the paragraph does call it, `start` takes the boundary, except for an investigation; in Claude Code it also opens the entry, which `hooks/codex-task.js start` opens first in Codex and Antigravity."), shared);
    assert.ok(shared.includes('A `report_dirty` answer from `start` means it took no boundary and the close will stage and commit nothing; from `finish`, it means nothing was staged or committed.'));
    assert.ok(shared.includes('When no entry paragraph supplies `task.js finish`, a staged close by hand runs `finish --no-commit`'));
    assert.doesNotMatch(read('skills', 'foreman', 'runtime.md'), /that trailer\. Record\n/);
    const codex = flat(read('skills', 'foreman', 'runtime-codex.md'));
    assert.ok(codex.includes("Then take the commit boundary with the entry paragraph's `scripts/task.js start` and close the entry with its `scripts/task.js finish`"), codex);
    assert.ok(codex.includes("the entry paragraph's `scripts/task.js start` and `finish` around the work"), 'Antigravity too');
    const delivery = flat(read('skills', 'roadmap', 'delivery.md'));
    assert.ok(delivery.includes('start leaves that status as it is and, outside an investigation, still takes the commit boundary.'));
    assert.ok(delivery.includes("Outside an investigation, then take the commit boundary and close with the entry paragraph's `scripts/task.js start` and `finish`. Verify the result, and record its outcome and evidence before reporting completion."));
    const split = flat(read('skills', 'roadmap', 'delivery-split.md'));
    assert.ok(split.includes("and no other (its `task.js finish` picks the form: the staged close at the project root"), split);
  });

  // [Foreman: 1141] The entry paragraphs craft-handoff.js writes for Codex: an
  // investigation and a delegated subagent never call task.js, and the pages
  // that name the close say so.
  test('the Codex investigation and subagent paragraphs call no task.js, and the pages agree', () => {
    for (const options of [{ investigation: true, destination: 'task' }, { investigation: false, destination: 'agent', reviewEachIncrement: true }]) {
      const paragraph = codexEntryParagraphText({ id: '001', resume: false, requireVerification: true, ...options });
      assert.doesNotMatch(paragraph, /scripts\/task\.js/, JSON.stringify(options));
      assert.match(paragraph, /roadmap\.js'? update-status/);
    }
    const codex = flat(read('CODEX.md'));
    assert.ok(codex.includes('An investigation skips both and closes with `roadmap.js update-status`. A delegated subagent runs neither: its coordinator owns the start, the close and the check, and closes with `roadmap.js update-status`.'), codex);
    assert.ok(codex.includes('a delegated Codex subagent runs no `task.js` call, because its coordinator closes with `roadmap.js update-status` |'));
    const protocol = flat(read('skills', 'roadmap', 'close-increments.md'));
    assert.ok(protocol.includes('An investigation and a Codex subagent\'s coordinator close with `roadmap.js update-status` instead.'), protocol);
  });

  test('a reviewed close runs task.js finish, not a staged close by hand', () => {
    const protocol = flat(read('skills', 'roadmap', 'close-increments.md'));
    assert.ok(protocol.includes("Close with the entry paragraph's close command. Outside an investigation or a coordinator-owned close, that is `task.js finish`"), protocol);
    assert.ok(protocol.includes('Never stage or record that close by hand, which skips its guards.'));
    assert.doesNotMatch(protocol, /staged-close protocol/);
  });

  test("the template's report_dirty reasons are the ones task.js finish returns", () => {
    const template = read('prompt-template.md');
    const bullet = flat(template.slice(template.indexOf("- **A close never stages into someone else's changes.**"), template.indexOf('<!-- [Foreman: 410] -->')));
    const source = read('scripts', 'task.js');
    for (const reason of ['no_baseline', 'index_has_other_changes', 'head_moved_since_baseline', 'git_status_unavailable']) {
      assert.ok(bullet.includes(`\`${reason}\``), `the template lists ${reason}`);
      assert.ok(source.includes(`"${reason}"`), `task.js returns ${reason}`);
    }
    assert.ok(bullet.includes('`task.js finish` records the close without touching the index and commits nothing, and returns `report_dirty`'));
  });

  test("TRIALS.md lists exactly trial-log.js's reason classes, commit_failed included", () => {
    const { REASON_CLASSES } = require(path.join(SCRIPTS_DIR, 'trial-log.js'));
    const trials = read('TRIALS.md');
    const start = trials.indexOf('`reason_class` is one of the refusal names');
    const paragraph = trials.slice(start + '`reason_class`'.length, trials.indexOf('Names only', start));
    const listed = [...paragraph.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(listed)].sort(), [...REASON_CLASSES].sort());
    assert.ok(flat(paragraph).includes('`commit_failed` (`scripts/task.js finish` when `git commit` itself fails, as when a pre-commit hook refuses)'));
    assert.ok(flat(trials).includes('plus `scripts/task.js finish` when `git commit` itself fails (`commit_failed`)'));
    assert.ok(read('scripts', 'trial-log.js').includes("plus scripts/task.js\n// finish's commit_failed"));
  });

  // [Foreman: 1141] The commit_interrupted bullet names every refusal
  // safe-commit.js returns, and says which of them are ok:false.
  test('TRIALS.md commit_interrupted lists the safe-commit refusals, begin\'s dirty as ok:true', () => {
    const { REASON_CLASSES } = require(path.join(SCRIPTS_DIR, 'trial-log.js'));
    const trials = read('TRIALS.md');
    const start = trials.indexOf('- **`commit_interrupted`**');
    const bullet = flat(trials.slice(start, trials.indexOf('- **`recovery_attempted`, `reinit-snapshot`**', start)));
    const safeCommit = REASON_CLASSES.filter((reason) => !['dirty_tree', 'commit_failed', 'verification_declined'].includes(reason));
    for (const reason of safeCommit) assert.ok(bullet.includes(`\`${reason}\``), `commit_interrupted lists ${reason}`);
    assert.ok(bullet.includes('`begin` reporting `dirty: true`, which is an `ok:true` answer'), bullet);
    assert.doesNotMatch(bullet, /every `ok:false` return/);
  });

  test('roadmap-schema.md says which finish stages which close bookkeeping', () => {
    const schema = flat(read('roadmap-schema.md'));
    assert.ok(schema.includes('Of those two files, `safe-commit.js finish` with `roadmap_close` stages only `ROADMAP.jsonl`; the archive enters the commit when `update-status` with `staged:true` stages it, or when it already sat in the index.'), schema);
    assert.doesNotMatch(schema, /`finish` itself stages only/);
  });

  test('task.js says it serves every host', () => {
    const { USAGE } = require(TASK);
    assert.match(USAGE, /^task\.js -- a handoff's entry bookkeeping, on every host\./);
    assert.match(flat(USAGE), /and, without --investigation, takes the commit boundary/);
    assert.doesNotMatch(read('scripts', 'task.js'), /Claude Code handoff's entry bookkeeping|spelled-\n\/\/ out steps/);
  });
});
