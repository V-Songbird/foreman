'use strict';

// [Foreman: 121] The one task-owned commit path.
//   - begin: clean tree yields a baseline; dirty tree yields dirty:true and
//     NO baseline, so "work anyway" mechanically means "no automated commits"
//   - finish: derives the delta from the baseline, refuses undeclared files
//     before staging anything, stages exactly the derived set, commits with
//     the canonical trailer, and attests one commit on the baseline
//   - the doc contract: the close and checkpoint choreography no longer
//     tells anyone to `git add -A`

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { makeTmpProject, writeRoadmap, writeArchiveFile, writeConfig, initGitRepo, runNodeScript, runRoadmap, SCRIPTS_DIR, HOOKS_DIR, TIME_SCALE } = require('./helpers');

const SAFE_COMMIT = path.join(SCRIPTS_DIR, 'safe-commit.js');
// LF text, so a CRLF checkout pins the same template prose.
const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'prompt-template.md'), 'utf-8').replace(/\r\n/g, '\n');
const { entryParagraphText, checkpointEmbedText } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));
const HOSTS = ['claude', 'codex'];

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

function writeFile(rel, content) {
  const full = path.join(project, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function entry(id) {
  return {
    id,
    title: 'ship the thing',
    why: '',
    what: '',
    status: 'in_progress',
    source: 'user',
    depends_on: [],
    touches: [],
    commits: [],
    notes: '',
  };
}

/** A committed, clean starting repository. */
function cleanRepo() {
  initGitRepo(project);
  writeRoadmap(project, [entry('001')]);
  git('add', '-A');
  git('commit', '-q', '-m', 'baseline');
}

function run(argv, stdin) {
  const r = runNodeScript(SAFE_COMMIT, argv, stdin, env);
  return { status: r.status, json: JSON.parse(r.stdout), stderr: r.stderr };
}

function begin() {
  const { json } = run(['begin'], null);
  return json;
}

// [Foreman: 967] The Codex desktop app's Windows sandbox fails any spawn with
// piped output as `spawnSync git EPERM`; this preload refuses git pipes the
// same way for every later run in the test.
// [Foreman: 977] Any program, not only git: the lock's start-time read runs
// powershell.exe or ps.
function refusePipes() {
  const shim = path.join(path.dirname(project), 'refuse-pipes.js');
  fs.writeFileSync(shim, `
    const cp = require('child_process');
    for (const name of ['execFileSync', 'spawnSync']) {
      const real = cp[name];
      cp[name] = function (file, args, options = {}) {
        if ([].concat(options.stdio ?? 'pipe').includes('pipe')) {
          const error = Object.assign(new Error(\`spawnSync \${file} EPERM\`), { code: 'EPERM', errno: -4048, syscall: \`spawnSync \${file}\` });
          // spawnSync reports a failed start in its result; execFileSync throws it.
          if (name === 'spawnSync') return { pid: 0, output: null, stdout: null, stderr: null, status: null, signal: null, error };
          throw error;
        }
        return real.apply(this, arguments);
      };
    }
  `);
  env = { ...env, NODE_OPTIONS: `--require ${JSON.stringify(shim)}` };
}

describe('safe-commit begin', () => {
  test('a clean tree returns the baseline head and state hash', () => {
    cleanRepo();
    const json = begin();
    assert.equal(json.ok, true);
    assert.equal(json.dirty, false);
    assert.equal(json.baseline.head, git('rev-parse', 'HEAD').trim());
    assert.match(json.baseline.state_hash, /^[0-9a-f]{64}$/);
  });

  test('a dirty tree returns dirty:true with no baseline and never proceeds', () => {
    cleanRepo();
    writeFile('someone-elses-work.txt', 'in progress\n');
    const json = begin();
    assert.equal(json.ok, true);
    assert.equal(json.dirty, true);
    assert.equal(json.reason, 'working_tree_has_changes');
    assert.equal(json.baseline, undefined, 'no baseline means finish cannot commit');
  });

  test('a staged-but-uncommitted change is dirty too', () => {
    cleanRepo();
    writeFile('staged.txt', 'x\n');
    git('add', '-A');
    assert.equal(begin().dirty, true);
  });

  // [Foreman: 184] The flow's own bookkeeping is not foreign work: the entry
  // flips in_progress BEFORE begin, so a tracked roadmap is always dirty here.
  test('ledger-only dirt still yields the baseline, named in ledger_dirty', () => {
    cleanRepo();
    writeRoadmap(project, [{ ...entry('001'), notes: 'flipped by the flow' }]);
    const json = begin();
    assert.equal(json.ok, true);
    assert.equal(json.dirty, false);
    assert.deepEqual(json.ledger_dirty, ['ROADMAP.jsonl']);
    assert.equal(json.baseline.head, git('rev-parse', 'HEAD').trim());
  });

  // The removed lesson ledger's store is the project's own file now, so a
  // change to it is someone's uncommitted work, not Foreman's bookkeeping.
  test('a changed leftover .foreman/notes.jsonl is dirty:true', () => {
    cleanRepo();
    writeRoadmap(project, [{ ...entry('001'), notes: 'flipped by the flow' }]);
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'notes.jsonl'), '{}');
    const json = begin();
    assert.equal(json.dirty, true);
  });

  test('ledger dirt mixed with real dirt is still dirty:true', () => {
    cleanRepo();
    writeRoadmap(project, [{ ...entry('001'), notes: 'flipped by the flow' }]);
    writeFile('someone-elses-work.txt', 'in progress\n');
    const json = begin();
    assert.equal(json.dirty, true);
    assert.equal(json.baseline, undefined);
  });

  // The trial log is Foreman's own write into .foreman, not someone else's
  // work: a flow that records an event must not cost the run its baseline.
  test('a recorded trial event still yields the baseline', () => {
    cleanRepo();
    writeConfig(project, { trialLog: true });
    git('add', '-A');
    git('commit', '-q', '-m', 'trial log on');

    const trial = require(path.join(SCRIPTS_DIR, 'trial-log'));
    assert.equal(trial.record('session_start', {}, { root: project }).recorded, true);

    const json = begin();
    assert.equal(json.ok, true);
    assert.equal(json.dirty, false);
    assert.deepEqual(
      json.ledger_dirty.slice().sort(),
      ['.foreman/trial-log.jsonl', '.foreman/trial-session'],
    );
    assert.equal(json.baseline.head, git('rev-parse', 'HEAD').trim());
  });

  test('without a baseline, finish refuses outright', () => {
    cleanRepo();
    const { status, json } = run(['finish'], { id: '001', expected: ['src'], message_title: 'x' });
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /--baseline must name the commit/);
  });

  // [Foreman: 967] A git that cannot run must say why, not only that it failed.
  test('a git failure reports git_status_unavailable with git\'s error as the cause', () => {
    // No repository here, and none above: the ceiling stops git's upward search.
    env = { ...env, GIT_CEILING_DIRECTORIES: path.dirname(project), LC_ALL: 'C' };
    const json = begin();
    assert.equal(json.ok, true);
    assert.equal(json.dirty, true);
    assert.equal(json.reason, 'git_status_unavailable');
    assert.equal(json.baseline, undefined);
    assert.match(json.cause, /not a git repository/);
  });

  // [Foreman: 1157] Inside .git, git answers "false" to
  // --is-inside-work-tree: begin reports it as a dirty tree, ok:true, so the
  // trial log records it as dirty_tree, never as an ok:false refusal.
  test('begin outside a work tree reports not_a_git_worktree as dirty, ok:true', () => {
    cleanRepo();
    const { beginUnit } = require(SAFE_COMMIT);
    const json = beginUnit(path.join(project, '.git'));
    assert.equal(json.ok, true);
    assert.equal(json.dirty, true);
    assert.equal(json.reason, 'not_a_git_worktree');
    assert.equal(json.baseline, undefined);
  });

  // [Foreman: 967] The Codex desktop app's Windows sandbox fails any spawn
  // with piped output as `spawnSync git EPERM`; a preload refuses pipes the
  // same way, and begin still reads the tree through files.
  test('a sandbox that refuses piped git output still yields the baseline', () => {
    cleanRepo();
    const piped = begin();
    refusePipes();
    const json = begin();
    assert.equal(json.dirty, false, JSON.stringify(json));
    assert.deepEqual(json.baseline, piped.baseline);
  });
});

// [Foreman: 977] Every other child process that reads piped output goes
// through run-git.js too. Each test runs one caller in a child under the
// preload, so a caller that pipes again fails its test.
describe('the other piped reads in a sandbox that refuses piped output', () => {
  const q = JSON.stringify;
  const EVIDENCE = path.join(SCRIPTS_DIR, 'commit-evidence.js');
  const ROADMAP = path.join(SCRIPTS_DIR, 'roadmap.js');
  const RESOLVE = path.join(SCRIPTS_DIR, 'resolve-symbols.js');
  const LOCK = path.join(SCRIPTS_DIR, 'roadmap-lock.js');
  const POST_COMMIT = path.join(HOOKS_DIR, 'post-commit.js');

  // Evaluates `expression` in a child, which the preload reaches, and returns
  // its value.
  function probe(expression) {
    const file = path.join(path.dirname(project), 'probe.js');
    fs.writeFileSync(file, `process.stdout.write(JSON.stringify(${expression}) ?? 'null');`);
    const r = runNodeScript(file, [], null, env);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  }

  function commitWith(message) {
    writeFile('src/a.js', `${message}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD').trim();
  }

  test('commit-evidence.js gitRead resolves a recorded sha', () => {
    cleanRepo();
    const sha = git('rev-parse', 'HEAD').trim();
    refusePipes();
    const where = probe(`require(${q(EVIDENCE)}).resolveSha(${q(project)}, ${q(sha.slice(0, 7))})`);
    assert.deepEqual(where, { sha: sha.slice(0, 7), exists: true, full: sha });
  });

  test('roadmap.js submodulePaths reads .gitmodules', () => {
    cleanRepo();
    writeFile('.gitmodules', '[submodule "lib"]\n\tpath = lib\n\turl = ./lib\n');
    refusePipes();
    assert.deepEqual(probe(`require(${q(ROADMAP)}).submodulePaths(${q(project)})`), ['lib']);
  });

  test('roadmap.js commitMessageFor still refuses another entry\'s commit', () => {
    cleanRepo();
    const sha = commitWith('Other work\n\nForeman: 002');
    refusePipes();
    const r = runRoadmap(['update-status'], { id: '001', status: 'done', commit: sha }, env);
    assert.equal(r.status, 1, r.stdout);
    assert.ok(JSON.parse(r.stdout).error.includes('"Foreman: 002", not 001'), r.stdout);
  });

  test('roadmap.js stageRoadmapFile stages a tracked ledger file deleted from disk', () => {
    cleanRepo();
    writeArchiveFile(project, []);
    git('add', '-A');
    git('commit', '-q', '-m', 'archive');
    fs.rmSync(path.join(project, '.foreman', 'archive.jsonl'));
    refusePipes();
    probe(`require(${q(ROADMAP)}).stageRoadmapFile(${q(project)})`);
    assert.equal(git('diff', '--cached', '--name-status').trim(), 'D\t.foreman/archive.jsonl');
  });

  test('post-commit.js headTrailerIds reads the trailer of HEAD', () => {
    cleanRepo();
    commitWith('Own work\n\nForeman: 001');
    refusePipes();
    assert.deepEqual(probe(`require(${q(POST_COMMIT)}).headTrailerIds(${q(project)})`), ['001']);
  });

  test('post-commit.js scopeTouchedFiles lists the files of HEAD', () => {
    cleanRepo();
    commitWith('Own work');
    refusePipes();
    assert.deepEqual(probe(`require(${q(POST_COMMIT)}).scopeTouchedFiles({ cwd: ${q(project)}, prefix: '' })`), ['src/a.js']);
  });

  test('resolve-symbols.js still dates each planned file', () => {
    cleanRepo();
    commitWith('Own work');
    const date = git('log', '-1', '--format=%ad', '--date=short', '--', 'src/a.js').trim();
    refusePipes();
    const { files } = probe(`require(${q(RESOLVE)}).resolve(${q(project)}, ['src/a.js'])`);
    assert.equal(files[0].lastChanged, date, q(files));
  });

  // A claim whose PID is alive but whose start time differs is abandoned.
  // Only the start-time read can tell; Linux reads it from /proc, not a child.
  test('roadmap-lock.js recovers a claim whose PID now names another process', () => {
    const { lockPathForRoot, withRoadmapLock } = require(LOCK);
    const lockPath = lockPathForRoot(project);
    let identity;
    withRoadmapLock(project, () => {
      const [claim] = fs.readdirSync(lockPath).filter((name) => name.startsWith('claim-'));
      identity = JSON.parse(fs.readFileSync(path.join(lockPath, claim, 'owner.json'), 'utf-8')).process_identity;
    });
    const claim = path.join(lockPath, `claim-${process.pid}-reused`);
    fs.mkdirSync(claim, { recursive: true });
    fs.writeFileSync(path.join(claim, 'owner.json'), q({
      pid: process.pid,
      timestamp: Date.now(),
      token: 'reused',
      process_identity: identity.kind === 'epoch-ms' ? { kind: 'epoch-ms', value: 0 } : { kind: identity.kind, value: `${identity.value}-reused` },
    }));
    fs.writeFileSync(path.join(claim, 'ticket.json'), q({ number: 1, token: 'reused' }));
    refusePipes();
    const waitMs = 10000 * TIME_SCALE;
    assert.equal(probe(`require(${q(LOCK)}).withRoadmapLock(${q(project)}, () => 'recovered', { staleMs: 0, waitMs: ${waitMs} })`), 'recovered');
    assert.equal(fs.existsSync(lockPath), false);
  });
});

describe('safe-commit finish staging discipline', () => {
  test('refuses and stages nothing when a changed file matches no expected entry', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeFile('src/a.js', 'owned\n');
    writeFile('notes/b.md', 'unrelated\n');

    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src'],
      message_title: 'do the thing',
    });

    assert.equal(json.ok, false);
    assert.equal(json.reason, 'unexpected_files');
    assert.deepEqual(json.unexpected_files, ['notes/b.md']);
    assert.deepEqual(json.changed_files, ['notes/b.md', 'src/a.js']);
    assert.equal(json.staged, false);
    assert.equal(git('diff', '--cached', '--name-only').trim(), '', 'a refusal leaves the index untouched');
    assert.equal(git('rev-parse', 'HEAD').trim(), baseline, 'and creates no commit');
  });

  test('--allow-unexpected accepts the same files after the user approves them', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeFile('src/a.js', 'owned\n');
    writeFile('notes/b.md', 'unrelated\n');

    const { json } = run(['finish', '--baseline', baseline, '--allow-unexpected'], {
      id: '001',
      expected: ['src'],
      message_title: 'do the thing',
    });

    assert.equal(json.ok, true, JSON.stringify(json));
    assert.deepEqual(json.files, ['notes/b.md', 'src/a.js']);
  });

  test('an expected area owns every file beneath it, including new ones', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeFile('src/api/deep/nested/file.js', 'new and untracked\n');

    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src/api'],
      message_title: 'deep change',
    });

    assert.equal(json.ok, true, JSON.stringify(json));
    assert.deepEqual(json.files, ['src/api/deep/nested/file.js']);
  });

  test('--no-commit stages the derived set and stops before committing', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeFile('src/a.js', 'owned\n');

    const { json } = run(['finish', '--baseline', baseline, '--no-commit'], {
      id: '001',
      expected: ['src'],
    });

    assert.equal(json.ok, true, JSON.stringify(json));
    assert.equal(json.committed, false);
    assert.deepEqual(json.files, ['src/a.js']);
    assert.equal(json.trailer, 'Foreman: 001');
    assert.equal(git('diff', '--cached', '--name-only').trim(), 'src/a.js');
    assert.equal(git('rev-parse', 'HEAD').trim(), baseline, 'no commit was made');
  });

  test('nothing changed since the baseline is a refusal, not an empty commit', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src'],
      message_title: 'nothing',
    });
    assert.equal(json.ok, false);
    assert.equal(json.reason, 'no_task_changes');
  });

  test('the usage text gives the close-in-commit order task.js runs', () => {
    const r = runNodeScript(SAFE_COMMIT, ['--help'], null, env);
    assert.equal(r.status, 0, r.stderr);
    const usage = r.stdout.replace(/\s+/g, ' ');
    assert.match(usage, /finish stages ROADMAP\.jsonl with the task's files, and update-status staged:true runs after it/);
    assert.match(usage, /no_task_changes; a roadmap_close whose only change is ROADMAP\.jsonl too/);
    assert.match(usage, /finish --no-commit, then update-status staged:true, then one git commit/);
    assert.doesNotMatch(usage, /has already staged ROADMAP\.jsonl/);
  });

  // [Foreman: 1154] A refusal after staging used to reset every other staged
  // path to HEAD; held bookkeeping was already left alone. A staged path that matches the baseline in the worktree is in no
  // diff against it, so only the staged check after `git add` catches it.
  function refuseAfterStaging() {
    cleanRepo();
    writeFile('src/a.js', 'base a\n');
    writeFile('src/del.js', 'base del\n');
    writeFile('notes/b.md', 'base b\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'add a and b');
    const baseline = begin().baseline.head;
    writeFile('src/a.js', 'staged a\n');
    git('add', 'src/a.js');
    writeFile('src/a.js', 'worktree a\n');
    writeFile('src/c.js', 'new c\n');
    fs.rmSync(path.join(project, 'src', 'del.js'));
    writeFile('notes/b.md', 'staged b\n');
    git('add', 'notes/b.md');
    writeFile('notes/b.md', 'base b\n');
    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src'],
      message_title: 'do the thing',
    });
    assert.equal(json.ok, false);
    assert.equal(json.reason, 'unexpected_files');
    assert.deepEqual(json.unexpected_files, ['notes/b.md']);
  }

  test('a refusal after staging puts back the index entries finish replaced', () => {
    refuseAfterStaging();
    assert.equal(git('show', ':src/a.js'), 'staged a\n', 'the user\'s staged content, not HEAD\'s or the worktree\'s');
    assert.equal(git('ls-files', '--', 'src/c.js'), '', 'a file finish added leaves the index again');
    assert.equal(git('show', ':src/del.js'), 'base del\n', 'a tracked file deleted in the worktree is back in the index');
    assert.equal(fs.readFileSync(path.join(project, 'src', 'a.js'), 'utf-8'), 'worktree a\n');
  });

  test('a refusal after staging leaves a path finish did not stage as the user staged it', () => {
    refuseAfterStaging();
    assert.equal(git('show', ':notes/b.md'), 'staged b\n');
  });

  test('an owned file staged and then restored to the baseline is refused, its staged content kept', () => {
    cleanRepo();
    writeFile('src/r.js', 'base r\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'add r');
    const baseline = begin().baseline.head;
    writeFile('src/r.js', 'staged r\n');
    git('add', 'src/r.js');
    writeFile('src/r.js', 'base r\n');
    writeFile('src/a.js', 'owned\n');
    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src'],
      message_title: 'do the thing',
    });
    assert.equal(json.ok, false, JSON.stringify(json));
    assert.equal(json.reason, 'staging_incomplete');
    assert.deepEqual(json.restored_files, ['src/r.js']);
    assert.equal(git('rev-parse', 'HEAD').trim(), baseline, 'no commit was made');
    assert.equal(git('show', ':src/r.js'), 'staged r\n');
    assert.equal(git('ls-files', '--', 'src/a.js'), '', 'what finish staged leaves the index again');
  });

  test('a restored file is refused while bookkeeping stays staged, both kept', () => {
    cleanRepo();
    writeFile('src/r.js', 'base r\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'add r');
    const baseline = begin().baseline.head;
    writeRoadmap(project, [{ ...entry('001'), notes: 'flipped' }]);
    git('add', '--', 'ROADMAP.jsonl');
    writeFile('src/r.js', 'staged r\n');
    git('add', 'src/r.js');
    writeFile('src/r.js', 'base r\n');
    writeFile('src/a.js', 'owned\n');
    const { json } = run(['finish', '--baseline', baseline], {
      expected: ['src'],
      message_title: 'task 1/2: first',
    });
    assert.equal(json.ok, false, JSON.stringify(json));
    assert.equal(json.reason, 'staging_incomplete');
    assert.deepEqual(json.restored_files, ['src/r.js']);
    assert.equal(git('rev-parse', 'HEAD').trim(), baseline, 'no commit was made');
    assert.equal(git('show', ':src/r.js'), 'staged r\n');
    assert.deepEqual(git('diff', '--cached', '--name-only').trim().split('\n'), ['ROADMAP.jsonl', 'src/r.js']);
  });

  // Stages notes/b.md and puts its baseline content back in the worktree:
  // no diff lists it, so finish refuses it only after its own `git add`.
  function strayAfterStaging() {
    writeFile('notes/b.md', 'staged b\n');
    git('add', 'notes/b.md');
    writeFile('notes/b.md', 'base b\n');
  }

  function commitWith(files) {
    cleanRepo();
    for (const [file, content] of Object.entries(files)) writeFile(file, content);
    writeFile('notes/b.md', 'base b\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'add files');
    return begin().baseline.head;
  }

  function finishRefused(baseline) {
    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src'],
      message_title: 'do the thing',
    });
    assert.equal(json.ok, false, JSON.stringify(json));
    return json;
  }

  test('a refusal after staging a few hundred files puts the index back', () => {
    const many = Array.from({ length: 350 }, (_, i) => `src/many/${'x'.repeat(44)}${String(i).padStart(3, '0')}.js`);
    const baseline = commitWith(Object.fromEntries(many.map((file) => [file, 'base\n'])));
    for (const file of many) writeFile(file, 'worktree\n');
    writeFile(many[0], 'staged\n');
    git('add', many[0]);
    writeFile(many[0], 'worktree\n');
    strayAfterStaging();
    const json = finishRefused(baseline);
    assert.equal(json.reason, 'unexpected_files');
    assert.equal(git('show', `:${many[0]}`), 'staged\n');
    assert.deepEqual(git('diff', '--cached', '--name-only').trim().split('\n'), ['notes/b.md', many[0]]);
  });

  test('a refusal after staging keeps an intent-to-add path intent-to-add', () => {
    const baseline = commitWith({});
    writeFile('src/x.js', 'new x\n');
    git('add', '-N', 'src/x.js');
    strayAfterStaging();
    finishRefused(baseline);
    assert.equal(git('status', '--porcelain', '--', 'src/x.js'), ' A src/x.js\n');
  });

  test('a refusal after staging keeps an unmerged path\'s conflict stages', () => {
    const baseline = commitWith({ 'src/u.js': 'base u\n' });
    const blob = (content) => {
      writeFile('blob.tmp', content);
      const sha = git('hash-object', '-w', 'blob.tmp').trim();
      fs.rmSync(path.join(project, 'blob.tmp'));
      return sha;
    };
    const stages = [
      `0 ${'0'.repeat(40)}\tsrc/u.js`,
      ...['base u\n', 'ours u\n', 'theirs u\n'].map((content, i) => `100644 ${blob(content)} ${i + 1}\tsrc/u.js`),
    ];
    const r = spawnSync('git', ['update-index', '--index-info'], { cwd: project, input: stages.join('\n') + '\n', encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    writeFile('src/u.js', 'conflicted u\n');
    const before = git('ls-files', '--stage', '--', 'src/u.js');
    strayAfterStaging();
    finishRefused(baseline);
    assert.equal(git('ls-files', '--stage', '--', 'src/u.js'), before);
    assert.equal(before.trim().split('\n').length, 3);
  });

  test('a git add that fails leaves the index untouched and names nothing as left staged', () => {
    const baseline = commitWith({ 'src/a.js': 'base a\n' });
    writeFile('src/a.js', 'worktree a\n');
    fs.writeFileSync(path.join(project, '.git', 'index.lock'), '');
    const json = finishRefused(baseline);
    assert.equal(json.reason, 'staging_failed');
    assert.equal(json.left_staged, undefined, 'the failed add staged nothing');
    assert.equal(json.restore_error, undefined);
    assert.equal(git('diff', '--cached', '--name-only'), '');
  });

  test('an index finish cannot put back after its own git add is named in the refusal, not thrown', () => {
    const baseline = commitWith({ 'src/a.js': 'base a\n' });
    writeFile('src/a.js', 'worktree a\n');
    strayAfterStaging();
    // Takes the index lock as soon as finish's `git add` returns.
    const shim = path.join(path.dirname(project), 'lock-after-add.js');
    fs.writeFileSync(shim, `
      const cp = require('child_process');
      const fs = require('fs');
      const path = require('path');
      const real = cp.execFileSync;
      cp.execFileSync = function (file, args, options) {
        const out = real.apply(this, arguments);
        if (args[0] === 'add') fs.writeFileSync(path.join(options.cwd, '.git', 'index.lock'), '');
        return out;
      };
    `);
    env = { ...env, NODE_OPTIONS: `--require ${JSON.stringify(shim)}` };
    const json = finishRefused(baseline);
    assert.equal(json.reason, 'unexpected_files');
    assert.deepEqual(json.left_staged, ['src/a.js']);
    assert.match(json.restore_error, /EEXIST/);
    assert.equal(json.staged, undefined, 'the index was not put back, so the refusal does not claim it');
    assert.equal(fs.existsSync(path.join(project, '.git', 'index.lock')), true, 'a lock finish did not take stays');
    assert.equal(git('show', ':src/a.js'), 'worktree a\n', 'left_staged names what finish staged');
  });

  // [Foreman: 1160] Every step after finish's `git add` refuses with the index
  // put back; before, a throw there left finish's staging over the user's.
  function stagedOverWorktree() {
    const baseline = commitWith({ 'src/a.js': 'base a\n' });
    writeFile('src/a.js', 'staged a\n');
    git('add', 'src/a.js');
    writeFile('src/a.js', 'worktree a\n');
    return baseline;
  }

  function withShim(name, source) {
    const shim = path.join(path.dirname(project), name);
    fs.writeFileSync(shim, source);
    env = { ...env, NODE_OPTIONS: `--require ${JSON.stringify(shim)}` };
  }

  test('a pre-commit hook that rejects the commit is refused as commit_failed, the user\'s staging put back', () => {
    const baseline = stagedOverWorktree();
    const hooks = path.join(project, '.git', 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho hook says no >&2\nexit 1\n', { mode: 0o755 });
    git('config', 'core.hooksPath', hooks);
    const json = finishRefused(baseline);
    assert.equal(json.reason, 'commit_failed');
    assert.match(json.error, /hook says no/);
    assert.equal(json.staged, false);
    assert.equal(git('rev-parse', 'HEAD').trim(), baseline, 'no commit was made');
    assert.equal(git('show', ':src/a.js'), 'staged a\n', 'the user\'s staged content, not finish\'s');
  });

  test('git commit runs with no timeout, so a long pre-commit hook is not killed', () => {
    const baseline = commitWith({ 'src/a.js': 'base a\n' });
    writeFile('src/a.js', 'worktree a\n');
    withShim('commit-timeout.js', `
      const cp = require('child_process');
      const real = cp.execFileSync;
      cp.execFileSync = function (file, args, options) {
        if (args[0] === 'commit' && options.timeout !== 0) throw new Error('commit timeout ' + options.timeout);
        return real.apply(this, arguments);
      };
    `);
    const { json } = run(['finish', '--baseline', baseline], { expected: ['src'], message_title: 'task 1/2: a' });
    assert.equal(json.ok, true, JSON.stringify(json));
  });

  test('a git read that fails after finish\'s git add is refused, the user\'s staging put back', () => {
    const baseline = stagedOverWorktree();
    // Fails the first `git diff --cached` that runs after `git add`.
    withShim('fail-after-add.js', `
      const cp = require('child_process');
      const real = cp.execFileSync;
      let added = false;
      cp.execFileSync = function (file, args) {
        if (added && args[0] === 'diff' && args.includes('--cached')) {
          throw Object.assign(new Error('git diff failed'), { stderr: 'fatal: simulated diff failure' });
        }
        const out = real.apply(this, arguments);
        if (args[0] === 'add') added = true;
        return out;
      };
    `);
    const json = finishRefused(baseline);
    assert.equal(json.reason, 'staging_failed');
    assert.match(json.error, /simulated diff failure/);
    assert.equal(git('show', ':src/a.js'), 'staged a\n');
  });

  test('an index write that fails midway removes its own index.lock and reports nothing as unstaged', () => {
    const baseline = commitWith({ 'src/a.js': 'base a\n' });
    writeFile('src/a.js', 'worktree a\n');
    strayAfterStaging();
    // Writes one byte of the index copy, then fails as a full disk would.
    withShim('fail-index-write.js', `
      const fs = require('fs');
      const real = fs.writeFileSync;
      fs.writeFileSync = function (file, data) {
        if (typeof file === 'number' || String(file).endsWith('index.lock')) {
          real.call(this, file, Buffer.from(data).subarray(0, 1));
          throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
        }
        return real.apply(this, arguments);
      };
    `);
    const json = finishRefused(baseline);
    assert.equal(json.reason, 'unexpected_files');
    assert.match(json.restore_error, /ENOSPC/);
    assert.equal(fs.existsSync(path.join(project, '.git', 'index.lock')), false, 'later git commands still run');
    assert.deepEqual(json.left_staged, ['src/a.js']);
  });

  test('a commit of more paths than a Windows command line holds goes through', () => {
    const many = Array.from({ length: 700 }, (_, i) => `src/many/${'y'.repeat(44)}${String(i).padStart(3, '0')}.js`);
    const baseline = commitWith(Object.fromEntries(many.map((file) => [file, 'base\n'])));
    for (const file of many) writeFile(file, 'worktree\n');
    // Held bookkeeping makes the commit a pathspec commit of every path.
    writeRoadmap(project, [{ ...entry('001'), notes: 'flipped' }]);
    git('add', '--', 'ROADMAP.jsonl');
    const { json } = run(['finish', '--baseline', baseline], {
      expected: ['src'],
      message_title: 'task 1/2: many',
    });
    assert.equal(json.ok, true, JSON.stringify(json).slice(0, 500));
    assert.equal(json.files.length, many.length);
    assert.equal(git('diff', '--cached', '--name-only').trim(), 'ROADMAP.jsonl', 'the roadmap is still staged');
  });

  test('a commit landing between begin and finish is refused', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeFile('src/a.js', 'owned\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'someone else committed');

    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src'],
      message_title: 'do the thing',
    });

    assert.equal(json.ok, false);
    assert.equal(json.reason, 'head_moved_since_baseline');
    assert.equal(json.baseline, baseline);
    assert.notEqual(json.head, baseline);
  });
});

describe('safe-commit finish stages renames and deletions cleanly', () => {
  // [Foreman: 121] git mv/git rm leave the old path in neither tree, so
  // `git add` must never be asked about it -- only worktree-vs-index
  // differences need staging; an already-staged rename or deletion rides
  // into the commit as it sits.
  test('a staged rename (git mv) finishes and commits cleanly', () => {
    cleanRepo();
    writeFile('src/a.js', 'original\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'add src/a.js');
    const baseline = begin().baseline.head;
    git('mv', 'src/a.js', 'src/b.js');

    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src'],
      message_title: 'rename a to b',
    });

    assert.equal(json.ok, true, JSON.stringify(json));
    assert.deepEqual(json.files, ['src/a.js', 'src/b.js']);
    assert.equal(git('status', '--porcelain').trim(), '', 'the tree is clean afterwards');
    assert.equal(fs.existsSync(path.join(project, 'src', 'a.js')), false);
    assert.equal(fs.existsSync(path.join(project, 'src', 'b.js')), true);
  });

  test('a git rm finishes cleanly', () => {
    cleanRepo();
    writeFile('src/a.js', 'to be removed\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'add src/a.js');
    const baseline = begin().baseline.head;
    git('rm', '-q', 'src/a.js');

    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src'],
      message_title: 'remove a',
    });

    assert.equal(json.ok, true, JSON.stringify(json));
    assert.deepEqual(json.files, ['src/a.js']);
    assert.equal(git('status', '--porcelain').trim(), '', 'the tree is clean afterwards');
    assert.equal(fs.existsSync(path.join(project, 'src', 'a.js')), false);
  });

  test('an unstaged plain rename (delete + untracked add) still works', () => {
    cleanRepo();
    writeFile('src/a.js', 'to be moved\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'add src/a.js');
    const baseline = begin().baseline.head;
    fs.unlinkSync(path.join(project, 'src', 'a.js'));
    writeFile('src/b.js', 'to be moved\n');

    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src'],
      message_title: 'move a to b by hand',
    });

    assert.equal(json.ok, true, JSON.stringify(json));
    assert.deepEqual(json.files, ['src/a.js', 'src/b.js']);
    assert.equal(git('status', '--porcelain').trim(), '', 'the tree is clean afterwards');
  });

  test('a forced git add failure reports structured ok:false instead of throwing', (t) => {
    cleanRepo();
    const cp = require('node:child_process');
    const realExecFileSync = cp.execFileSync;
    t.mock.method(cp, 'execFileSync', (file, args, options) => {
      if (file === 'git' && Array.isArray(args) && args[0] === 'add') {
        const error = new Error("Command failed: git add -- src/a.js");
        error.stderr = "fatal: pathspec 'src/a.js' did not match any files\n";
        throw error;
      }
      return realExecFileSync(file, args, options);
    });

    // Everything else drives safe-commit.js through the CLI, so this is the
    // one place the mocked child_process reaches the module's own `git()`
    // helper, through scripts/run-git.js.
    const { beginUnit, finishUnit } = require('../scripts/safe-commit');
    const baseline = beginUnit(project).baseline.head;
    writeFile('src/a.js', 'owned\n');

    const result = finishUnit(project, {
      id: '001',
      expected: ['src'],
      baseline,
      message_title: 'do the thing',
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'staging_failed');
    assert.match(result.error, /did not match any files/);
    assert.equal(git('diff', '--cached', '--name-only').trim(), '', 'nothing was left staged');
  });
});

describe('safe-commit finish commit and attestation', () => {
  test('commits the owned set with the exact trailer and attests the boundary', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeFile('src/a.js', 'owned\n');

    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src'],
      message_title: 'Add the thing',
    });

    assert.equal(json.ok, true, JSON.stringify(json));
    assert.equal(json.committed, true);
    assert.deepEqual(json.files, ['src/a.js']);
    assert.equal(json.commit, git('rev-parse', 'HEAD').trim());
    assert.equal(json.attested.ok, true);
    assert.equal(json.attested.commit_count, 1);
    assert.deepEqual(json.attested.trailer_lines, ['Foreman: 001']);
    assert.deepEqual(json.attested.reasons, []);
    assert.equal(git('log', '-1', '--format=%B').trim(), 'Add the thing\n\nForeman: 001');
    assert.equal(git('status', '--porcelain').trim(), '', 'the tree is clean afterwards');
  });

  // [Foreman: 974] Inside the Codex sandbox a roadmap close of a git-ignored
  // roadmap still warns that the roadmap was not staged: roadmap.js
  // ignoredPaths runs `git check-ignore` through run-git.js, which falls back
  // to files. The warning is what this test proves; the commit and
  // attestation assertions only confirm the close still completes.
  test('a sandbox that refuses piped git output still warns that the ignored roadmap was not staged', () => {
    initGitRepo(project);
    writeFile('.gitignore', 'ROADMAP.jsonl\n');
    writeRoadmap(project, [entry('001')]);
    git('add', '-A');
    git('commit', '-q', '-m', 'baseline');
    refusePipes();
    const baseline = begin().baseline.head;
    writeFile('src/a.js', 'owned\n');

    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src'],
      message_title: 'Add the thing',
      roadmap_close: true,
    });

    assert.equal(json.ok, true, JSON.stringify(json));
    assert.equal(json.commit, git('rev-parse', 'HEAD').trim());
    assert.deepEqual(json.files, ['src/a.js']);
    assert.equal(json.attested.ok, true);
    assert.deepEqual(json.attested.trailer_lines, ['Foreman: 001']);
    assert.match(json.warnings?.[0] ?? '', /^git-ignored here, so not staged: ROADMAP\.jsonl\./, JSON.stringify(json));
  });

  test('a checkpoint with no entry id commits titled and trailer-free', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeFile('src/a.js', 'owned\n');

    const { json } = run(['finish', '--baseline', baseline], {
      expected: ['src'],
      message_title: 'task 1/3: the first slice',
    });

    assert.equal(json.ok, true, JSON.stringify(json));
    assert.deepEqual(json.attested.trailer_lines, []);
    assert.equal(git('log', '-1', '--format=%B').trim(), 'task 1/3: the first slice');
  });

  // [Foreman: 184] An undeclared ledger change is excluded, never staged: the
  // commit stays the task's alone, and the roadmap dirt waits in the tree for
  // the close that owns it. Declaring roadmap_close folds it in.
  test('an undeclared ROADMAP.jsonl change is left out; roadmap_close folds it in', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeFile('src/a.js', 'owned\n');
    writeRoadmap(project, [{ ...entry('001'), status: 'done' }]);

    const excluded = run(['finish', '--baseline', baseline, '--no-commit'], {
      id: '001',
      expected: ['src'],
    }).json;
    assert.equal(excluded.ok, true, JSON.stringify(excluded));
    assert.deepEqual(excluded.files, ['src/a.js']);
    assert.deepEqual(excluded.ledger_excluded, ['ROADMAP.jsonl']);
    const staged = git('diff', '--cached', '--name-only').trim();
    assert.equal(staged, 'src/a.js', 'the ledger is not staged');
    git('reset', '-q');

    const allowed = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src'],
      message_title: 'close it',
      roadmap_close: true,
    }).json;
    assert.equal(allowed.ok, true, JSON.stringify(allowed));
    assert.deepEqual(allowed.files, ['ROADMAP.jsonl', 'src/a.js']);
    assert.equal(allowed.ledger_excluded, undefined);
    assert.deepEqual(allowed.attested.forbidden_files, []);
  });

  // [Foreman: 1140] An increment checkpoint runs without roadmap_close; a
  // ROADMAP.jsonl already staged, by a staged close or by hand, stays staged
  // and out of the checkpoint commit, instead of reading as a stray file
  // whose refusal unstaged the whole index.
  test('a staged ROADMAP.jsonl survives a checkpoint and stays out of its commit', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeRoadmap(project, [{ ...entry('001'), notes: 'flipped' }]);
    git('add', '--', 'ROADMAP.jsonl');
    writeFile('src/a.js', 'owned\n');

    const dry = run(['finish', '--baseline', baseline, '--no-commit'], {
      expected: ['src'],
    }).json;
    assert.equal(dry.ok, true, JSON.stringify(dry));
    assert.deepEqual(dry.files, ['src/a.js']);
    git('reset', '-q', '--', 'src/a.js');

    const { json } = run(['finish', '--baseline', baseline], {
      expected: ['src'],
      message_title: 'task 1/2: first',
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.deepEqual(json.files, ['src/a.js']);
    assert.equal(git('diff', '--name-only', 'HEAD~1', 'HEAD').trim(), 'src/a.js');
    assert.equal(git('diff', '--cached', '--name-only').trim(), 'ROADMAP.jsonl', 'the roadmap is still staged');
  });

  // [Foreman: 196] ROADMAP.jsonl and .foreman/archive.jsonl are the only
  // files safe-commit itself treats as a shared ledger; a project's own
  // CHANGELOG.md is ordinary work here (see the changelog describe block
  // below).
  // [Foreman: 202] A shared ledger other than the declared roadmap close is
  // excluded from `changed` before anything is staged, in every mode -- it
  // never rides into the commit for post-commit attestation to catch.
  test('a shared ledger other than the declared roadmap close never reaches the commit', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeArchiveFile(project, []);

    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['.foreman/archive.jsonl'],
      message_title: 'touch the ledger',
      roadmap_close: true,
    });

    assert.equal(json.ok, false);
    assert.equal(json.reason, 'no_task_changes');
    assert.equal(git('rev-parse', 'HEAD').trim(), baseline, 'no commit was made');
  });

  test('archive dirt alongside a real change is excluded, not committed, even declared', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeFile('src/a.js', 'owned\n');
    writeRoadmap(project, [{ ...entry('001'), status: 'done' }]);
    writeArchiveFile(project, []);

    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src', '.foreman/archive.jsonl'],
      message_title: 'close it',
      roadmap_close: true,
    });

    assert.equal(json.ok, true, JSON.stringify(json));
    assert.deepEqual(json.files, ['ROADMAP.jsonl', 'src/a.js']);
    assert.deepEqual(json.ledger_excluded, ['.foreman/archive.jsonl']);
    assert.deepEqual(json.attested.forbidden_files, []);
    assert.equal(git('diff', '--name-only', 'HEAD~1', 'HEAD').trim().includes('archive'), false);
  });

  test('an undeclared expected surface is a usage error, not a wide-open stage', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeFile('src/a.js', 'owned\n');
    const { status, json } = run(['finish', '--baseline', baseline], {
      id: '001',
      message_title: 'x',
    });
    assert.equal(status, 1);
    assert.match(json.error, /`expected` must list at least one/);
  });
});

// [Foreman: 196] A project's own CHANGELOG.md is not one of Foreman's files:
// safe-commit stages and commits it like any other declared path, in every
// mode.
describe("safe-commit and the project's own changelog", () => {
  test('a declared root CHANGELOG.md commits cleanly and attestation agrees', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeFile('CHANGELOG.md', '# changelog\n');

    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['CHANGELOG.md'],
      message_title: 'note the change',
    });

    assert.equal(json.ok, true, JSON.stringify(json));
    assert.deepEqual(json.files, ['CHANGELOG.md']);
    assert.deepEqual(json.attested.forbidden_files, []);
    assert.equal(git('status', '--porcelain').trim(), '');
  });

  test('a declared root CHANGELOG.md also commits cleanly through roadmap_close', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeFile('CHANGELOG.md', '# changelog\n');
    writeRoadmap(project, [{ ...entry('001'), status: 'done' }]);

    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['CHANGELOG.md'],
      message_title: 'close it',
      roadmap_close: true,
    });

    assert.equal(json.ok, true, JSON.stringify(json));
    assert.deepEqual(json.files, ['CHANGELOG.md', 'ROADMAP.jsonl']);
    assert.deepEqual(json.attested.forbidden_files, []);
    assert.equal(git('status', '--porcelain').trim(), '');
  });

  test('a dirty root changelog alone is real dirt, not ledger-only dirt', () => {
    cleanRepo();
    writeFile('CHANGELOG.md', '# changelog\n');
    const json = begin();
    assert.equal(json.dirty, true);
    assert.equal(json.reason, 'working_tree_has_changes');
    assert.equal(json.baseline, undefined);
  });

  // [Foreman: 184] Regression check: narrowing isSharedLedger to Foreman's own
  // files must not accidentally drop the archive out of the carve-out too.
  // The archive is committed first, same as a real project's, so its dirt is
  // an ordinary tracked-file modification rather than a whole new untracked
  // directory (which `git status --porcelain` collapses to the directory
  // path and would not compare equal to the archive's own path).
  test('archive-only dirt still gets the ledger_dirty carve-out', () => {
    cleanRepo();
    writeArchiveFile(project, [{ ...entry('001'), status: 'done' }]);
    git('add', '.foreman/archive.jsonl');
    git('commit', '-q', '-m', 'archive baseline');
    writeArchiveFile(project, [{ ...entry('001'), status: 'done' }, { ...entry('002'), status: 'done' }]);
    const json = begin();
    assert.equal(json.ok, true);
    assert.equal(json.dirty, false);
    assert.deepEqual(json.ledger_dirty, ['.foreman/archive.jsonl']);
    assert.equal(json.baseline.head, git('rev-parse', 'HEAD').trim());
  });
});

// [Foreman: 202] An auto-migration (roadmap.js's migrateFile) writes
// `<file>.backup-<stamp>` as an untracked sibling right before the rewrite --
// on the exact turn it fires, that backup must not read as foreign dirt.
describe('safe-commit and an auto-migration backup mid-task', () => {
  /** A format-1 entry: one `touches` array, the shape every old roadmap has. */
  function v1Entry(id, overrides = {}) {
    return {
      id,
      title: `task ${id}`,
      why: 'w',
      what: 'x',
      status: 'planned',
      source: 'user',
      depends_on: [],
      touches: [],
      commits: [],
      created_at: '2026-07-01',
      updated_at: '2026-07-01',
      notes: '',
      ...overrides,
    };
  }

  function writeV1Roadmap(rows) {
    fs.writeFileSync(path.join(project, 'ROADMAP.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
  }

  function writeV1Archive(rows) {
    const dir = path.join(project, '.foreman');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'archive.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
  }

  function cleanV1Repo() {
    initGitRepo(project);
    writeV1Roadmap([v1Entry('001')]);
    writeV1Archive([v1Entry('002', { status: 'done', commits: ['a1'] })]);
    git('add', '-A');
    git('commit', '-q', '-m', 'v1 baseline');
  }

  function updateStatus(payload) {
    const r = runRoadmap(['update-status'], payload, env);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true, JSON.stringify(json));
    return json;
  }

  function backupsIn(dir, prefix) {
    return fs.readdirSync(dir).filter((name) => name.startsWith(prefix));
  }

  test('reproduces (a): begin still returns a baseline once auto-migration drops backups in the tree', () => {
    cleanV1Repo();
    // The entry's own in_progress flip -- ordinary flow, not a migrate call --
    // is what triggers migrateIfNeeded on both files in the same write.
    const updated = updateStatus({ id: '001', status: 'in_progress' });
    assert.equal(updated.migrated.from, 1);
    assert.equal(updated.migrated.archive.from, 1);

    const json = begin();
    assert.equal(json.ok, true);
    assert.equal(json.dirty, false, JSON.stringify(json));
    assert.equal(json.baseline.head, git('rev-parse', 'HEAD').trim());
    const names = [...json.ledger_dirty].sort();
    assert.equal(names.length, 4);
    assert.ok(names.includes('ROADMAP.jsonl'));
    assert.ok(names.includes('.foreman/archive.jsonl'));
    assert.ok(names.some((n) => /^ROADMAP\.jsonl\.backup-\d{8}-\d{6}$/.test(n)));
    assert.ok(names.some((n) => /^\.foreman\/archive\.jsonl\.backup-\d{8}-\d{6}$/.test(n)));
  });

  test('reproduces (b): a staged close commits cleanly with no backup staged', () => {
    cleanV1Repo();
    const baseline = begin().baseline.head;
    writeFile('src/a.js', 'owned\n');
    const staged = updateStatus({ id: '001', status: 'done', staged: true });
    assert.equal(staged.migrated.from, 1);
    assert.equal(backupsIn(project, 'ROADMAP.jsonl.backup-').length, 1);

    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src'],
      message_title: 'close it',
      roadmap_close: true,
    });

    assert.equal(json.ok, true, JSON.stringify(json));
    // [Foreman: 539] The staged close carries the migrated archive too, so the
    // commit holds both halves of the roadmap in the same format.
    assert.deepEqual(json.files, ['.foreman/archive.jsonl', 'ROADMAP.jsonl', 'src/a.js']);
    assert.ok(json.ledger_excluded.some((f) => f.startsWith('ROADMAP.jsonl.backup-')));
    assert.deepEqual(json.attested.forbidden_files, []);
    const backups = backupsIn(project, 'ROADMAP.jsonl.backup-');
    assert.equal(backups.length, 1, 'the backup is still on disk');
    assert.equal(git('status', '--porcelain', '--', backups[0]).trim()[0], '?', 'and stayed untracked, never staged');
  });
});

describe('the close and checkpoint choreography is documented without git add -A', () => {
  // [Foreman: 1120] With an entry paragraph, on every host, the boundary is
  // that paragraph's task.js start and its `next`; safe-commit begin stays for
  // a run without an entry, and the close is task.js finish, never a staged
  // close by hand.
  test('the template checkpoint section gates on task.js start with an entry, safe-commit begin without', () => {
    const section = TEMPLATE.slice(TEMPLATE.indexOf('## Checkpointing a task-split run'), TEMPLATE.indexOf('## When NOT to hand off'));
    const flat = section.replace(/\s+/g, ' ');
    assert.ok(flat.includes("With an entry paragraph, which a roadmap split always carries, the boundary is that paragraph's `task.js start` on every host (in Codex and Antigravity, after its `hooks/codex-task.js start` opens the entry); read its `next`."), 'an entry run takes the boundary through task.js start');
    assert.ok(flat.includes('Without an entry, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/safe-commit.js begin` and read its `dirty` field;'), 'an entry-less run keeps safe-commit begin');
    assert.ok(flat.includes('A `report_dirty` answer, or `dirty:true`, means **this run makes no automated commits at all**'), 'a dirty tree makes no checkpoint commits');
    assert.ok(flat.includes('On every host that paragraph runs `scripts/task.js`'), 'the roadmap close runs through task.js on every host');
    assert.ok(flat.includes('run `task.js start` again right after the previous checkpoint commit'), 'the last task takes a fresh boundary');
    assert.doesNotMatch(flat, /--no-commit|spells the same form out/, 'no host stages the close by hand');
    assert.ok(section.includes('Never `git add -A`'), 'and says so outright');
    assert.doesNotMatch(section, /`git add -A`,? (and|then) commit/, 'nothing here stages everything and commits it');
    assert.doesNotMatch(section, /stage everything/, 'nor stages everything for the roadmap close');
    assert.doesNotMatch(section, /will ride along/, 'the warn-and-absorb sentence is gone');
  });

  test('the clipboard checkpoint embed stages narrowly too', () => {
    const embed = TEMPLATE.slice(
      TEMPLATE.indexOf('**Clipboard checkpoint embed**'),
      TEMPLATE.indexOf('## Splitting an `Execute here` handoff')
    );
    assert.ok(embed.includes('never `git add -A`'));
    assert.doesNotMatch(embed, /`git add -A` and commit/);
    // [Foreman: 1120] The embed reads task.js start on both hosts and closes
    // through task.js finish, as craft-handoff.js writes it.
    const flat = embed.replace(/\s+/g, ' ');
    assert.ok(flat.includes("with an entry paragraph, from its `task.js start` on every host (`report_dirty` is a dirty run; Foreman's own roadmap bookkeeping never counts)"), flat);
    assert.ok(flat.includes("on every host, run the paragraph's `task.js start` again for a fresh boundary right after the previous task's checkpoint commit"), flat);
    assert.doesNotMatch(flat, /safe-commit\.js begin|--no-commit|staged:true/);
  });

  // craft-handoff.js writes the embed the template section describes, in the
  // form each host's pasted session can follow.
  for (const host of HOSTS) {
    test(`checkpointEmbedText stages narrowly on host ${host}`, () => {
      const embed = checkpointEmbedText({ baseBranch: 'main', branch: true, onFinish: 'ask' }, 2, '001', false, false, host);
      assert.ok(embed.includes('never `git add -A`'));
      assert.doesNotMatch(embed, /`git add -A` and commit/);
      // [Foreman: 1113] Both hosts close through task.js finish, which stages
      // through the primitive (tests/task.test.js).
      assert.ok(embed.includes(host === 'claude'
        ? "send the close JSON to its `then` through a quoted heredoc, as the entry paragraph shows, which stages the task's files"
        : "pipe the close JSON into the close command with that fresh baseline, as the entry paragraph shows, which stages the task's files"), embed);
      assert.doesNotMatch(embed, /--no-commit|staged:true/);
    });
  }

  // An entry opens before task 1 and rewrites ROADMAP.jsonl, so a pasted run
  // with an entry gates its checkpoint commits on safe-commit begin's `dirty`
  // field; an entry-less run writes no bookkeeping and keeps plain porcelain.
  for (const host of HOSTS) {
    test(`the clipboard embed reads safe-commit begin only when an entry opens first, on host ${host}`, () => {
      const cfg = { baseBranch: 'main', branch: true, onFinish: 'ask' };
      const withEntry = checkpointEmbedText(cfg, 2, '001', false, false, host);
      assert.match(withEntry, host === 'claude'
        ? /before task 1, run the entry paragraph's `task\.js start` and read its `next` \(Foreman's own roadmap bookkeeping never counts\); with `report_dirty`, say so once and make no checkpoint commits at all/
        : /before task 1, run the entry paragraph's `scripts\/task\.js start` and read its `next` \(Foreman's own roadmap bookkeeping never counts\); with `report_dirty`, preserve existing changes and continue the work without checkpoint commits/);
      assert.doesNotMatch(withEntry, /git status --porcelain/);
      const withoutEntry = checkpointEmbedText(cfg, 2, null, false, false, host);
      assert.match(withoutEntry, /before task 1, (?:check|inspect) `git status --porcelain`/);
      assert.doesNotMatch(withoutEntry, /safe-commit\.js begin/);
    });
  }

  // entry 203: the embedded entry paragraph moved into craft-handoff.js's
  // entryParagraphText (skills/roadmap/pick.md now only calls the script),
  // so this pins the primitive-not-git-add-A guarantee at its new home.
  // [Foreman: 107] Each host runs its own command form: Claude Code the literal
  // ${CLAUDE_PLUGIN_ROOT} path, Codex the quoted installed script.
  const SAFE_COMMIT_COMMAND = {
    claude: 'node ${CLAUDE_PLUGIN_ROOT}/scripts/safe-commit.js',
    codex: `node '${path.resolve(SCRIPTS_DIR, 'safe-commit.js').replace(/\\/g, '/')}'`,
  };
  for (const host of HOSTS) {
    test(`the entry paragraph (craft-handoff.js) uses the primitive, not git add -A, on host ${host}`, () => {
      const paragraph = entryParagraphText({
        id: '001',
        resume: false,
        requireVerification: true,
        decisionLogEnabled: false,
        isDecision: false,
        destination: 'clipboard',
        host,
      });
      const command = SAFE_COMMIT_COMMAND[host];
      if (host === 'claude') {
        // [Foreman: 1078] task.js start takes the boundary and task.js finish
        // stages through the primitive (tests/task.test.js).
        assert.ok(paragraph.includes('`node ${CLAUDE_PLUGIN_ROOT}/scripts/task.js start --id 001`'), paragraph);
        assert.ok(!paragraph.includes(command), paragraph);
      } else {
        // [Foreman: 1113] The same two task.js calls, as quoted installed paths.
        const task = `node '${path.resolve(SCRIPTS_DIR, 'task.js').replace(/\\/g, '/')}'`;
        assert.ok(paragraph.includes(`${task} start --id '001'`), paragraph);
        assert.ok(paragraph.includes(`${task} finish --id '001' --baseline <baseline>`), paragraph);
        assert.ok(!paragraph.includes(command), paragraph);
      }
      assert.ok(paragraph.includes('never `git add -A`'));
      assert.doesNotMatch(paragraph, /stage everything \(`git add -A`\)/);
      const other = SAFE_COMMIT_COMMAND[HOSTS.find((h) => h !== host)];
      assert.ok(!paragraph.includes(other), `host ${host} emitted the other host's command form`);
    });
  }
});
