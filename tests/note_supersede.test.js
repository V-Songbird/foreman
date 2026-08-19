'use strict';

// [Foreman: 247] Stage 2 of the lesson ledger: retiring a lesson that proved
// wrong, clearing what nothing can learn from any more, and the one repair
// that keeps a duplicate-id fix from producing a confident claim off the wrong
// entry's history.
//
// Covers:
//   - the record key is derived from content, so two clones agree on it
//   - a superseded record stops being served, everywhere, with no consumer
//     knowing the concept exists
//   - supersede refuses a key it cannot find and a record already retired
//   - prune removes only the dead and the retired, and --dry-run writes nothing
//   - a marker whose target never arrived survives the prune (the merge case)
//   - reassign-id demotes note anchors rather than repointing them, and the
//     staleness resolver then refuses to answer instead of answering wrongly

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runRoadmap, makeTmpProject, writeRoadmap, writeConfig, SCRIPTS_DIR } = require('./helpers.js');
const areaNotes = require(path.join(SCRIPTS_DIR, 'area-notes.js'));
const noteStaleness = require(path.join(SCRIPTS_DIR, 'note-staleness.js'));

function seed(project, files = ['src/a.js', 'src/b.js']) {
  for (const rel of files) {
    const full = path.join(project, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '// fixture\n', 'utf-8');
  }
}

function record(project, overrides = {}) {
  return areaNotes.append(project, {
    lesson: 'the parser lives in src/a.js',
    paths: ['src/a.js'],
    entry: '001',
    date: '2026-08-01',
    ...overrides,
  });
}

function keyOf(project, lesson) {
  const found = areaNotes.read(project).records.find((r) => r.lesson === lesson);
  return found ? areaNotes.recordKey(found) : null;
}

describe('the record key', () => {
  test('is the same for the same content and different for different content', () => {
    const a = { entry: '001', date: '2026-08-01', lesson: 'x lives here' };
    const b = { entry: '001', date: '2026-08-01', lesson: 'x lives here' };
    const c = { entry: '002', date: '2026-08-01', lesson: 'x lives here' };
    const d = { entry: '001', date: '2026-08-01', lesson: 'y lives here' };
    assert.equal(areaNotes.recordKey(a), areaNotes.recordKey(b));
    assert.notEqual(areaNotes.recordKey(a), areaNotes.recordKey(c));
    assert.notEqual(areaNotes.recordKey(a), areaNotes.recordKey(d));
  });

  test('is stable across a write and a re-read, which is what makes it usable', () => {
    const project = makeTmpProject();
    seed(project);
    record(project);
    const [stored] = areaNotes.read(project).records;
    assert.equal(
      areaNotes.recordKey(stored),
      areaNotes.recordKey({ entry: '001', date: '2026-08-01', lesson: 'the parser lives in src/a.js' })
    );
  });

  test('a missing field is empty rather than undefined, so an anchorless record still keys', () => {
    assert.equal(typeof areaNotes.recordKey({ lesson: 'only a lesson' }), 'string');
    assert.equal(areaNotes.recordKey({ lesson: 'only a lesson' }).length, 12);
  });
});

describe('superseding a record', () => {
  test('retires it from the live set without deleting the line', () => {
    const project = makeTmpProject();
    seed(project);
    record(project);
    record(project, { lesson: 'the tokenizer lives in src/b.js', paths: ['src/b.js'], entry: '002' });
    const key = keyOf(project, 'the parser lives in src/a.js');

    const result = areaNotes.supersede(project, { key, by_entry: '003', date: '2026-08-19' });
    assert.deepEqual(result, { superseded: true, key });

    const after = areaNotes.read(project);
    assert.deepEqual(after.records.map((r) => r.lesson), ['the tokenizer lives in src/b.js']);
    assert.deepEqual(after.superseded, [key]);
    assert.equal(after.retired.length, 1);
    // The line itself is still on disk — retiring is an append, not an edit.
    const raw = fs.readFileSync(areaNotes.notesPath(project), 'utf-8');
    assert.ok(raw.includes('the parser lives in src/a.js'));
  });

  test('a retired record is invisible to every existing consumer', () => {
    const project = makeTmpProject();
    seed(project);
    writeRoadmap(project, []);
    writeConfig(project, { areaNotes: { enabled: true } });
    record(project);
    const key = keyOf(project, 'the parser lives in src/a.js');
    areaNotes.supersede(project, { key, date: '2026-08-19' });

    const out = JSON.parse(runRoadmap(['notes'], null, { CLAUDE_PROJECT_DIR: project }).stdout);
    assert.equal(out.ok, true);
    assert.deepEqual(out.records, []);
  });

  test('the notes CLI reports the key supersede takes, so the two compose', () => {
    const project = makeTmpProject();
    seed(project);
    writeRoadmap(project, []);
    record(project);
    const out = JSON.parse(runRoadmap(['notes'], null, { CLAUDE_PROJECT_DIR: project }).stdout);
    assert.equal(out.records.length, 1);
    assert.equal(out.records[0].key, keyOf(project, 'the parser lives in src/a.js'));
  });

  test('refuses a key that names nothing, rather than writing a marker for it', () => {
    const project = makeTmpProject();
    seed(project);
    record(project);
    assert.deepEqual(
      areaNotes.supersede(project, { key: 'deadbeefdead', date: '2026-08-19' }),
      { superseded: false, reason: 'no_such_record' }
    );
    assert.deepEqual(areaNotes.read(project).tombstones, []);
  });

  test('refuses a second marker for a record already retired', () => {
    const project = makeTmpProject();
    seed(project);
    record(project);
    const key = keyOf(project, 'the parser lives in src/a.js');
    areaNotes.supersede(project, { key, date: '2026-08-19' });
    assert.deepEqual(
      areaNotes.supersede(project, { key, date: '2026-08-19' }),
      { superseded: false, reason: 'already_superseded' }
    );
  });

  test('refuses an empty key', () => {
    const project = makeTmpProject();
    assert.deepEqual(areaNotes.supersede(project, { key: '   ' }), { superseded: false, reason: 'no_key' });
  });

  test('the CLI requires a key and says what one is', () => {
    const project = makeTmpProject();
    writeRoadmap(project, []);
    const run = runRoadmap(['note-supersede'], { by_entry: '003' }, { CLAUDE_PROJECT_DIR: project });
    assert.notEqual(run.status, 0);
    assert.match(JSON.parse(run.stdout || run.stderr).error, /requires key/);
  });

  test('the CLI round-trips: notes reports a key, supersede takes it, notes drops it', () => {
    const project = makeTmpProject();
    seed(project);
    writeRoadmap(project, []);
    record(project);
    const before = JSON.parse(runRoadmap(['notes'], null, { CLAUDE_PROJECT_DIR: project }).stdout);
    const { key } = before.records[0];

    const done = JSON.parse(
      runRoadmap(['note-supersede'], { key, by_entry: '003' }, { CLAUDE_PROJECT_DIR: project }).stdout
    );
    assert.equal(done.superseded, true);

    const after = JSON.parse(runRoadmap(['notes'], null, { CLAUDE_PROJECT_DIR: project }).stdout);
    assert.deepEqual(after.records, []);
  });
});

describe('pruning the store', () => {
  test('--dry-run reports what would go and writes nothing', () => {
    const project = makeTmpProject();
    seed(project, ['src/a.js']);
    record(project);
    record(project, { lesson: 'gone code', paths: ['src/deleted.js'], entry: '002' });
    const before = fs.readFileSync(areaNotes.notesPath(project), 'utf-8');

    const result = areaNotes.prune(project, { dryRun: true });
    assert.equal(result.pruned, false);
    assert.equal(result.dry_run, true);
    assert.equal(result.removed, 1);
    assert.deepEqual(result.dropped, { dead: 1, superseded: 0 });
    assert.equal(fs.readFileSync(areaNotes.notesPath(project), 'utf-8'), before);
  });

  test('removes the dead and the retired, keeps the rest, and rewrites the marker line', () => {
    const project = makeTmpProject();
    seed(project, ['src/a.js', 'src/b.js']);
    record(project);
    record(project, { lesson: 'the tokenizer lives in src/b.js', paths: ['src/b.js'], entry: '002' });
    record(project, { lesson: 'gone code', paths: ['src/deleted.js'], entry: '003' });
    const key = keyOf(project, 'the parser lives in src/a.js');
    areaNotes.supersede(project, { key, date: '2026-08-19' });

    const result = areaNotes.prune(project);
    assert.equal(result.pruned, true);
    assert.equal(result.removed, 2);
    assert.deepEqual(result.dropped, { dead: 1, superseded: 1 });
    assert.equal(result.kept, 1);

    const after = areaNotes.read(project);
    assert.deepEqual(after.records.map((r) => r.lesson), ['the tokenizer lives in src/b.js']);
    assert.deepEqual(after.tombstones, []);
    assert.equal(after.format, areaNotes.FORMAT);
    const lines = fs.readFileSync(areaNotes.notesPath(project), 'utf-8').trim().split('\n');
    assert.equal(JSON.parse(lines[0])[areaNotes.FORMAT_KEY], areaNotes.FORMAT);
    assert.equal(lines.length, 2);
  });

  test('a marker whose target this file never carried survives — the half-merged case', () => {
    const project = makeTmpProject();
    seed(project, ['src/a.js']);
    record(project);
    fs.appendFileSync(
      areaNotes.notesPath(project),
      `${JSON.stringify({ supersedes: 'from0therside', date: '2026-08-19' })}\n`,
      'utf-8'
    );

    const result = areaNotes.prune(project);
    assert.equal(result.pruned, false);
    assert.equal(result.reason, 'nothing_to_prune');

    // Now give it something to actually prune, and check the orphan still rides.
    record(project, { lesson: 'gone code', paths: ['src/deleted.js'], entry: '003' });
    assert.equal(areaNotes.prune(project).pruned, true);
    assert.deepEqual(areaNotes.read(project).superseded, ['from0therside']);
  });

  test('says so rather than rewriting when there is nothing to remove', () => {
    const project = makeTmpProject();
    seed(project, ['src/a.js']);
    record(project);
    const before = fs.readFileSync(areaNotes.notesPath(project), 'utf-8');
    assert.equal(areaNotes.prune(project).reason, 'nothing_to_prune');
    assert.equal(fs.readFileSync(areaNotes.notesPath(project), 'utf-8'), before);
  });

  test('an unreadable store is refused by name, never half-rewritten', () => {
    const project = makeTmpProject();
    seed(project, ['src/a.js']);
    record(project);
    fs.appendFileSync(areaNotes.notesPath(project), '<<<<<<< HEAD\n');
    assert.deepEqual(areaNotes.prune(project), { pruned: false, reason: 'conflict' });
  });

  test('the CLI exposes both shapes', () => {
    const project = makeTmpProject();
    seed(project, ['src/a.js']);
    writeRoadmap(project, []);
    record(project);
    record(project, { lesson: 'gone code', paths: ['src/deleted.js'], entry: '003' });

    const dry = JSON.parse(runRoadmap(['note-prune', '--dry-run'], null, { CLAUDE_PROJECT_DIR: project }).stdout);
    assert.equal(dry.dry_run, true);
    assert.equal(dry.removed, 1);

    const real = JSON.parse(runRoadmap(['note-prune'], null, { CLAUDE_PROJECT_DIR: project }).stdout);
    assert.equal(real.pruned, true);
    assert.equal(real.kept, 1);
  });
});

describe('a duplicate-id repair and the lessons anchored to it', () => {
  test('demotes an entry anchor instead of repointing it at the surviving holder', () => {
    const project = makeTmpProject();
    seed(project);
    areaNotes.append(project, {
      lesson: 'the parser lives in src/a.js',
      paths: ['src/a.js'],
      entry: '007',
      anchor: { kind: 'entry', entry: '007' },
      date: '2026-08-01',
    });
    areaNotes.append(project, {
      lesson: 'the tokenizer lives in src/b.js',
      paths: ['src/b.js'],
      entry: '008',
      anchor: { kind: 'commit', sha: 'abc1234' },
      date: '2026-08-02',
    });

    const result = areaNotes.demoteAnchors(project, '007', { date: '2026-08-19' });
    assert.equal(result.demoted, 1);

    const [first, second] = areaNotes.read(project).records;
    assert.deepEqual(first.anchor, { kind: 'ambiguous', was: '007', since: '2026-08-19' });
    // The lesson, the entry it names and its date are true history and stay.
    assert.equal(first.lesson, 'the parser lives in src/a.js');
    assert.equal(first.entry, '007');
    assert.equal(first.date, '2026-08-01');
    // A commit anchor names a sha, not an id, so the repair cannot have
    // confused it and it is left exactly alone.
    assert.deepEqual(second.anchor, { kind: 'commit', sha: 'abc1234' });
  });

  test('leaves an existing supersede marker working, because the key does not move', () => {
    const project = makeTmpProject();
    seed(project);
    areaNotes.append(project, {
      lesson: 'the parser lives in src/a.js',
      paths: ['src/a.js'],
      entry: '007',
      anchor: { kind: 'entry', entry: '007' },
      date: '2026-08-01',
    });
    const key = keyOf(project, 'the parser lives in src/a.js');
    areaNotes.supersede(project, { key, date: '2026-08-19' });
    assert.deepEqual(areaNotes.read(project).records, []);

    areaNotes.demoteAnchors(project, '007', { date: '2026-08-19' });
    assert.deepEqual(areaNotes.read(project).records, []);
    assert.equal(areaNotes.read(project).retired.length, 1);
  });

  test('writes nothing when no record is anchored to the repaired id', () => {
    const project = makeTmpProject();
    seed(project);
    record(project);
    const before = fs.readFileSync(areaNotes.notesPath(project), 'utf-8');
    assert.deepEqual(areaNotes.demoteAnchors(project, '999', { date: '2026-08-19' }), { demoted: 0 });
    assert.equal(fs.readFileSync(areaNotes.notesPath(project), 'utf-8'), before);
  });

  test('a demoted anchor makes the resolver answer unknown, never a freshness claim', () => {
    const project = makeTmpProject();
    seed(project, ['src/a.js']);
    const verdict = noteStaleness.resolve(project, {
      paths: ['src/a.js'],
      entry: '007',
      anchor: { kind: 'ambiguous', was: '007', since: '2026-08-19' },
      date: '2026-08-01',
      lesson: 'the parser lives in src/a.js',
    });
    assert.equal(verdict.state, 'unknown');
    assert.equal(verdict.sha, null);
    assert.doesNotMatch(verdict.label, /unchanged since/);
  });
});
