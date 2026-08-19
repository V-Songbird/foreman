'use strict';

// Tests for scripts/area-notes.js — the lesson ledger's append-only store —
// and for the `lesson` input update-status writes it through.
//
// Covers:
//   - the store's refusal reasons, each by its own name
//   - case-preserved paths (a lowercased store reads false-dead on a
//     case-sensitive filesystem)
//   - a torn final line is skipped, not repaired
//   - a merge-conflicted or newer-format store serves nothing
//   - a close never fails because of its lesson: every refusal keeps the
//     prose on the entry's own notes instead
//   - the disabled default, and the env override that flips it

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');

const { runRoadmap, makeTmpProject, writeRoadmap, initGitRepo, commitFile, SCRIPTS_DIR } = require('./helpers.js');
const areaNotes = require(path.join(SCRIPTS_DIR, 'area-notes.js'));
const { today } = require(path.join(SCRIPTS_DIR, 'roadmap.js'));

function entry(overrides = {}) {
  return {
    id: '001',
    title: 'Fix token refresh',
    why: 'Sessions expire mid-request.',
    what: 'Refresh before expiry.',
    status: 'in_progress',
    source: 'user',
    depends_on: [],
    planned_touches: ['src/Auth/session.js'],
    observed_touches: ['src/Auth/session.js', 'test/helpers/clock.js'],
    commits: [],
    created_at: today(),
    updated_at: today(),
    notes: '',
    ...overrides,
  };
}

function close(project, payload, env = {}) {
  const result = runRoadmap(
    ['update-status'],
    JSON.stringify({ id: '001', status: 'done', ...payload }),
    { CLAUDE_PROJECT_DIR: project, ...env }
  );
  return { status: result.status, json: JSON.parse(result.stdout) };
}

function enabledProject(extraConfig = {}) {
  const project = makeTmpProject();
  writeRoadmap(project, [entry()]);
  fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
  fs.writeFileSync(
    path.join(project, '.foreman', 'config.json'),
    JSON.stringify({ areaNotes: { enabled: true }, ...extraConfig }),
    'utf-8'
  );
  return project;
}

function storedRecords(project) {
  return areaNotes.read(project).records;
}

describe('area-notes store', () => {
  test('an appended record keeps its paths exactly as recorded', () => {
    const project = makeTmpProject();
    const out = areaNotes.append(project, {
      lesson: 'token refresh lives in refresh(); tests must fake time',
      paths: ['src\\Auth\\session.js', './test/helpers/clock.js'],
      entry: '001',
      anchor: { kind: 'entry' },
      date: today(),
    });
    assert.equal(out.stored, true);
    const [record] = storedRecords(project);
    assert.deepEqual(record.paths, ['src/Auth/session.js', 'test/helpers/clock.js']);
    assert.ok(!record.paths.some((p) => p.includes('auth/')), 'the store must not lowercase a path');
  });

  test('the first line is a format marker and is not a record', () => {
    const project = makeTmpProject();
    areaNotes.append(project, { lesson: 'a', paths: ['src/a.js'], entry: '001', date: today() });
    const lines = fs.readFileSync(areaNotes.notesPath(project), 'utf-8').trim().split('\n');
    assert.deepEqual(JSON.parse(lines[0]), { [areaNotes.FORMAT_KEY]: areaNotes.FORMAT });
    assert.equal(storedRecords(project).length, 1);
  });

  test('a lesson over 500 chars is refused, never truncated', () => {
    const project = makeTmpProject();
    const out = areaNotes.append(project, {
      lesson: 'x'.repeat(areaNotes.LESSON_MAX + 1),
      paths: ['src/a.js'],
      entry: '001',
      date: today(),
    });
    assert.deepEqual(out, { stored: false, reason: 'over_500_chars' });
    assert.equal(fs.existsSync(areaNotes.notesPath(project)), false);
  });

  test('bookkeeping-only paths leave nothing to record', () => {
    const project = makeTmpProject();
    const out = areaNotes.append(project, {
      lesson: 'a real fact',
      paths: ['ROADMAP.jsonl', '.foreman/notes.jsonl', 'docs/foreman/101.md'],
      entry: '001',
      date: today(),
    });
    assert.deepEqual(out, { stored: false, reason: 'no_observed_paths' });
  });

  test('a torn final line is skipped and every whole line survives', () => {
    const project = makeTmpProject();
    areaNotes.append(project, { lesson: 'first', paths: ['src/a.js'], entry: '001', date: today() });
    fs.appendFileSync(areaNotes.notesPath(project), '{"paths":["src/b.js"],"lesso');
    const { records, error } = areaNotes.read(project);
    assert.equal(error, null);
    assert.equal(records.length, 1);
    assert.equal(records[0].lesson, 'first');
  });

  test('a merge-conflicted store serves nothing and refuses new writes', () => {
    const project = makeTmpProject();
    areaNotes.append(project, { lesson: 'first', paths: ['src/a.js'], entry: '001', date: today() });
    fs.appendFileSync(areaNotes.notesPath(project), '<<<<<<< HEAD\n');
    assert.deepEqual(areaNotes.read(project), { records: [], retired: [], tombstones: [], superseded: [], format: null, error: 'conflict', invalid: 0 });
    assert.deepEqual(
      areaNotes.append(project, { lesson: 'second', paths: ['src/b.js'], entry: '002', date: today() }),
      { stored: false, reason: 'conflict' }
    );
  });

  test('a newer format is refused rather than guessed at', () => {
    const project = makeTmpProject();
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(
      areaNotes.notesPath(project),
      `${JSON.stringify({ [areaNotes.FORMAT_KEY]: areaNotes.FORMAT + 1 })}\n`,
      'utf-8'
    );
    const { records, error } = areaNotes.read(project);
    assert.equal(error, 'unsupported_format');
    assert.deepEqual(records, []);
  });

  test('a missing store is a project that recorded nothing, not an error', () => {
    assert.deepEqual(areaNotes.read(makeTmpProject()), { records: [], retired: [], tombstones: [], superseded: [], format: areaNotes.FORMAT, error: null, invalid: 0 });
  });

  test('the area key is the dominant two-segment prefix, lowercased', () => {
    assert.equal(areaNotes.dominantArea(['src/Auth/session.js', 'test/helpers/clock.js']), 'src/auth');
    assert.equal(
      areaNotes.dominantArea(['foreman/scripts/a.js', 'foreman/scripts/b.js', 'foreman/tests/c.js']),
      'foreman/scripts'
    );
    assert.equal(areaNotes.dominantArea(['README.md']), '.');
  });
});

describe('update-status lesson', () => {
  test('an enabled close stores the lesson and says where it went', () => {
    const project = enabledProject();
    const { json } = close(project, { lesson: 'session refresh lives in refresh(); fake time in tests' });
    assert.deepEqual(json.lesson, { stored: true, area: 'src/auth', paths_count: 2 });
    const [record] = storedRecords(project);
    assert.equal(record.entry, '001');
    assert.deepEqual(record.anchor, { kind: 'entry' });
    assert.match(json.entry.notes, /lesson recorded: \.foreman\/notes\.jsonl, area src\/auth/);
  });

  test('a recorded commit anchors the record to that sha', () => {
    const project = enabledProject();
    const { json } = close(project, { commit: 'a1b2c3d', lesson: 'a durable fact about src/Auth' });
    assert.equal(json.lesson.stored, true);
    assert.deepEqual(storedRecords(project)[0].anchor, { kind: 'commit', sha: 'a1b2c3d' });
  });

  test('disabled keeps the prose on the entry and writes no store', () => {
    const project = makeTmpProject();
    writeRoadmap(project, [entry()]);
    const { status, json } = close(project, { lesson: 'a fact worth keeping' });
    assert.equal(status, 0, 'a lesson must never fail the close');
    assert.deepEqual(json.lesson, { stored: false, reason: 'disabled' });
    assert.match(json.entry.notes, /lesson not recorded \(areaNotes disabled\): a fact worth keeping/);
    assert.equal(fs.existsSync(areaNotes.notesPath(project)), false);
  });

  test('an over-long lesson is refused by name and still kept on the entry', () => {
    const project = enabledProject();
    const long = 'y'.repeat(areaNotes.LESSON_MAX + 1);
    const { status, json } = close(project, { lesson: long });
    assert.equal(status, 0);
    assert.deepEqual(json.lesson, { stored: false, reason: 'over_500_chars' });
    assert.match(json.entry.notes, /lesson not recorded \(over_500_chars\)/);
    assert.equal(storedRecords(project).length, 0);
  });

  test('a lesson on a status that is not a close is refused', () => {
    const project = enabledProject();
    const result = runRoadmap(
      ['update-status'],
      JSON.stringify({ id: '001', status: 'in_progress', lesson: 'too early' }),
      { CLAUDE_PROJECT_DIR: project }
    );
    assert.deepEqual(JSON.parse(result.stdout).lesson, { stored: false, reason: 'not_a_close' });
  });

  test('a non-string lesson is a clean error, not a stored record', () => {
    const project = enabledProject();
    const result = runRoadmap(
      ['update-status'],
      JSON.stringify({ id: '001', status: 'done', lesson: 42 }),
      { CLAUDE_PROJECT_DIR: project }
    );
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /lesson must be a string/);
  });

  test('the env override turns the feature on without a config file', () => {
    const project = makeTmpProject();
    writeRoadmap(project, [entry()]);
    const { json } = close(project, { lesson: 'a fact' }, { FOREMAN_AREA_NOTES: '1' });
    assert.equal(json.lesson.stored, true);
  });

  test('a staged close stages the notes file alongside the roadmap', () => {
    const project = enabledProject();
    initGitRepo(project);
    fs.mkdirSync(path.join(project, 'src', 'Auth'), { recursive: true });
    fs.writeFileSync(path.join(project, 'src', 'Auth', 'session.js'), 'x', 'utf-8');
    const { json } = close(project, { staged: true, lesson: 'refresh() owns the token clock' });
    assert.equal(json.lesson.stored, true);
    const staged = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: project, encoding: 'utf-8' }).stdout;
    assert.match(staged, /\.foreman\/notes\.jsonl/);
  });

  test('the notes file never lands in observed_touches', () => {
    const project = enabledProject();
    initGitRepo(project);
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(areaNotes.notesPath(project), '{"foreman_notes_format":1}\n', 'utf-8');
    spawnSync('git', ['add', '.foreman/notes.jsonl'], { cwd: project });
    const { json } = close(project, { staged: true });
    assert.ok(
      !(json.entry.observed_touches || []).some((p) => p.includes('notes.jsonl')),
      'an abandoned staged close must not pollute the next close forever'
    );
  });
});

describe('lesson lines in the handoff', () => {
  const { areaNotesText, notesOverlapExists } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));

  // A real repo, so the record resolves to "fresh" and its prose is served.
  // With no git it would resolve to "unknown", which serves paths only —
  // covered by its own case below.
  function seeded(overrides = {}) {
    const project = enabledProject();
    initGitRepo(project);
    const sha = commitFile(project, 'src/Auth/session.js', 'const refresh = () => 1;\n');
    areaNotes.append(project, {
      lesson: 'the token clock lives in refresh(); fake it in tests',
      paths: ['src/Auth/session.js'],
      entry: '900',
      anchor: { kind: 'commit', sha },
      date: '2026-08-01',
      ...overrides,
    });
    return { project, sha };
  }

  test('a record whose files this task plans to touch is served, with its label', () => {
    const { project, sha } = seeded();
    const text = areaNotesText(project, { id: '001', planned_touches: ['src/Auth/session.js'] });
    assert.match(text, /^Lessons recorded by earlier closed tasks touching these files/);
    assert.match(text, /the token clock lives in refresh\(\)/);
    assert.ok(text.includes(`[entry 900, 2026-08-01, at ${sha} — unchanged since]`), text);
    assert.match(text, /\(matched: planned src\/Auth\/session\.js ↔ recorded src\/Auth\/session\.js\)/);
    assert.match(text, /record the corrected fact by passing "lesson" on your close\.$/);
  });

  // "Unknown" is what every git failure resolves to, and an unverifiable
  // claim is exactly the thing this feature must not assert. The paths still
  // point somewhere useful; the prose does not ship.
  test('an undatable record serves its paths, never its prose', () => {
    const project = enabledProject();
    fs.mkdirSync(path.join(project, 'src', 'Auth'), { recursive: true });
    fs.writeFileSync(path.join(project, 'src', 'Auth', 'session.js'), 'x', 'utf-8');
    areaNotes.append(project, {
      lesson: 'an unverifiable claim',
      paths: ['src/Auth/session.js'],
      entry: '900',
      anchor: { kind: 'entry' },
      date: '2026-08-01',
    });
    const text = areaNotesText(project, { id: '001', planned_touches: ['src/Auth/session.js'] });
    assert.match(text, /- src\/Auth\/session\.js \[entry 900, 2026-08-01 — anchor unresolvable/);
    assert.ok(!text.includes('an unverifiable claim'));
  });

  test('disabled serves nothing at all', () => {
    const { project } = seeded();
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{}', 'utf-8');
    assert.equal(areaNotesText(project, { id: '001', planned_touches: ['src/Auth/session.js'] }), '');
  });

  test('a task planning nothing this store knows serves nothing', () => {
    const { project } = seeded();
    assert.equal(areaNotesText(project, { id: '001', planned_touches: ['src/unrelated.js'] }), '');
  });

  test('the whole block stays under its 1000-char ceiling, dropping whole records', () => {
    const project = enabledProject();
    initGitRepo(project);
    const sha = commitFile(project, 'src/Auth/session.js', 'const refresh = () => 1;\n');
    for (let i = 0; i < 6; i += 1) {
      areaNotes.append(project, {
        lesson: `${'L'.repeat(400)} ${i}`,
        paths: ['src/Auth/session.js'],
        entry: String(900 + i),
        anchor: { kind: 'commit', sha },
        date: '2026-08-01',
      });
    }
    const text = areaNotesText(project, { id: '001', planned_touches: ['src/Auth/session.js'] });
    assert.ok(text.length < 1000, `block was ${text.length} chars`);
    for (const line of text.split('\n').filter((l) => l.startsWith('- '))) {
      assert.ok(line.includes('L'.repeat(400)), 'a served record is whole or absent');
    }
  });

  test('a record whose every file is gone is never served', () => {
    const project = enabledProject();
    areaNotes.append(project, {
      lesson: 'about code that no longer exists',
      paths: ['src/deleted/gone.js'],
      entry: '900',
      anchor: { kind: 'entry' },
      date: '2026-08-01',
    });
    assert.equal(areaNotesText(project, { id: '001', planned_touches: ['src/deleted/gone.js'] }), '');
  });

  test('the overlap fact fires only while the setting is unanswered', () => {
    const project = makeTmpProject();
    writeRoadmap(project, [
      entry({ id: '001', status: 'planned', observed_touches: [] }),
      entry({ id: '002', status: 'done' }),
    ]);
    assert.equal(notesOverlapExists(project, { id: '001', planned_touches: ['src/Auth/session.js'] }), true);
    assert.equal(notesOverlapExists(project, { id: '001', planned_touches: ['src/nothing.js'] }), false);
  });

  test('the close ask appears only where the ledger is on', () => {
    const { entryParagraphText } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));
    const args = { id: '001', resume: false, requireVerification: false, destination: 'task' };
    assert.ok(!entryParagraphText({ ...args, askLesson: false }).includes('"lesson"'));
    const asked = entryParagraphText({ ...args, askLesson: true });
    assert.match(asked, /If this task taught you one durable fact about this code area/);
    assert.match(asked, /that is a valid outcome/);
  });

  test('every lesson note is machine-prefixed so recall can never quote it', () => {
    const { recallExcerpt } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));
    const notes = [
      `${today()} lesson recorded: .foreman/notes.jsonl, area src/auth`,
      `${today()} lesson not recorded (areaNotes disabled): an unstored claim nobody checked`,
    ].join('\n');
    assert.equal(recallExcerpt(notes), null);
  });
});
