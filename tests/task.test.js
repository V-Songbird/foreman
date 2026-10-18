'use strict';

// [Foreman: 1078] scripts/task.js: a Claude Code handoff's entry bookkeeping
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

const { makeTmpProject, writeRoadmap, writeConfig, initGitRepo, runNodeScript, SCRIPTS_DIR } = require('./helpers.js');
const { withTrailer, plannedSubmodule } = require(path.join(SCRIPTS_DIR, 'task.js'));
const { claudeEntryParagraphText } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));

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
    assert.ok(!('baseline' in start));
    assert.doesNotMatch(start.then, /--baseline/);
    write('src/a.js', 'two\n');
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a', notes: 'changed a' });
    assert.equal(result.next, 'report_dirty');
    assert.equal(result.reason, 'dirty_at_start');
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

// The paragraph's commands run as written: its start call, then its close JSON
// piped into the `then` start returned.
describe('the Claude Code entry paragraph drives task.js', () => {
  test('its start command and close payload run end to end', () => {
    repo();
    const paragraph = claudeEntryParagraphText({ id: '001', resume: false, requireVerification: true, destination: 'task', investigation: false });
    const start = /`node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/task\.js (start [^`]+)`/.exec(paragraph);
    assert.ok(start, paragraph);
    const opened = ok(start[1].split(' '));
    const payload = JSON.parse(/`echo '(\{[^']+\})' \| <start's then>`/.exec(paragraph)[1]);
    assert.deepEqual(Object.keys(payload), ['status', 'files', 'message', 'notes', 'unverified']);
    write('src/a.js', 'two\n');
    const closed = runThen(opened.then, { ...payload, status: 'done', files: ['src/a.js'], message: 'Change a', notes: 'done' });
    assert.equal(closed.next, 'ask_acceptance');
    assert.match(paragraph, /- `ask_acceptance`:/);
    for (const code of ['closed', 'report_dirty', 'refused']) assert.match(paragraph, new RegExp(`- \`${code}\`:`));
    assert.doesNotMatch(paragraph, /report_acceptance|safe-commit|"staged"/);
  });
});
