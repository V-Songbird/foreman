'use strict';

// Tests for scripts/note-staleness.js — how stale a lesson-ledger record is at
// the moment it is about to be served — and for the `notes` pull command.
//
// Covers:
//   - every fail-soft path lands on "unknown", never on "fresh"
//   - a record whose every stored file is gone is dropped, not labelled
//   - a commit anchor that no longer resolves falls through to the entry's
//     trailer, which is what a rebase leaves behind
//   - the git budget is a ceiling for the whole pass, not per record
//   - the pull command's area cap, its overflow line, and its filters

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');

const { runRoadmap, makeTmpProject, writeRoadmap, initGitRepo, commitFile, SCRIPTS_DIR } = require('./helpers.js');
const staleness = require(path.join(SCRIPTS_DIR, 'note-staleness.js'));
const ledger = require(path.join(SCRIPTS_DIR, 'ledger.js'));
const { today } = require(path.join(SCRIPTS_DIR, 'roadmap.js'));

function record(overrides = {}) {
  return {
    area: 'src/auth',
    paths: ['src/auth/session.js'],
    entry: '001',
    anchor: { kind: 'entry' },
    date: '2026-08-01',
    lesson: 'refresh() owns the token clock',
    ...overrides,
  };
}

describe('note staleness', () => {
  test('a record whose every file is gone is dead, and never labelled', () => {
    const project = makeTmpProject();
    const verdict = staleness.resolve(project, record());
    assert.equal(verdict.state, 'dead');
    assert.equal(verdict.label, null);
  });

  test('no git at all is unknown, never fresh', () => {
    const project = makeTmpProject();
    fs.mkdirSync(path.join(project, 'src', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(project, 'src', 'auth', 'session.js'), 'x', 'utf-8');
    const verdict = staleness.resolve(project, record({ anchor: { kind: 'commit', sha: 'deadbee' } }));
    assert.equal(verdict.state, 'unknown');
    assert.match(verdict.label, /anchor unresolvable, staleness unknown/);
  });

  test('an untouched file since the anchor reads fresh, with the sha in the label', () => {
    const project = makeTmpProject();
    initGitRepo(project);
    const sha = commitFile(project, 'src/auth/session.js', 'const refresh = () => 1;\n');
    commitFile(project, 'src/other.js', 'module.exports = 1;\n');
    const verdict = staleness.resolve(project, record({ anchor: { kind: 'commit', sha } }));
    assert.equal(verdict.state, 'fresh');
    assert.equal(verdict.label, `[entry 001, 2026-08-01, at ${sha} — unchanged since]`);
  });

  test('a changed file reads possibly stale and counts how many', () => {
    const project = makeTmpProject();
    initGitRepo(project);
    commitFile(project, 'src/auth/clock.js', 'module.exports = Date;\n');
    const sha = commitFile(project, 'src/auth/session.js', 'const refresh = () => 1;\n');
    commitFile(project, 'src/auth/session.js', 'const refresh = () => 2;\n');
    const verdict = staleness.resolve(project, record({
      anchor: { kind: 'commit', sha },
      paths: ['src/auth/session.js', 'src/auth/clock.js'],
    }));
    assert.equal(verdict.state, 'stale');
    assert.match(verdict.label, /possibly stale: 1 of its 2 files changed since/);
  });

  test('a commit anchor a rebase destroyed falls through to the entry trailer', () => {
    const project = makeTmpProject();
    initGitRepo(project);
    commitFile(project, 'src/auth/session.js', 'const refresh = () => 1;\n');
    // A commit whose message names the entry is what a staged close leaves.
    fs.writeFileSync(path.join(project, 'src', 'auth', 'clock.js'), 'module.exports = Date;\n', 'utf-8');
    spawnSync('git', ['add', 'src/auth/clock.js'], { cwd: project });
    spawnSync('git', ['commit', '-q', '-m', 'clock helper\n\nForeman: 001'], { cwd: project });

    const verdict = staleness.resolve(project, record({
      anchor: { kind: 'commit', sha: 'deadbee' },
      paths: ['src/auth/clock.js'],
    }));
    assert.notEqual(verdict.state, 'unknown');
    assert.ok(verdict.sha, 'the trailer commit is what dated it');
  });

  test('the budget is a ceiling for the whole pass, not per record', () => {
    const project = makeTmpProject();
    initGitRepo(project);
    const sha = commitFile(project, 'src/auth/session.js', 'const refresh = () => 1;\n');
    const budget = staleness.newBudget(1);
    const rows = staleness.resolveAll(
      project,
      [record({ anchor: { kind: 'commit', sha } }), record({ anchor: { kind: 'commit', sha } })],
      budget
    );
    assert.equal(rows.length, 2, 'past the budget a record still serves, without a claim');
    assert.equal(rows[0].state, 'fresh');
    assert.equal(rows[1].state, 'unknown');
    assert.equal(budget.spent, 1);
  });
});

describe('the notes pull command', () => {
  function project() {
    const root = makeTmpProject();
    writeRoadmap(root, []);
    return root;
  }

  function notes(root, argv = []) {
    const result = runRoadmap(['notes', ...argv], null, { CLAUDE_PROJECT_DIR: root });
    return JSON.parse(result.stdout);
  }

  function seed(root, count, prefix = 'src') {
    for (let i = 0; i < count; i += 1) {
      const file = `${prefix}/area-${i}/thing.js`;
      fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), 'x', 'utf-8');
      ledger.append(root, {
        lesson: `lesson ${i}`,
        paths: [file],
        entry: String(100 + i),
        anchor: { kind: 'entry' },
        date: today(),
      });
    }
  }

  test('an empty store answers with nothing rather than an error', () => {
    const out = notes(project());
    assert.equal(out.ok, true);
    assert.deepEqual(out.records, []);
  });

  test('an unfiltered call serves at most 10 areas and counts the rest', () => {
    const root = project();
    seed(root, 13);
    const out = notes(root);
    assert.equal(out.areas.length, 10);
    assert.match(out.overflow, /\+3 more areas — filter with --area or --paths/);
  });

  test('--paths narrows to the records that overlap them', () => {
    const root = project();
    seed(root, 13);
    const out = notes(root, ['--paths', 'src/area-4/thing.js']);
    assert.equal(out.records.length, 1);
    assert.equal(out.records[0].entry, '104');
    assert.equal(out.overflow, undefined, 'a filtered call has already named its own bound');
  });

  test('--area narrows by the stored area key', () => {
    const root = project();
    seed(root, 2, 'src');
    seed(root, 2, 'docs');
    const out = notes(root, ['--area', 'docs']);
    assert.ok(out.records.length > 0);
    assert.ok(out.records.every((r) => r.area.startsWith('docs')));
  });

  test('records come back newest first, so a correction serves above what it corrects', () => {
    const root = project();
    fs.mkdirSync(path.join(root, 'src', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'auth', 'session.js'), 'x', 'utf-8');
    for (const [entry, lesson] of [['001', 'the wrong claim'], ['002', 'the correction']]) {
      ledger.append(root, {
        lesson,
        paths: ['src/auth/session.js'],
        entry,
        anchor: { kind: 'entry' },
        date: today(),
      });
    }
    const out = notes(root, ['--paths', 'src/auth/session.js']);
    assert.equal(out.records[0].lesson, 'the correction');
  });

  test('a store that will not parse names the reason and serves nothing', () => {
    const root = project();
    fs.mkdirSync(path.join(root, '.foreman'), { recursive: true });
    fs.writeFileSync(ledger.notesPath(root), '<<<<<<< HEAD\n', 'utf-8');
    const out = notes(root);
    assert.equal(out.error_code, 'conflict');
    assert.deepEqual(out.records, []);
  });

  test('a record whose files are all gone never reaches the output', () => {
    const root = project();
    ledger.append(root, {
      lesson: 'about a file that no longer exists',
      paths: ['src/deleted/gone.js'],
      entry: '001',
      anchor: { kind: 'entry' },
      date: today(),
    });
    assert.deepEqual(notes(root).records, []);
  });
});
