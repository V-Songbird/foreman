'use strict';

// [Foreman: 134] One interpreter for entry-to-commit facts. These tests pin
// the two things that used to differ between views: where a sha is looked up
// (project repo AND submodules, not just the root), and which trailer grammar
// answers "does this commit name that entry".

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  makeTmpProject,
  writeRoadmap,
  initGitRepo,
  commitFile,
  runRoadmap,
} = require('./helpers');
const {
  resolveSha,
  recordedCommits,
  trailerShasFor,
  trailerLinesIn,
  hasExactTrailer,
  evidenceSummary,
  showCommits,
} = require('../scripts/commit-evidence');
const { trailerIdsIn } = require('../scripts/roadmap');

let project;

function entry(id, extra) {
  return {
    id,
    title: `Task ${id}`,
    why: `Task ${id} matters`,
    what: `Implement task ${id}`,
    status: 'planned',
    source: 'user',
    depends_on: [],
    touches: [],
    commits: [],
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    notes: '',
    ...extra,
  };
}

function run(argv, stdin) {
  const result = runRoadmap(argv, stdin, { CLAUDE_PROJECT_DIR: project });
  return { status: result.status, json: JSON.parse(result.stdout) };
}

/** Commit with an explicit message, in `cwd`. Returns the short sha. */
function commitWithMessage(cwd, relPath, content, message) {
  const full = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  spawnSync('git', ['add', relPath], { cwd });
  spawnSync('git', ['commit', '-q', '-m', message], { cwd });
  return spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf-8' }).stdout.trim();
}

/**
 * A submodule the way the lookup actually finds one: `.gitmodules` names the
 * path and a real git repo sits there. Deliberately NOT registered with
 * `git submodule add` — the walk reads the file, so an uninitialized or
 * hand-written .gitmodules resolves exactly the same.
 */
function addSubmodule(root, name) {
  fs.appendFileSync(
    path.join(root, '.gitmodules'),
    `[submodule "${name}"]\n\tpath = ${name}\n\turl = ./${name}\n`,
    'utf-8'
  );
  const sub = path.join(root, name);
  fs.mkdirSync(sub, { recursive: true });
  initGitRepo(sub);
  return sub;
}

beforeEach(() => {
  project = makeTmpProject();
});

// [Foreman: 287] Which entries shaped a function, straight from `git log -L`
// and the trailers staged closes already write.
describe('symbol shapers', () => {
  const { symbolShapers } = require('../scripts/commit-evidence');
  const ALPHA_V1 = 'function alpha() {\n  return 1;\n}\n';
  const ALPHA_V2 = 'function alpha() {\n  return 2;\n}\n';

  test('lists the commits that shaped a function, newest first, with their trailer ids', () => {
    initGitRepo(project);
    commitWithMessage(project, 'src/alpha.js', ALPHA_V1, 'Create alpha\n\nForeman: 041');
    commitWithMessage(project, 'src/alpha.js', ALPHA_V2, 'Harden alpha\n\nForeman: 042');
    commitWithMessage(project, 'src/other.js', 'module.exports = 1;\n', 'Unrelated\n\nForeman: 043');

    const shapers = symbolShapers(project, 'src/alpha.js', 'alpha');
    assert.deepEqual(shapers.map((s) => s.ids), [['042'], ['041']]);
    for (const s of shapers) assert.match(s.sha, /^[0-9a-f]{7,}$/);
  });

  test('a commit with no trailer still counts, with no ids', () => {
    initGitRepo(project);
    commitWithMessage(project, 'src/alpha.js', ALPHA_V1, 'Create alpha');
    assert.deepEqual(symbolShapers(project, 'src/alpha.js', 'alpha'), [{ sha: symbolShapers(project, 'src/alpha.js', 'alpha')[0].sha, ids: [] }]);
  });

  test('a longer name that merely starts with the symbol is not the symbol', () => {
    initGitRepo(project);
    commitWithMessage(project, 'src/alpha.js', 'function alphaBeta() {}\n', 'Create alphaBeta\n\nForeman: 041');
    commitWithMessage(project, 'src/alpha.js', 'function alphaBeta() {}\nfunction alpha() {}\n', 'Create alpha\n\nForeman: 042');
    const shapers = symbolShapers(project, 'src/alpha.js', 'alpha');
    assert.deepEqual(shapers.map((s) => s.ids), [['042']]);
  });

  test('a symbol git finds no definition line for is null, never a throw', () => {
    initGitRepo(project);
    commitWithMessage(project, 'src/alpha.js', ALPHA_V1, 'Create alpha\n\nForeman: 041');
    assert.equal(symbolShapers(project, 'src/alpha.js', 'omega'), null);
  });

  test('a name that is not identifier-shaped is refused before git is asked', () => {
    initGitRepo(project);
    commitWithMessage(project, 'src/alpha.js', ALPHA_V1, 'Create alpha\n\nForeman: 041');
    assert.equal(symbolShapers(project, 'src/alpha.js', 'alpha|.*'), null);
    assert.equal(symbolShapers(project, 'src/alpha.js', ''), null);
  });

  test('no git at all is null', () => {
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.writeFileSync(path.join(project, 'src', 'alpha.js'), ALPHA_V1, 'utf-8');
    assert.equal(symbolShapers(project, 'src/alpha.js', 'alpha'), null);
  });

  test('a file inside a declared submodule is asked in that submodule, prefix stripped', () => {
    const sub = addSubmodule(project, 'inner');
    commitWithMessage(sub, 'lib.js', 'function beta() {}\n', 'Add beta\n\nForeman: 044');
    const shapers = symbolShapers(project, 'inner/lib.js', 'beta');
    assert.deepEqual(shapers.map((s) => s.ids), [['044']]);
  });
});

describe('recorded sha resolution', () => {
  test('a sha committed in the project repo resolves to its full form', () => {
    initGitRepo(project);
    const short = commitFile(project, 'src/a.js', 'a');

    const fact = resolveSha(project, short);

    assert.equal(fact.exists, true);
    assert.equal(fact.sha, short);
    assert.match(fact.full, /^[0-9a-f]{40}$/);
    assert.equal(fact.in_submodule, undefined);
  });

  test('a short sha and the full sha it abbreviates are one fact', () => {
    initGitRepo(project);
    const short = commitFile(project, 'src/a.js', 'a');
    const full = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf-8' }).stdout.trim();

    assert.equal(resolveSha(project, short).full, full);
    assert.equal(resolveSha(project, full).full, full);
  });

  test('an unknown sha is unresolved, not a throw', () => {
    initGitRepo(project);
    commitFile(project, 'src/a.js', 'a');

    const fact = resolveSha(project, 'deadbee');

    assert.equal(fact.exists, false);
    assert.equal(fact.full, undefined);
  });

  test('a project with no git at all leaves every sha unresolved, silently', () => {
    const fact = resolveSha(project, 'a1b2c3d');

    assert.equal(fact.exists, false);
    assert.equal(fact.sha, 'a1b2c3d');
  });

  test('a value that is not a sha shape is unresolved without asking git', () => {
    initGitRepo(project);
    commitFile(project, 'src/a.js', 'a');

    assert.equal(resolveSha(project, 'HEAD').exists, false);
    assert.equal(resolveSha(project, '').exists, false);
    assert.equal(resolveSha(project, null).exists, false);
  });
});

describe('submodule-hosted commits', () => {
  test('a commit living in a submodule resolves, and says which one', () => {
    initGitRepo(project);
    commitFile(project, 'root.js', 'root');
    const sub = addSubmodule(project, 'lib');
    const short = commitFile(sub, 'inner.js', 'inner');

    // The root repo cannot see it at all — that is the whole bug.
    const atRoot = spawnSync('git', ['cat-file', '-e', short], { cwd: project });
    assert.notEqual(atRoot.status, 0);

    const fact = resolveSha(project, short);
    assert.equal(fact.exists, true);
    assert.equal(fact.in_submodule, 'lib');
    assert.match(fact.full, /^[0-9a-f]{40}$/);
  });

  test('a trailer commit inside a submodule is found by the entry it names', () => {
    initGitRepo(project);
    commitFile(project, 'root.js', 'root');
    const sub = addSubmodule(project, 'lib');
    const short = commitWithMessage(sub, 'inner.js', 'inner', 'Do the thing\n\nForeman: 042');

    assert.deepEqual(trailerShasFor(project, '042'), [short]);
    assert.deepEqual(trailerShasFor(project, '043'), []);
  });

  test('a submodule commit is shown, so an anchor in it is auditable', () => {
    initGitRepo(project);
    commitFile(project, 'root.js', 'root');
    const sub = addSubmodule(project, 'lib');
    const short = commitFile(sub, 'inner.js', '// [Foreman: 042]\nmodule.exports = 1;\n');

    const patch = showCommits(project, [short]);
    assert.match(patch, /\[Foreman: 042\]/);
  });

  test('shas nothing can show come back null rather than empty text', () => {
    initGitRepo(project);
    commitFile(project, 'root.js', 'root');

    assert.equal(showCommits(project, ['deadbee']), null);
  });
});

describe('one trailer grammar', () => {
  test('the module resolves exactly the ids trailerIdsIn parses', () => {
    initGitRepo(project);
    const short = commitWithMessage(project, 'a.js', 'a', 'Close two\n\nForeman: 041, 042');

    assert.deepEqual(trailerIdsIn('Close two\n\nForeman: 041, 042'), ['041', '042']);
    assert.deepEqual(trailerShasFor(project, '041'), [short]);
    assert.deepEqual(trailerShasFor(project, '042'), [short]);
  });

  test('the strict reading is narrower than the general one, deliberately', () => {
    const multi = 'Close two\n\nForeman: 041, 042';
    const single = 'Close one\n\nForeman: 041';

    // General parsing accepts a multi-id trailer...
    assert.deepEqual(trailerIdsIn(multi), ['041', '042']);
    // ...an attested unit commit does not: one line, one id, this entry.
    assert.equal(hasExactTrailer(multi, '041'), false);
    assert.equal(hasExactTrailer(single, '041'), true);
    assert.equal(hasExactTrailer(single, '042'), false);
    assert.equal(hasExactTrailer(`${single}\nForeman: 042`, '041'), false);
  });

  test('trailer lines are counted even when they parse to no id', () => {
    assert.deepEqual(trailerLinesIn('x\n\nForeman: nonsense'), ['Foreman: nonsense']);
    assert.deepEqual(trailerIdsIn('x\n\nForeman: nonsense'), []);
    assert.deepEqual(trailerLinesIn(''), []);
  });

  test('no repo to read at all is null, not an empty answer', () => {
    assert.equal(trailerShasFor(project, '042'), null);
  });
});

describe('recordedCommits — the one reading of commits[]', () => {
  test('keeps non-empty strings and trims them, ignores everything else', () => {
    assert.deepEqual(recordedCommits({ commits: [' a1b2c3d ', '', null, 7, 'deadbee'] }), [
      'a1b2c3d',
      'deadbee',
    ]);
    assert.deepEqual(recordedCommits({}), []);
    assert.deepEqual(recordedCommits(undefined), []);
  });
});

describe('evidenceSummary', () => {
  test('counts recorded shas, resolves what it can, names what it cannot', () => {
    initGitRepo(project);
    const short = commitFile(project, 'a.js', 'a');

    const summary = evidenceSummary(project, entry('001', {
      status: 'done',
      commits: [short, 'deadbee'],
    }));

    assert.equal(summary.commit_count, 2);
    assert.equal(summary.resolved_count, 1);
    assert.deepEqual(summary.unresolved, ['deadbee']);
    assert.equal(summary.has_trailer_match, false);
  });

  test('a staged close records no sha and is still evidenced by its trailer', () => {
    initGitRepo(project);
    commitWithMessage(project, 'a.js', 'a', 'Close it\n\nForeman: 001');

    const summary = evidenceSummary(project, entry('001', { status: 'done', commits: [] }));

    assert.equal(summary.commit_count, 0);
    assert.equal(summary.resolved_count, 0);
    assert.deepEqual(summary.unresolved, []);
    assert.equal(summary.has_trailer_match, true);
  });

  test('git absent leaves facts unresolved without throwing', () => {
    const summary = evidenceSummary(project, entry('001', { status: 'done', commits: ['a1b2c3d'] }));

    assert.equal(summary.commit_count, 1);
    assert.equal(summary.resolved_count, 0);
    assert.deepEqual(summary.unresolved, ['a1b2c3d']);
    assert.equal(summary.has_trailer_match, false);
  });
});

describe('list --ids reports the summary', () => {
  test('a targeted row carries commit_evidence for finished work', () => {
    initGitRepo(project);
    const short = commitFile(project, 'a.js', 'a');
    writeRoadmap(project, [entry('001', { status: 'done', commits: [short], notes: 'shipped' })]);

    const row = run(['list', '--ids', '001']).json.entries[0];

    assert.deepEqual(row.commit_evidence, {
      commit_count: 1,
      resolved_count: 1,
      unresolved: [],
      has_trailer_match: false,
    });
  });

  test('a submodule-hosted commit resolves through the targeted row', () => {
    initGitRepo(project);
    commitFile(project, 'root.js', 'root');
    const sub = addSubmodule(project, 'lib');
    const short = commitFile(sub, 'inner.js', 'inner');
    writeRoadmap(project, [entry('001', { status: 'done', commits: [short] })]);

    const row = run(['list', '--ids', '001']).json.entries[0];

    assert.equal(row.commit_evidence.resolved_count, 1);
    assert.deepEqual(row.commit_evidence.unresolved, []);
  });

  test('a planned entry with nothing recorded reports nothing — no new chatter', () => {
    initGitRepo(project);
    commitFile(project, 'a.js', 'a');
    writeRoadmap(project, [entry('001'), entry('002', { status: 'awaiting_acceptance' })]);

    const { entries } = run(['list', '--ids', '001,002']).json;

    assert.equal(entries.find((e) => e.id === '001').commit_evidence, undefined);
    assert.equal(entries.find((e) => e.id === '002').commit_evidence.commit_count, 0);
  });

  test('the whole-roadmap and --summary views are unchanged', () => {
    initGitRepo(project);
    const short = commitFile(project, 'a.js', 'a');
    writeRoadmap(project, [entry('001', { status: 'done', commits: [short] })]);

    assert.equal(run(['list']).json.entries[0].commit_evidence, undefined);
    assert.equal(run(['list', '--summary']).json.entries[0].commit_evidence, undefined);
  });
});

describe('doctor evidence findings are unchanged', () => {
  test('recorded commits count as evidence even when git cannot resolve them', () => {
    writeRoadmap(project, [
      // A full sha from a repo this checkout does not have — the live corpus
      // shape for a commit that landed in a submodule.
      entry('001', { status: 'done', commits: ['c7a444d4804778e4f75fbb94874a56a0c90238cf'] }),
      // A staged close: no sha, notes carry the record.
      entry('002', { status: 'done', commits: [], notes: 'closed inside its own commit' }),
      // Nothing at all — the one case that warns.
      entry('003', { status: 'done', commits: [], notes: '' }),
      entry('004', { status: 'awaiting_acceptance', commits: [], notes: '' }),
    ]);

    const { json } = run(['doctor']);
    const codes = json.findings
      .filter((f) => f.code === 'terminal_without_evidence' || f.code === 'awaiting_without_evidence')
      .map((f) => [f.code, f.ids[0]]);

    assert.deepEqual(codes, [
      ['terminal_without_evidence', '003'],
      ['awaiting_without_evidence', '004'],
    ]);
    assert.equal(json.summary.errors, 0);
  });
});
