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

const { makeTmpProject, writeRoadmap, initGitRepo, runNodeScript, SCRIPTS_DIR } = require('./helpers');

const SAFE_COMMIT = path.join(SCRIPTS_DIR, 'safe-commit.js');
const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'prompt-template.md'), 'utf-8');
const ROADMAP_SKILL = fs.readFileSync(path.join(__dirname, '..', 'skills', 'roadmap', 'SKILL.md'), 'utf-8');

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

  test('without a baseline, finish refuses outright', () => {
    cleanRepo();
    const { status, json } = run(['finish'], { id: '001', expected: ['src'], message_title: 'x' });
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /--baseline must name the commit/);
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

  test('a staged ROADMAP.jsonl is unexpected unless roadmap_close says so', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeFile('src/a.js', 'owned\n');
    writeRoadmap(project, [{ ...entry('001'), status: 'done' }]);

    const refused = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src'],
      message_title: 'close it',
    }).json;
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, 'unexpected_files');
    assert.deepEqual(refused.unexpected_files, ['ROADMAP.jsonl']);

    const allowed = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['src'],
      message_title: 'close it',
      roadmap_close: true,
    }).json;
    assert.equal(allowed.ok, true, JSON.stringify(allowed));
    assert.deepEqual(allowed.files, ['ROADMAP.jsonl', 'src/a.js']);
    assert.deepEqual(allowed.attested.forbidden_files, []);
  });

  test('a shared ledger other than the declared roadmap close is still forbidden', () => {
    cleanRepo();
    const baseline = begin().baseline.head;
    writeFile('CHANGELOG.md', '# changelog\n');

    const { json } = run(['finish', '--baseline', baseline], {
      id: '001',
      expected: ['CHANGELOG.md'],
      message_title: 'touch the ledger',
      roadmap_close: true,
    });

    assert.equal(json.ok, false);
    assert.equal(json.reason, 'post_commit_attestation_failed');
    assert.deepEqual(json.attested.forbidden_files, ['CHANGELOG.md']);
    assert.ok(json.attested.reasons.includes('shared_ledger_committed'));
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

describe('the close and checkpoint choreography is documented without git add -A', () => {
  test('the template checkpoint section gates on safe-commit begin', () => {
    const section = TEMPLATE.slice(TEMPLATE.indexOf('## Checkpointing a task-split run'));
    assert.ok(section.includes('scripts/safe-commit.js begin'), 'checkpoints take the boundary first');
    assert.ok(section.includes('this run makes no automated commits at\n  all'), 'a dirty tree makes no checkpoint commits');
    assert.ok(section.includes('safe-commit.js finish --no-commit'), 'the roadmap close stages through the primitive');
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
  });

  test('the roadmap skill close paragraph uses the primitive, not git add -A', () => {
    const paragraph = ROADMAP_SKILL.slice(
      ROADMAP_SKILL.indexOf('This task is ROADMAP.jsonl entry'),
      ROADMAP_SKILL.indexOf('**Baking in the model**')
    );
    assert.ok(paragraph.includes('scripts/safe-commit.js begin'));
    assert.ok(paragraph.includes('safe-commit.js finish --baseline <baseline.head> --no-commit'));
    assert.ok(paragraph.includes('never `git add -A`'));
    assert.doesNotMatch(paragraph, /stage everything \(`git add -A`\)/);
  });
});
