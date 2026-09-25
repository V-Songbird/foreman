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

  // [Foreman: 681] A record stored before update-status refused hidden
  // characters, or edited by hand, is served nowhere.
  test('a record carrying a character a reader cannot see is never served', () => {
    const zwsp = String.fromCodePoint(0x200b);
    const fresh = { state: 'fresh', changed: [] };
    const unknown = { state: 'unknown', changed: [] };
    assert.equal(staleness.servedBody(record(), fresh), 'refresh() owns the token clock');
    assert.equal(staleness.servedBody(record({ lesson: `refresh()${zwsp} owns the token clock` }), fresh), null);
    assert.equal(staleness.servedBody(record({ lesson: `refresh()${zwsp} owns the token clock` }), unknown), null);
    assert.equal(staleness.servedBody(record({ paths: [`src/auth/session${zwsp}.js`] }), fresh), null);
    assert.equal(staleness.servedBody(record({ entry: `001${zwsp}` }), fresh), null);
    assert.equal(staleness.servedBody(record({ date: `2026-08-01${zwsp}` }), fresh), null);
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

  // [Foreman: 723] Survey hands this output to a model, so a record that
  // servedBody (681) serves nowhere prints its key and code points, never its
  // text, the way doctor (700) names it.
  test('a record carrying a character a reader cannot see prints its key and code points, never its text', () => {
    const root = project();
    const zwsp = String.fromCodePoint(0x200b);
    const rlo = String.fromCodePoint(0x202e);
    for (const file of ['src/auth/session.js', 'src/auth/token.js']) {
      fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), 'x', 'utf-8');
    }
    const clean = record({ entry: '001', paths: ['src/auth/session.js'], date: today() });
    const badLesson = record({ entry: '002', lesson: `use the ${zwsp}cache`, date: today() });
    const badPath = record({ entry: '003', paths: ['src/auth/token.js', `src/auth/${rlo}x.js`], date: today() });
    // [Foreman: 728] The area is a path prefix and prints on a withheld record too.
    const badArea = record({ entry: '004', area: `src/${zwsp}auth`, paths: ['src/auth/token.js', `src/${zwsp}auth/y.js`], date: today() });
    fs.mkdirSync(path.join(root, '.foreman'), { recursive: true });
    fs.writeFileSync(ledger.notesPath(root), [clean, badLesson, badPath, badArea].map((r) => `${JSON.stringify(r)}\n`).join(''), 'utf-8');

    const result = runRoadmap(['notes'], null, { CLAUDE_PROJECT_DIR: root });
    assert.doesNotMatch(result.stdout, /[\u200B\u202E]|\\u200b|\\u202e/i, 'no hidden character reaches the output, raw or escaped');
    const out = JSON.parse(result.stdout);
    const byKey = new Map(out.records.map((r) => [r.key, r]));
    assert.equal(byKey.get(ledger.recordKey(clean)).lesson, 'refresh() owns the token clock', 'a clean record still prints its text');
    const hiddenArea = 'a value carrying characters a reader cannot see (U+200B)';
    assert.equal(byKey.get(ledger.recordKey(badArea)).area, hiddenArea);
    assert.ok(out.areas.includes(hiddenArea) && out.areas.includes('src/auth'), JSON.stringify(out.areas));
    for (const [stored, hit] of [[badLesson, 'lesson line 1: U+200B'], [badPath, 'paths item 2: U+202E'], [badArea, 'paths item 2: U+200B']]) {
      const shown = byKey.get(ledger.recordKey(stored));
      assert.ok(shown, `${stored.entry} is listed by the key note-supersede takes`);
      assert.deepEqual(shown.hidden_characters, [hit]);
      assert.match(shown.withheld, /retire it by its key with `roadmap\.js note-supersede`/);
      for (const field of ['lesson', 'entry', 'date', 'paths', 'label']) assert.equal(shown[field], undefined, `${stored.entry} ${field}`);
    }
  });
});
