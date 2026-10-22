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
const { withTrailer, plannedSubmodule, refusalFix, carriedFlags } =require(path.join(SCRIPTS_DIR, 'task.js'));
const { checkpointEmbedText, claudeEntryParagraphText, codexEntryParagraphText } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));

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

/** The lines of the fenced code block that ends `text`: a fence of three or more backticks on a line of its own opens it, and the same fence closes it. */
function fencedLines(text) {
  const m = /\n\n(`{3,})\n([^]*)\n\1$/.exec(text);
  return m ? m[2].split('\n') : [];
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

  // [Foreman: 1161] The commit helper's refusal fields reach the fix text.
  test('the fix text names the files still staged when the index could not be restored', () => {
    const left = { left_staged: ['src/a.js', 'src/b.js'], restore_error: 'index.lock exists' };
    for (const reason of ['unexpected_files', 'no_task_changes', 'staging_incomplete', 'staging_failed']) {
      const fix = refusalFix({ reason, error: 'git add failed', missing_files: ['src/b.js'], ...left });
      assert.match(fix, /index\.lock exists/, reason);
      assert.match(fix, /still staged: src\/a\.js, src\/b\.js/, reason);
      assert.doesNotMatch(fix, /Nothing was staged/, reason);
    }
    assert.match(refusalFix({ reason: 'unexpected_files' }), /Nothing was staged or closed\./);
    assert.doesNotMatch(refusalFix({ reason: 'staging_failed', error: 'x' }), /still staged/);
  });

  // [Foreman: 1168] The restore command names the left paths, so it does not
  // unstage anything else; a repository with no commit has no HEAD to restore
  // from, so the hint also gives `git rm --cached`.
  test('the fix text gives an unstage command limited to the files left staged', () => {
    const fix = refusalFix({ reason: 'staging_failed', error: 'x', left_staged: ['src/a.js', 'my file.js'], restore_error: 'e' });
    assert.match(fix, /with the first command below before anything else, or with the second when the repository has no commit yet:/);
    assert.deepEqual(fencedLines(fix), ["git --literal-pathspecs restore --staged -- src/a.js 'my file.js'", "git --literal-pathspecs rm --cached -- src/a.js 'my file.js'"], fix);
  });

  test('a refusal through finish names the left paths in its restore command', () => {
    repo();
    const start = ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    // Takes the index lock once `git add` returns, then fails the staged-file
    // listing, so the helper refuses with its staging in the index and cannot put it back.
    const shim = path.join(path.dirname(project), 'lock-after-add.js');
    fs.writeFileSync(shim, `
      const cp = require('child_process');
      const fs = require('fs');
      const path = require('path');
      const real = cp.execFileSync;
      let added = false;
      cp.execFileSync = function (file, args, options) {
        if (added && args[0] === 'diff' && args.includes('--cached')) throw new Error('listing failed');
        const out = real.apply(this, arguments);
        if (args[0] === 'add') { added = true; fs.writeFileSync(path.join(options.cwd, '.git', 'index.lock'), ''); }
        return out;
      };
    `);
    env = { ...env, NODE_OPTIONS: `--require ${JSON.stringify(shim)}` };
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(result.next, 'refused', JSON.stringify(result));
    assert.deepEqual(result.left_staged, ['ROADMAP.jsonl', 'src/a.js'], JSON.stringify(result));
    assert.equal(fencedLines(result.fix)[0], 'git --literal-pathspecs restore --staged -- ROADMAP.jsonl src/a.js', result.fix);
  });

  test('the fix text says "Tell the user" once and keys the staged note on restore_error', () => {
    const left = { left_staged: ['src/a.js'], restore_error: 'e' };
    for (const reason of ['unexpected_files', 'no_task_changes', 'staging_incomplete', 'staging_failed']) {
      const fix = refusalFix({ reason, error: 'x', ...left });
      assert.equal(fix.split('Tell the user').length - 1, 1, fix);
    }
    const noPaths = refusalFix({ reason: 'staging_failed', error: 'x', restore_error: 'e' });
    assert.match(noPaths, /could not restore the index \(e\)/);
    assert.doesNotMatch(noPaths, /Nothing was staged/);
    assert.doesNotMatch(refusalFix({ reason: 'staging_failed', error: 'x', left_staged: ['a'] }), /undefined/);
  });

  test('a submodule close names the submodule in the unstage command', () => {
    const fix = refusalFix({ reason: 'staging_failed', error: 'x', left_staged: ['a.js'], restore_error: 'e' }, 'lib');
    assert.deepEqual(fencedLines(fix), ['git -C lib --literal-pathspecs restore --staged -- a.js', 'git -C lib --literal-pathspecs rm --cached -- a.js'], fix);
  });

  // [Foreman: 1202] The commands end the text in a fenced block whose fence
  // outruns any backtick run in them, so no backtick cuts one short.
  test('the unstage commands end the fix text in a fence longer than their backtick runs', () => {
    const fix = refusalFix({ reason: 'staging_failed', error: "fatal: pathspec 'a`b.js' did not match any files", left_staged: ['a`b.js', 'c```'], restore_error: 'e' }, 'li`b');
    assert.match(fix, /\n\n````\ngit /, fix);
    assert.deepEqual(fencedLines(fix), [
      "git -C 'li`b' --literal-pathspecs restore --staged -- 'a`b.js' 'c```'",
      "git -C 'li`b' --literal-pathspecs rm --cached -- 'a`b.js' 'c```'",
    ], fix);
  });

  // [Foreman: 1203] Git's error, the restore error and a path can span lines;
  // they join the prose as one line, so none of their lines opens a fence
  // that swallows the commands.
  test('raw text with line breaks stays on one line above the commands', () => {
    const fix = refusalFix({ reason: 'staging_failed', error: 'error: one\n```\nhint: two', left_staged: ['a\n```.js'], missing_files: ['b\r\n~~~.js'], restore_error: 'e\n<pre>' });
    const prose = fix.slice(0, fix.lastIndexOf('\n\n'));
    assert.doesNotMatch(prose, /[\r\n]/, fix);
    assert.match(prose, /^The commit helper refused: error: one ``` hint: two\. /, fix);
    assert.deepEqual(fencedLines(fix), ["git --literal-pathspecs restore --staged -- 'a\n```.js'", "git --literal-pathspecs rm --cached -- 'a\n```.js'"].join('\n').split('\n'), fix);
  });

  // [Foreman: 1203] A bare word opening with `@` is splatting in PowerShell.
  test('a value opening with @ is quoted', () => {
    const fix = refusalFix({ reason: 'staging_failed', error: 'x', left_staged: ['@a.js', 'b@c.js'], restore_error: 'e' }, '@lib');
    assert.equal(fencedLines(fix)[0], "git -C '@lib' --literal-pathspecs restore --staged -- '@a.js' b@c.js", fix);
    assert.equal(carriedFlags({ orchestrator: '@bob' }), " --orchestrator '@bob'");
  });

  test('the fix text surfaces missing_files for an unexpected_files refusal too', () => {
    const fix = refusalFix({ reason: 'unexpected_files', missing_files: ['src/b.js'] });
    assert.match(fix, /not: src\/b\.js\./);
    assert.match(fix, /Nothing was staged or closed\./);
    assert.match(refusalFix({ reason: 'staging_failed', error: 'x', missing_files: ['src/b.js'] }), /not: src\/b\.js\./);
  });

  // [Foreman: 1203] A restored file stays staged, so the fix offers its
  // unstage commands, and its note opens with words: a path opening with
  // ``` at the start of the text would open a fence.
  test('the fix text for staging_incomplete names the missing and restored files', () => {
    const fix = refusalFix({
      reason: 'staging_incomplete',
      missing_files: ['src/b.js'],
      restored_files: ['src/r.js', '```r.js'],
      error: 'src/r.js, ```r.js is staged, but the working tree holds its baseline content',
    });
    assert.match(fix, /not: src\/b\.js\./);
    assert.match(fix, /These files are staged, but the working tree holds their baseline content: src\/r\.js, ```r\.js\. Stage the content you want, or unstage them with the first command below/);
    assert.match(fix, /nothing was closed\./);
    assert.deepEqual(fencedLines(fix), ["git --literal-pathspecs restore --staged -- src/r.js '```r.js'", "git --literal-pathspecs rm --cached -- src/r.js '```r.js'"], fix);
    const led = refusalFix({ reason: 'staging_incomplete', restored_files: ['```r.js'], error: '```r.js is staged' });
    assert.match(led, /^These files are staged/, led);
  });

  test('an unexpected_files refusal names the restored files and offers their commands', () => {
    const fix = refusalFix({ reason: 'unexpected_files', unexpected_files: ['src/c.js'], restored_files: ['src/r.js'], error: 'src/r.js is staged' });
    assert.match(fix, /baseline content: src\/r\.js\./);
    assert.deepEqual(fencedLines(fix), ['git --literal-pathspecs restore --staged -- src/r.js', 'git --literal-pathspecs rm --cached -- src/r.js'], fix);
    // The index could not be put back: its block names the files left staged
    // first, and the restored files keep their staged content.
    const left = refusalFix({ reason: 'staging_incomplete', restored_files: ['src/r.js'], error: 'x', left_staged: ['src/a.js'], restore_error: 'e' });
    assert.deepEqual(fencedLines(left), ['git --literal-pathspecs restore --staged -- src/a.js', 'git --literal-pathspecs rm --cached -- src/a.js'], left);
    assert.match(left, /or unstage them, then run the close again\./);
  });

  // [Foreman: 1205] gitlink_not_expected's error opens with the submodule
  // paths; at the start of the text, one opening with ``` would open a fence.
  test('a gitlink refusal fix opens with words, not the submodule path', () => {
    const fix = refusalFix({ reason: 'gitlink_not_expected', error: '```lib, <pre>x is a submodule: commit the work inside it' });
    assert.match(fix, /^The commit helper refused: ```lib, <pre>x is a submodule/, fix);
  });

  test('an unexpected_files refusal with restored files never says nothing was staged', () => {
    const fix = refusalFix({ reason: 'unexpected_files', unexpected_files: ['src/c.js'], restored_files: ['src/r.js'] });
    assert.match(fix, /These files are staged/, fix);
    assert.doesNotMatch(fix, /Nothing was staged/, fix);
    assert.match(fix, /Nothing was closed\./, fix);
  });

  test('the restored_files error opens with words and names several files in the plural', () => {
    repo();
    write('src/r.js', 'base r\n');
    write('src/s.js', 'base s\n');
    git('add', 'src/r.js', 'src/s.js');
    git('commit', '-q', '-m', 'add r and s');
    const start = ok(['start', '--id', '001']);
    write('src/r.js', 'staged r\n');
    write('src/s.js', 'staged s\n');
    git('add', 'src/r.js', 'src/s.js');
    write('src/r.js', 'base r\n');
    write('src/s.js', 'base s\n');
    write('src/a.js', 'two\n');
    const result = runThen(start.then, { status: 'done', files: ['src/a.js', 'src/r.js', 'src/s.js'], message: 'Change a' });
    assert.deepEqual(result.restored_files, ['src/r.js', 'src/s.js'], JSON.stringify(result));
    assert.equal(result.error, 'These files are staged, but the working tree holds their baseline content: src/r.js, src/s.js. Stage the content you want, or unstage them, then run finish again');
  });

  test('a restored file through finish gets a command that unstages it alone', (t) => {
    repo();
    write('src/r.js', 'base r\n');
    git('add', 'src/r.js');
    git('commit', '-q', '-m', 'add r');
    const start = ok(['start', '--id', '001']);
    write('src/r.js', 'staged r\n');
    git('add', 'src/r.js');
    write('src/r.js', 'base r\n');
    write('src/a.js', 'two\n');
    const result = runThen(start.then, { status: 'done', files: ['src/a.js', 'src/r.js'], message: 'Change a' });
    assert.equal(result.next, 'refused', JSON.stringify(result));
    assert.deepEqual(result.restored_files, ['src/r.js'], JSON.stringify(result));
    assert.match(result.error, /^This file is staged, but the working tree holds its baseline content: src\/r\.js\. /);
    const [restore] = fencedLines(result.fix);
    assert.equal(restore, 'git --literal-pathspecs restore --staged -- src/r.js', result.fix);
    const r = runBash(restore.replace('git', `git -C '${project.replaceAll('\\', '/')}'`));
    if (r === null) return t.skip('no bash found');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!stagedNames().includes('src/r.js'), stagedNames().join(', '));
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

  // [Foreman: 1164] Git sends hook output to stderr; a hook that runs a suite
  // must not put all of it into the refusal.
  function loudHookFinish(exitCode) {
    repo();
    const hooks = path.join(path.dirname(project), 'hooks');
    fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, 'pre-commit'), `#!/bin/sh\nnode -e "process.stderr.write('x'.repeat(9000000))"\nexit ${exitCode}\n`, { mode: 0o755 });
    git('config', 'core.hooksPath', hooks);
    const start = ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    return runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
  }

  test('a rejecting hook\'s long output is capped in task.js\'s commit_failed', () => {
    const result = loudHookFinish(1);
    assert.equal(result.reason, 'commit_failed');
    assert.ok(result.error.length <= 500, `error is ${result.error.length} characters`);
  });

  test('a hook printing more than 8 MB does not stop task.js\'s commit', () => {
    const result = loudHookFinish(0);
    assert.equal(result.next, 'ask_acceptance', JSON.stringify(result).slice(0, 500));
    assert.equal(result.commit, head());
  });

  // [Foreman: 1171] A read or error after git commit landed the commit is
  // reported with the commit, never as commit_failed with a rerun.
  function shimGit(name, body) {
    const shim = path.join(path.dirname(project), name);
    fs.writeFileSync(shim, `
      const cp = require('child_process');
      const real = cp.execFileSync;
      let committed = false;
      cp.execFileSync = function (file, args) {
        ${body}
      };
    `);
    env = { ...env, NODE_OPTIONS: `--require ${JSON.stringify(shim)}` };
  }

  test('an unreadable HEAD after the commit lands closes the entry and never asks for a rerun', () => {
    repo();
    const start = ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    shimGit('fail-head-1171.js', `
      if (committed && args[0] === 'rev-parse' && args.includes('HEAD') && !args.includes('--verify')) {
        throw Object.assign(new Error('git read failed'), { stderr: 'fatal: simulated read failure' });
      }
      const out = real.apply(this, arguments);
      if (args[0] === 'commit') committed = true;
      return out;
    `);
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.notEqual(result.next, 'refused', JSON.stringify(result));
    assert.equal(result.next, 'ask_acceptance');
    assert.equal(result.commit, undefined);
    assert.match(result.warnings.join(' '), /the commit landed, but git could not read HEAD: fatal: simulated read failure/);
    assert.notEqual(head(), start.baseline);
    assert.equal(stored().status, 'awaiting_acceptance');
  });

  // [Foreman: 1178] The close for a git-ignored roadmap has no sha to record
  // here, so it keeps the files as observed touches.
  test('an unreadable HEAD after a git-ignored roadmap close keeps the files as observed touches', () => {
    repo({ ignoreRoadmap: true });
    const start = ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    shimGit('fail-head-1178.js', `
      if (committed && args[0] === 'rev-parse' && args.includes('HEAD') && !args.includes('--verify')) {
        throw Object.assign(new Error('git read failed'), { stderr: 'fatal: simulated read failure' });
      }
      const out = real.apply(this, arguments);
      if (args[0] === 'commit') committed = true;
      return out;
    `);
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(result.next, 'ask_acceptance', JSON.stringify(result));
    assert.equal(result.commit, undefined);
    assert.notEqual(head(), start.baseline);
    assert.deepEqual(stored().observed_touches, ['src/a.js']);
    assert.deepEqual(stored().commits, []);
  });

  test('an error git commit reports after the commit landed is a warning on the recorded commit', () => {
    repo({ ignoreRoadmap: true });
    const start = ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    shimGit('commit-then-throw-1171.js', `
      const out = real.apply(this, arguments);
      if (args[0] === 'commit') throw Object.assign(new Error('git commit failed'), { stderr: 'error: unable to write new index file' });
      return out;
    `);
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(result.next, 'ask_acceptance', JSON.stringify(result));
    assert.equal(result.commit, head());
    assert.deepEqual(stored().commits, [head()]);
    assert.match(result.warnings.join(' '), /unable to write new index file/);
  });

  test('an abbreviated --baseline with a rejecting hook is still commit_failed, not a landed commit', () => {
    repo();
    const hooks = path.join(path.dirname(project), 'hooks');
    fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho refused >&2\nexit 1\n', { mode: 0o755 });
    git('config', 'core.hooksPath', hooks);
    const start = ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    const result = runThen(start.then.replace(start.baseline, start.baseline.slice(0, 9)), { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(result.reason, 'commit_failed', JSON.stringify(result));
    assert.equal(head(), start.baseline);
  });

  test('a git failure while attesting a landed commit is a warning, not a crash', () => {
    repo();
    const start = ok(['start', '--id', '001']);
    write('src/a.js', 'two\n');
    shimGit('fail-attest-1171.js', `
      if (committed && args[0] === 'rev-list') {
        throw Object.assign(new Error('git read failed'), { stderr: 'fatal: simulated attest failure' });
      }
      const out = real.apply(this, arguments);
      if (args[0] === 'commit') committed = true;
      return out;
    `);
    const result = runThen(start.then, { status: 'done', files: ['src/a.js'], message: 'Change a' });
    assert.equal(result.commit, head(), JSON.stringify(result));
    assert.match(result.warnings.join(' '), /the commit did not pass attestation: git could not check it: .*simulated attest failure/);
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
  // [Foreman: 1153] PowerShell also reads U+2018 to U+201B as single quotes,
  // so the path and the name carry typographic ones too. A done close holds
  // for the orchestrator, whose name the say text must carry intact.
  for (const host of ['claude', 'codex']) for (const [name, shell] of Object.entries(shells)) {
    test(`from ${host} under ${name}`, (t) => {
      repo();
      const plugin = path.join(path.dirname(project), "it's $x John’s ‘q‛ plugin");
      const pluginTask = path.join(plugin, 'scripts', 'task.js');
      // fs.cpSync garbles a non-ASCII destination on Windows, so copy, then rename.
      const copy = path.join(path.dirname(project), 'plugin-copy');
      fs.cpSync(SCRIPTS_DIR, path.join(copy, 'scripts'), { recursive: true });
      fs.copyFileSync(path.join(SCRIPTS_DIR, '..', 'prompt-template.md'), path.join(copy, 'prompt-template.md'));
      fs.renameSync(copy, plugin);
      const hostEnv = { ...env, FOREMAN_HOST: host };
      const who = "o'$x‘y’$z";
      const started = runNodeScript(pluginTask, ['start', '--id', '001', '--orchestrator', who], null, hostEnv);
      assert.equal(started.status, 0, started.stdout + started.stderr);
      const { then } = JSON.parse(started.stdout);
      const payload = path.join(project, 'payload.json').replaceAll('\\', '/');
      fs.writeFileSync(payload, JSON.stringify({ status: 'done' }), 'utf-8');
      const pipe = name === 'PowerShell' ? `Get-Content -LiteralPath '${payload}' -Raw -Encoding utf8` : `cat '${payload}'`;
      const r = shell(`${pipe} | ${then}`, hostEnv);
      if (r === null) return t.skip('no bash found');
      assert.equal(r.status, 0, then + '\n' + r.stdout + r.stderr);
      const held = JSON.parse(r.stdout);
      assert.equal(held.next, 'report_acceptance', r.stdout);
      assert.ok(held.say.includes(`belongs to the orchestrator ${who}, so`), held.say);
      assert.equal(stored().status, 'awaiting_acceptance');

      // The Accept option's then, from the same install path.
      writeRoadmap(project, [entry({ status: 'in_progress' })]);
      const asked = runNodeScript(pluginTask, ['finish', '--id', '001'], { status: 'done' }, hostEnv);
      assert.equal(asked.status, 0, asked.stdout + asked.stderr);
      const accept = JSON.parse(asked.stdout).options.find((o) => o.label.startsWith('Accept')).then;
      const accepted = shell(accept, hostEnv);
      assert.equal(accepted.status, 0, accept + '\n' + accepted.stdout + accepted.stderr);
      assert.equal(stored().status, 'done');
    });
  }
});

// [Foreman: 1197] A value opening with a quote, holding `$` and `"`, reaches
// node intact from the orchestrator flag and from the restore hint's path.
// Windows PowerShell 5.1 drops every `"` from a native argument however it is
// quoted, so powershell.exe gets the values without one; pwsh gets them whole.
describe('a value opening with a quote stays one literal argument', () => {
  const windows = process.platform === 'win32';
  const run = (exe, args) => (command) => unlessTimedOut(spawnSync(exe, [...args, command], { encoding: 'utf-8', windowsHide: true, timeout: SPAWN_TIMEOUT_MS, env: { ...process.env, x: 'X' } }), exe);
  const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { windowsHide: true }).status === 0;
  const shells = {
    bash: { shell: (command) => runBash(command, { x: 'X' }), dquote: true },
    [windows ? 'powershell.exe' : 'sh']: { shell: windows ? run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command']) : run('sh', ['-c']), dquote: !windows },
    ...(pwsh ? { pwsh: { shell: run('pwsh', ['-NoProfile', '-NonInteractive', '-Command']), dquote: true } } : {}),
  };
  for (const [name, { shell, dquote }] of Object.entries(shells)) {
    test(`under ${name}`, (t) => {
      const argv = path.join(project, 'argv.js').replaceAll('\\', '/');
      fs.writeFileSync(argv, 'console.log(JSON.stringify(process.argv.slice(2)));\n', 'utf-8');
      const quote = dquote ? '"' : '';
      const values = [`’$x${quote}y`, `'$x${quote}y`, `$x’y`, `‘q’ $x${quote}`];
      for (const value of values) {
        const flag = carriedFlags({ orchestrator: value });
        const fix = refusalFix({ reason: 'staging_failed', error: 'x', left_staged: [value], restore_error: 'e' }, value);
        const [restore] = fencedLines(fix);
        const file = /restore --staged -- (.+)$/.exec(restore)[1];
        const sub = /^git -C (.+?) --literal-pathspecs restore/.exec(restore)[1];
        const r = shell(`node '${argv}'${flag} ${file} ${sub}`);
        if (r === null) return t.skip('no bash found');
        assert.equal(r.status, 0, flag + ' ' + file + '\n' + r.stdout + r.stderr);
        assert.deepEqual(JSON.parse(r.stdout), [`--orchestrator=${value}`, `./${value}`, `./${value}`], flag + ' ' + file);
      }
      // [Foreman: 1203] Nor does a value opening with `@`, which PowerShell
      // reads as splatting when it stands bare.
      {
        const flag = carriedFlags({ orchestrator: '@bob' });
        const [restore] = fencedLines(refusalFix({ reason: 'staging_failed', error: 'x', left_staged: ['@a.js'], restore_error: 'e' }, '@lib'));
        const [, sub, file] = /^git -C (.+?) --literal-pathspecs restore --staged -- (.+)$/.exec(restore);
        const r = shell(`node '${argv}'${flag} ${file} ${sub}`);
        assert.equal(r.status, 0, restore + '\n' + r.stdout + r.stderr);
        assert.deepEqual(JSON.parse(r.stdout), ['--orchestrator', '@bob', '@a.js', '@lib'], restore);
      }
      // git reads the path itself: a leading `!` or `^` is no exclude magic,
      // so the unstage command drops that one file and keeps the rest staged.
      const repo = path.join(project, 'pathspec').replaceAll('\\', '/');
      fs.mkdirSync(repo, { recursive: true });
      initGitRepo(repo);
      const names = ['!it’s.txt', '^it’s.txt', '’$x.txt', "'$x.txt", '@d.txt'];
      for (const name of [...names, 'a.txt']) fs.writeFileSync(path.join(repo, name), '', 'utf-8');
      const staged = (cwd = repo) => spawnSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf-8' }).stdout.split('\0').filter(Boolean).sort();
      for (const name of names) {
        spawnSync('git', ['add', '-A'], { cwd: repo });
        const fix = refusalFix({ reason: 'staging_failed', error: 'x', left_staged: [name], restore_error: 'e' });
        const command = fencedLines(fix)[1].replace('git', `git -C '${repo}'`);
        const r = shell(command);
        assert.equal(r.status, 0, command + '\n' + r.stdout + r.stderr);
        assert.deepEqual(staged(), [...names, 'a.txt'].filter((n) => n !== name).sort(), command);
      }
      // [Foreman: 1202] Nor does a path opening with `:` read as magic. No
      // such file can exist on Windows, so each is staged without one, past
      // the check that keeps `:` out of a Windows index.
      spawnSync('git', ['config', 'core.protectNTFS', 'false'], { cwd: repo });
      const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: '', encoding: 'utf-8' }).stdout.trim();
      const colons = [':!a.txt', ':^a.txt', ':(top)a.txt', ':/:a.txt', ":'x.txt", ':`b.txt', ':c.txt'];
      for (const name of colons) {
        spawnSync('git', ['add', '-A'], { cwd: repo });
        for (const n of colons) spawnSync('git', ['update-index', '--add', '--cacheinfo', `100644,${blob},${n}`], { cwd: repo });
        const fix = refusalFix({ reason: 'staging_failed', error: 'x', left_staged: [name], restore_error: 'e' });
        const command = fencedLines(fix)[1].replace('git', `git -C '${repo}'`);
        const r = shell(command);
        assert.equal(r.status, 0, command + '\n' + r.stdout + r.stderr);
        assert.deepEqual(staged(), [...names, 'a.txt', ...colons].filter((n) => n !== name).sort(), command);
      }
      // [Foreman: 1203] Nor as a glob: `a[b].txt` unstages that file, not
      // `ab.txt` too. Windows has no file named with `*` or `?`, so these are
      // staged without one as well.
      const globs = ['a[b].txt', 'ab.txt', 'a*.txt', 'aX.txt', 'a?.txt'];
      for (const name of ['a[b].txt', 'a*.txt', 'a?.txt']) {
        spawnSync('git', ['add', '-A'], { cwd: repo });
        for (const n of globs) spawnSync('git', ['update-index', '--add', '--cacheinfo', `100644,${blob},${n}`], { cwd: repo });
        const fix = refusalFix({ reason: 'staging_failed', error: 'x', left_staged: [name], restore_error: 'e' });
        const command = fencedLines(fix)[1].replace('git', `git -C '${repo}'`);
        const r = shell(command);
        assert.equal(r.status, 0, command + '\n' + r.stdout + r.stderr);
        assert.deepEqual(staged(), [...names, 'a.txt', ...globs].filter((n) => n !== name).sort(), command);
      }
      // [Foreman: 1202] A backtick in the text above the commands, as git and
      // the commit helper write it, cannot pair with one in a command: the
      // fenced command unstages both files from a repository whose path holds
      // one too, as a submodule's can.
      const sub = path.join(project, 'li`b').replaceAll('\\', '/');
      fs.mkdirSync(sub, { recursive: true });
      initGitRepo(sub);
      const ticked = ['a`b.js', 'c``.js'];
      for (const name of [...ticked, 'd.js']) fs.writeFileSync(path.join(sub, name), '', 'utf-8');
      const restoreError = `EEXIST: file already exists, open '${path.join(project, '.git', 'modules', 'li`b', 'index.lock')}'`;
      const units = [
        { reason: 'staging_failed', error: "fatal: pathspec 'a`b.js' did not match any files", restore_error: restoreError, left_staged: ticked },
        {
          reason: 'staging_incomplete',
          missing_files: ['c``.js'],
          restored_files: ['a`b.js'],
          error: 'a`b.js is staged, but the working tree holds its baseline content: stage the content you want, or unstage it, then run finish again',
          restore_error: restoreError,
          left_staged: ticked,
        },
        // [Foreman: 1203] The index was put back: the block names the restored files.
        { reason: 'staging_incomplete', restored_files: ticked, error: 'a`b.js, c``.js is staged, but the working tree holds its baseline content' },
      ];
      for (const unit of units) {
        spawnSync('git', ['add', '-A'], { cwd: sub });
        const fix = refusalFix(unit, sub);
        const command = fencedLines(fix)[1];
        assert.ok(command, fix);
        const r = shell(command);
        assert.equal(r.status, 0, command + '\n' + r.stdout + r.stderr);
        assert.deepEqual(staged(sub), ['d.js'], command);
      }
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
    assert.ok(shared.includes("On every host, a handoff's entry paragraph runs that boundary through `scripts/task.js`, except two paragraphs that never call it: a Codex or Antigravity investigation, which takes no boundary and closes with `roadmap.js update-status`, and a Codex or Antigravity delegated subagent's, whose coordinator owns the start, the close and the check and closes with `update-status`. A Claude Code background Agent's entry paragraph does call it; a Claude Code Workflow stage's agent carries the coordinator paragraph instead, and its Workflow owns the entry. Where the paragraph does call it, `start` takes the boundary, except for an investigation; in Claude Code it also opens the entry, which `hooks/codex-task.js start` opens first in Codex and Antigravity."), shared);
    assert.ok(shared.includes('A `report_dirty` answer from `start` means it took no boundary and the close will stage and commit nothing; from `finish`, it means nothing was staged or committed.'));
    assert.ok(shared.includes('When no entry paragraph supplies `task.js finish`, a staged close by hand runs `finish --no-commit`'));
    assert.doesNotMatch(read('skills', 'foreman', 'runtime.md'), /that trailer\. Record\n/);
  });

  test('the Codex runtime runs the entry paragraph through task.js, Antigravity too', () => {
    const codex = flat(read('skills', 'foreman', 'runtime-codex.md'));
    assert.ok(codex.includes("Then take the commit boundary with the entry paragraph's `scripts/task.js start` and close the entry with its `scripts/task.js finish`"), codex);
    assert.ok(codex.includes("the entry paragraph's `scripts/task.js start` and `finish` around the work"), 'Antigravity too');
  });

  test('the roadmap delivery pages run the entry paragraph through task.js', () => {
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
    assert.ok(protocol.includes('A Codex or Antigravity investigation and a Codex subagent\'s coordinator close with `roadmap.js update-status` instead.'), protocol);
    assert.ok(flat(read('docs', 'knowledge', 'changelog.md')).includes('on Codex and Antigravity, an investigation, which closes itself with `roadmap.js update-status`, and a delegated subagent, whose coordinator closes it the same way; a Claude Code background Agent still runs them.'));
  });

  // [Foreman: 1141] checkpointEmbedText checks `git status --porcelain` for a
  // run without an entry; the in-session flow keeps safe-commit begin because
  // its later finish needs the baseline, and the template says why.
  test('the template says why the no-entry boundary differs from the clipboard embed', () => {
    const template = read('prompt-template.md');
    const section = flat(template.slice(template.indexOf('- **Take the boundary first'), template.indexOf('- **One commit per finished task')));
    assert.ok(section.includes('Without an entry, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/safe-commit.js begin` and read its `dirty` field; this in-session flow takes `begin` because its later `finish` needs that baseline, while the clipboard embed above checks `git status --porcelain`.'), section);
    const embed = checkpointEmbedText({ branch: true, onFinish: 'ask' }, 2, null, false, false, 'claude');
    assert.match(embed, /check `git status --porcelain`/);
  });

  // [Foreman: 1157] A reviewed clipboard embed without an entry carries the
  // porcelain gate and each checkpoint's safe-commit boundary; the template
  // says why both stand.
  test('the template says why a reviewed entry-less embed carries both boundary forms', () => {
    const template = read('prompt-template.md');
    const section = flat(template.slice(template.indexOf('**Clipboard checkpoint embed**'), template.indexOf('## Splitting an `Execute here` handoff')));
    assert.ok(section.includes('A reviewed run without an entry therefore carries both forms on purpose: `git status --porcelain` before task 1 only decides whether the run commits at all, and each checkpoint\'s `begin`, taken before that increment\'s edits, gives its `finish` the baseline it needs;'), section);
    for (const host of ['claude', 'codex']) {
      const embed = checkpointEmbedText({ branch: true, onFinish: 'ask' }, 2, null, true, true, host);
      assert.match(embed, /git status --porcelain/, host);
      assert.ok(embed.includes('safe-commit begin/finish boundaries'), host);
    }
    assert.ok(flat(read('docs', 'knowledge', 'changelog.md')).includes('The prompt template says why a reviewed run pasted without an entry checks `git status --porcelain` before its first task and still commits each checkpoint through `safe-commit` `begin` and `finish`.'));
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
    // [Foreman: 1157] commit_failed is one of safe-commit.js's own refusals
    // since 1160; task.js finish returns it too.
    assert.ok(flat(paragraph).includes('`commit_failed` (`git commit` itself failing, as when a pre-commit hook refuses; `scripts/task.js finish` returns it too when its own commit fails)'), flat(paragraph));
    assert.doesNotMatch(flat(trials), /plus `commit_failed` \(`scripts\/task\.js finish`/);
    assert.ok(flat(trials).includes('plus `scripts/task.js finish` when its own `git commit` fails (`commit_failed`)'));
    const trialLog = read('scripts', 'trial-log.js');
    assert.ok(trialLog.includes('commit_failed among\n// them, which scripts/task.js finish also returns'));
    assert.ok(trialLog.includes('since [Foreman: 1160],\n  // safe-commit.js finish.'));
  });

  // [Foreman: 1141] The commit_interrupted bullet names every refusal
  // safe-commit.js returns, and says which of them are ok:false.
  test('TRIALS.md commit_interrupted lists the safe-commit refusals, begin\'s dirty as ok:true', () => {
    const { REASON_CLASSES } = require(path.join(SCRIPTS_DIR, 'trial-log.js'));
    const trials = read('TRIALS.md');
    const start = trials.indexOf('- **`commit_interrupted`**');
    const bullet = flat(trials.slice(start, trials.indexOf('- **`recovery_attempted`, `reinit-snapshot`**', start)));
    // [Foreman: 1157] commit_failed is among finish's refusals, and every
    // reason begin can give is named as a dirty_tree answer.
    const safeCommit = REASON_CLASSES.filter((reason) => !['dirty_tree', 'verification_declined'].includes(reason));
    for (const reason of safeCommit) assert.ok(bullet.includes(`\`${reason}\``), `commit_interrupted lists ${reason}`);
    const source = read('scripts', 'safe-commit.js');
    const state = source.slice(source.indexOf('function repositoryState'), source.indexOf('function gitFailureCause'));
    const beginReasons = [...state.matchAll(/reason: "([a-z_]+)"/g)].map((m) => m[1]);
    assert.ok(beginReasons.length > 0);
    for (const reason of beginReasons) assert.ok(bullet.includes(`\`${reason}\``), `commit_interrupted names begin's ${reason}`);
    assert.ok(bullet.includes('recorded as `dirty_tree` whatever its `reason`'), bullet);
    assert.ok(bullet.includes('`begin` reporting `dirty: true`, which is an `ok:true` answer recorded as `dirty_tree`'), bullet);
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
