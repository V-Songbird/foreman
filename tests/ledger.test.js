'use strict';

// Tests for scripts/ledger.js — the ledger's append-only store — and for
// the `lesson` input update-status writes it through.
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
//   - the two config keys `ledger` replaced still turn it on
//   - anchors served at dispatch, beside the path-matched lessons

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');

const { runRoadmap, makeTmpProject, writeRoadmap, initGitRepo, commitFile, SCRIPTS_DIR } = require('./helpers.js');
const ledger = require(path.join(SCRIPTS_DIR, 'ledger.js'));
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
    JSON.stringify({ ledger: { enabled: true }, ...extraConfig }),
    'utf-8'
  );
  return project;
}

function storedRecords(project) {
  return ledger.read(project).records;
}

describe('ledger store', () => {
  test('an appended record keeps its paths exactly as recorded', () => {
    const project = makeTmpProject();
    const out = ledger.append(project, {
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
    ledger.append(project, { lesson: 'a', paths: ['src/a.js'], entry: '001', date: today() });
    const lines = fs.readFileSync(ledger.notesPath(project), 'utf-8').trim().split('\n');
    assert.deepEqual(JSON.parse(lines[0]), { [ledger.FORMAT_KEY]: ledger.FORMAT });
    assert.equal(storedRecords(project).length, 1);
  });

  test('a lesson over 500 chars is refused, never truncated', () => {
    const project = makeTmpProject();
    const out = ledger.append(project, {
      lesson: 'x'.repeat(ledger.LESSON_MAX + 1),
      paths: ['src/a.js'],
      entry: '001',
      date: today(),
    });
    assert.deepEqual(out, { stored: false, reason: 'over_500_chars' });
    assert.equal(fs.existsSync(ledger.notesPath(project)), false);
  });

  test('bookkeeping-only paths leave nothing to record', () => {
    const project = makeTmpProject();
    const out = ledger.append(project, {
      lesson: 'a real fact',
      paths: ['ROADMAP.jsonl', '.foreman/notes.jsonl', 'docs/foreman/101.md'],
      entry: '001',
      date: today(),
    });
    assert.deepEqual(out, { stored: false, reason: 'no_observed_paths' });
  });

  test('a torn final line is skipped and every whole line survives', () => {
    const project = makeTmpProject();
    ledger.append(project, { lesson: 'first', paths: ['src/a.js'], entry: '001', date: today() });
    fs.appendFileSync(ledger.notesPath(project), '{"paths":["src/b.js"],"lesso');
    const { records, error } = ledger.read(project);
    assert.equal(error, null);
    assert.equal(records.length, 1);
    assert.equal(records[0].lesson, 'first');
  });

  test('a merge-conflicted store serves nothing and refuses new writes', () => {
    const project = makeTmpProject();
    ledger.append(project, { lesson: 'first', paths: ['src/a.js'], entry: '001', date: today() });
    fs.appendFileSync(ledger.notesPath(project), '<<<<<<< HEAD\n');
    assert.deepEqual(ledger.read(project), { records: [], retired: [], tombstones: [], superseded: [], format: null, error: 'conflict', invalid: 0 });
    assert.deepEqual(
      ledger.append(project, { lesson: 'second', paths: ['src/b.js'], entry: '002', date: today() }),
      { stored: false, reason: 'conflict' }
    );
  });

  test('a newer format is refused rather than guessed at', () => {
    const project = makeTmpProject();
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(
      ledger.notesPath(project),
      `${JSON.stringify({ [ledger.FORMAT_KEY]: ledger.FORMAT + 1 })}\n`,
      'utf-8'
    );
    const { records, error } = ledger.read(project);
    assert.equal(error, 'unsupported_format');
    assert.deepEqual(records, []);
  });

  test('a missing store is a project that recorded nothing, not an error', () => {
    assert.deepEqual(ledger.read(makeTmpProject()), { records: [], retired: [], tombstones: [], superseded: [], format: ledger.FORMAT, error: null, invalid: 0 });
  });

  test('the area key is the dominant two-segment prefix, lowercased', () => {
    assert.equal(ledger.dominantArea(['src/Auth/session.js', 'test/helpers/clock.js']), 'src/auth');
    assert.equal(
      ledger.dominantArea(['foreman/scripts/a.js', 'foreman/scripts/b.js', 'foreman/tests/c.js']),
      'foreman/scripts'
    );
    assert.equal(ledger.dominantArea(['README.md']), '.');
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
    assert.match(json.entry.notes, /lesson not recorded \(ledger disabled\): a fact worth keeping/);
    assert.equal(fs.existsSync(ledger.notesPath(project)), false);
  });

  test('an over-long lesson is refused by name and still kept on the entry', () => {
    const project = enabledProject();
    const long = 'y'.repeat(ledger.LESSON_MAX + 1);
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
    fs.writeFileSync(ledger.notesPath(project), '{"foreman_notes_format":1}\n', 'utf-8');
    spawnSync('git', ['add', '.foreman/notes.jsonl'], { cwd: project });
    const { json } = close(project, { staged: true });
    assert.ok(
      !(json.entry.observed_touches || []).some((p) => p.includes('notes.jsonl')),
      'an abandoned staged close must not pollute the next close forever'
    );
  });
});

describe('lesson lines in the handoff', () => {
  const { ledgerText, notesOverlapExists } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));

  // A real repo, so the record resolves to "fresh" and its prose is served.
  // With no git it would resolve to "unknown", which serves paths only —
  // covered by its own case below.
  function seeded(overrides = {}) {
    const project = enabledProject();
    initGitRepo(project);
    const sha = commitFile(project, 'src/Auth/session.js', 'const refresh = () => 1;\n');
    ledger.append(project, {
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
    const text = ledgerText(project, { id: '001', planned_touches: ['src/Auth/session.js'] });
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
    ledger.append(project, {
      lesson: 'an unverifiable claim',
      paths: ['src/Auth/session.js'],
      entry: '900',
      anchor: { kind: 'entry' },
      date: '2026-08-01',
    });
    const text = ledgerText(project, { id: '001', planned_touches: ['src/Auth/session.js'] });
    assert.match(text, /- src\/Auth\/session\.js \[entry 900, 2026-08-01 — anchor unresolvable/);
    assert.ok(!text.includes('an unverifiable claim'));
  });

  test('disabled serves nothing at all', () => {
    const { project } = seeded();
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{}', 'utf-8');
    assert.equal(ledgerText(project, { id: '001', planned_touches: ['src/Auth/session.js'] }), '');
  });

  test('a task planning nothing this store knows serves nothing', () => {
    const { project } = seeded();
    assert.equal(ledgerText(project, { id: '001', planned_touches: ['src/unrelated.js'] }), '');
  });

  test('the whole block stays under its 1000-char ceiling, dropping whole records', () => {
    const project = enabledProject();
    initGitRepo(project);
    const sha = commitFile(project, 'src/Auth/session.js', 'const refresh = () => 1;\n');
    for (let i = 0; i < 6; i += 1) {
      ledger.append(project, {
        lesson: `${'L'.repeat(400)} ${i}`,
        paths: ['src/Auth/session.js'],
        entry: String(900 + i),
        anchor: { kind: 'commit', sha },
        date: '2026-08-01',
      });
    }
    const text = ledgerText(project, { id: '001', planned_touches: ['src/Auth/session.js'] });
    assert.ok(text.length < 1000, `block was ${text.length} chars`);
    for (const line of text.split('\n').filter((l) => l.startsWith('- '))) {
      assert.ok(line.includes('L'.repeat(400)), 'a served record is whole or absent');
    }
  });

  test('a record whose every file is gone is never served', () => {
    const project = enabledProject();
    ledger.append(project, {
      lesson: 'about code that no longer exists',
      paths: ['src/deleted/gone.js'],
      entry: '900',
      anchor: { kind: 'entry' },
      date: '2026-08-01',
    });
    assert.equal(ledgerText(project, { id: '001', planned_touches: ['src/deleted/gone.js'] }), '');
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
      `${today()} lesson not recorded (ledger disabled): an unstored claim nobody checked`,
    ].join('\n');
    assert.equal(recallExcerpt(notes), null);
  });
});

describe('the config keys `ledger` replaced', () => {
  const { readLedger } = require(path.join(SCRIPTS_DIR, 'ledger-config.js'));

  function withConfig(config) {
    const project = makeTmpProject();
    writeRoadmap(project, [entry()]);
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), JSON.stringify(config), 'utf-8');
    return project;
  }

  test('areaNotes still enables it', () => {
    assert.equal(readLedger(withConfig({ areaNotes: { enabled: true } })).enabled, true);
  });

  test('decisionLog still enables it, and still names the documents dir', () => {
    const resolved = readLedger(withConfig({ decisionLog: { enabled: true, dir: 'docs/adr' } }));
    assert.equal(resolved.enabled, true);
    assert.equal(resolved.dir, 'docs/adr');
  });

  test('ledger wins over a legacy key that disagrees', () => {
    const project = withConfig({ ledger: { enabled: false }, areaNotes: { enabled: true } });
    assert.equal(readLedger(project).enabled, false);
  });

  test('the retired gate key is inert, never an error', () => {
    const resolved = readLedger(withConfig({ decisionLog: { enabled: true, gate: 'block' } }));
    assert.equal(resolved.enabled, true);
    assert.equal(resolved.warning, null);
  });
});

describe('anchors served at dispatch', () => {
  const { anchorsText } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));

  function anchored(project, body) {
    fs.mkdirSync(path.join(project, 'src', 'Auth'), { recursive: true });
    fs.writeFileSync(path.join(project, 'src', 'Auth', 'session.js'), body, 'utf-8');
  }

  test('an anchor naming a roadmap entry is served with that entry title', () => {
    const project = makeTmpProject();
    writeRoadmap(project, [entry(), { ...entry(), id: '019', title: 'Expire sessions server-side' }]);
    anchored(project, '// [Foreman: 019]\nconst refresh = () => 1;\n');
    const text = anchorsText(project, { id: '001', planned_touches: ['src/Auth/session.js'] }, 'docs/foreman');
    assert.match(text, /^Anchored in the files this task plans to touch/);
    assert.match(text, /src\/Auth\/session\.js carries \[Foreman: 019\] — Expire sessions server-side/);
  });

  test('a document behind the anchor is named too', () => {
    const project = makeTmpProject();
    writeRoadmap(project, [entry(), { ...entry(), id: '019', title: 'Expire sessions server-side' }]);
    anchored(project, '// [Foreman: 019]\n');
    fs.mkdirSync(path.join(project, 'docs', 'foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, 'docs', 'foreman', '019.md'), '# a decision\n', 'utf-8');
    const text = anchorsText(project, { id: '001', planned_touches: ['src/Auth/session.js'] }, 'docs/foreman');
    assert.match(text, /→ read docs\/foreman\/019\.md first/);
  });

  test('an id with neither an entry nor a document is stray bracket text', () => {
    const project = makeTmpProject();
    writeRoadmap(project, [entry()]);
    anchored(project, '// [Foreman: 777]\n');
    assert.equal(anchorsText(project, { id: '001', planned_touches: ['src/Auth/session.js'] }, 'docs/foreman'), '');
  });

  test("a task never quotes its own id back at itself", () => {
    const project = makeTmpProject();
    writeRoadmap(project, [entry()]);
    anchored(project, '// [Foreman: 001]\n');
    assert.equal(anchorsText(project, { id: '001', planned_touches: ['src/Auth/session.js'] }, 'docs/foreman'), '');
  });

  test('a planned file that does not exist yet is silence, never an error', () => {
    const project = makeTmpProject();
    writeRoadmap(project, [entry()]);
    assert.equal(anchorsText(project, { id: '001', planned_touches: ['src/nope.js'] }, 'docs/foreman'), '');
  });

  test('no planned files means nothing to read', () => {
    const project = makeTmpProject();
    writeRoadmap(project, [entry()]);
    assert.equal(anchorsText(project, { id: '001', planned_touches: [] }, 'docs/foreman'), '');
  });

  // Both bounds are on what is served. The first cap counted collected ids
  // between files, so ONE heavily-marked file contributed every anchor it
  // carried — measured at 2.0.0, a third to a half of served blocks were over
  // the limit, the worst at 23 lines and 3,342 characters.
  const { ANCHOR_KEEP, ANCHOR_MAX_CHARS } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));

  function marked(project, ids, titleFor) {
    writeRoadmap(project, [
      entry(),
      ...ids.map((id) => ({ ...entry(), id, title: titleFor(id) })),
    ]);
    fs.mkdirSync(path.join(project, 'src', 'Auth'), { recursive: true });
    fs.writeFileSync(
      path.join(project, 'src', 'Auth', 'session.js'),
      ids.map((id) => `// [Foreman: ${id}]`).join('\n'),
      'utf-8'
    );
    return anchorsText(project, { id: '001', planned_touches: ['src/Auth/session.js'] }, 'docs/foreman');
  }

  test('one file carrying more anchors than the cap still serves only the cap', () => {
    const ids = ['019', '020', '021', '022', '023', '024', '025'];
    const text = marked(makeTmpProject(), ids, (id) => `Entry ${id}`);
    assert.equal(text.split('\n').length - 1, ANCHOR_KEEP);
    assert.match(text, /\[Foreman: 019\]/);
    assert.ok(!text.includes('[Foreman: 025]'), text);
  });

  test('long titles stop at the character ceiling, never mid-line', () => {
    const ids = ['019', '020', '021', '022', '023', '024'];
    const text = marked(makeTmpProject(), ids, (id) => `Entry ${id} ${'x'.repeat(200)}`);
    assert.ok(text.length <= ANCHOR_MAX_CHARS, `block ran to ${text.length} chars`);
    for (const line of text.split('\n').slice(1)) {
      assert.match(line, /^- \S+ carries \[Foreman: \d{3}\] — Entry \d{3} x{200}$/);
    }
  });

  test('an unresolvable id never spends a slot a real anchor could use', () => {
    const project = makeTmpProject();
    writeRoadmap(project, [entry(), { ...entry(), id: '900', title: 'The real one' }]);
    fs.mkdirSync(path.join(project, 'src', 'Auth'), { recursive: true });
    // Seven stray ids ahead of the only one that resolves.
    fs.writeFileSync(
      path.join(project, 'src', 'Auth', 'session.js'),
      ['701', '702', '703', '704', '705', '706', '707', '900']
        .map((id) => `// [Foreman: ${id}]`)
        .join('\n'),
      'utf-8'
    );
    const text = anchorsText(project, { id: '001', planned_touches: ['src/Auth/session.js'] }, 'docs/foreman');
    assert.match(text, /\[Foreman: 900\] — The real one/);
  });
});

describe('the first-relevant ask', () => {
  const CRAFT = path.join(SCRIPTS_DIR, 'craft-handoff.js');

  const JUDGMENT = {
    role: 'a senior backend engineer',
    goal: 'to refresh tokens before expiry so all tests pass',
    context: 'JWT in httpOnly cookies.',
    steps: ['Fix the refresh path.'],
    constraints: ['Do not change the public API.'],
    verification: [{ run: 'npm test', expected: 'all tests pass' }],
  };

  // A closed entry that already touched the file this one plans to — the
  // overlap that makes the question worth putting at all.
  function overlapping(config) {
    const project = makeTmpProject();
    writeRoadmap(project, [
      entry({ status: 'planned' }),
      { ...entry(), id: '002', title: 'Earlier work', status: 'done' },
    ]);
    fs.mkdirSync(path.join(project, 'src', 'Auth'), { recursive: true });
    fs.writeFileSync(path.join(project, 'src', 'Auth', 'session.js'), 'const a = 1;\n', 'utf-8');
    if (config) {
      fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
      fs.writeFileSync(path.join(project, '.foreman', 'config.json'), JSON.stringify(config), 'utf-8');
    }
    return project;
  }

  // The ambient overrides have to be absent, not empty: an empty string is
  // still a defined variable, which is exactly what suppresses the ask.
  function cleanEnv(project) {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: project };
    delete env.FOREMAN_LEDGER;
    delete env.FOREMAN_AREA_NOTES;
    delete env.FOREMAN_DECISION_LOG;
    return env;
  }

  function craft(project) {
    const result = spawnSync(process.execPath, [CRAFT], {
      input: JSON.stringify({ entry: '001', destination: 'clipboard', judgment: JUDGMENT }),
      encoding: 'utf-8',
      env: cleanEnv(project),
    });
    return JSON.parse(result.stdout);
  }

  test('an unanswered project is asked, under the current field name', () => {
    assert.equal(craft(overlapping(null)).ledger_ask, true);
  });

  test('an answered project is never asked again', () => {
    assert.equal('ledger_ask' in craft(overlapping({ ledger: { enabled: false } })), false);
  });

  test('an answer recorded under either older key still counts as answered', () => {
    assert.equal('ledger_ask' in craft(overlapping({ areaNotes: { enabled: false } })), false);
    assert.equal('ledger_ask' in craft(overlapping({ decisionLog: { enabled: true } })), false);
  });
});
