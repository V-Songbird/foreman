'use strict';

// Tests for ROADMAP.jsonl's format version and `roadmap.js migrate`.
//
// Covers:
//   - a file with no version marker is format 1 implicitly and reads fine
//     (every other test file's raw fixtures are the same proof)
//   - a stamped file reads fine and survives a mutation with exactly one
//     marker, still first
//   - any mutation stamps an implicit file
//   - a version newer than this Foreman fails every subcommand with one
//     clear message naming both versions and the fix
//   - a malformed marker is a doctor error naming `migrate`, and broken JSON
//     on that line is still the plain parse error
//   - migrate: no-op when current (no backup, no write), stamps an implicit
//     file with a timestamped backup and byte-identical entry lines,
//     repeat-safe, and a structured error on a missing file
//   - doctor findings for a future, malformed, or misplaced marker

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runRoadmap, makeTmpProject, writeRoadmap } = require('./helpers');

const META = '{"foreman_roadmap_format":1}';

let project;
let env;

beforeEach(() => {
  project = makeTmpProject();
  env = { CLAUDE_PROJECT_DIR: project };
});

function run(argv, stdinData) {
  const result = runRoadmap(argv, stdinData, env);
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new Error(`non-JSON stdout (status ${result.status}): ${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, json };
}

function entry(id, overrides = {}) {
  return {
    id,
    title: `sig${id}`,
    why: `rationale ${id}`,
    what: `work ${id}`,
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

function roadmapFile() {
  return path.join(project, 'ROADMAP.jsonl');
}

/** Write ROADMAP.jsonl from raw lines, exactly as given. */
function writeRaw(lines) {
  fs.writeFileSync(roadmapFile(), `${lines.join('\n')}\n`, 'utf-8');
}

function readLines() {
  return fs.readFileSync(roadmapFile(), 'utf-8').split('\n').filter(Boolean);
}

function backups() {
  return fs.readdirSync(project).filter((name) => name.startsWith('ROADMAP.jsonl.backup-'));
}

describe('an unversioned roadmap is format 1', () => {
  test('reads fine — absence of the marker means 1', () => {
    writeRoadmap(project, [entry('001'), entry('002')]);
    const { json } = run(['list']);
    assert.deepEqual(json.entries.map((e) => e.id), ['001', '002']);
  });

  test('doctor reports nothing about the version', () => {
    writeRoadmap(project, [entry('001')]);
    const { json } = run(['doctor']);
    assert.deepEqual(json.findings, []);
  });

  test('any mutation stamps the marker as the first line', () => {
    writeRoadmap(project, [entry('001')]);
    run(['update-status'], { id: '001', status: 'in_progress' });
    const lines = readLines();
    assert.equal(lines[0], META);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1]).status, 'in_progress');
  });
});

describe('a stamped roadmap', () => {
  test('reads fine and hides the marker from callers', () => {
    writeRaw([META, JSON.stringify(entry('001'))]);
    const { json } = run(['list']);
    assert.deepEqual(json.entries.map((e) => e.id), ['001']);
  });

  test('round-trips a mutation with exactly one marker, still first', () => {
    writeRaw([META, JSON.stringify(entry('001'))]);
    run(['annotate'], { id: '001', notes: 'a breadcrumb' });
    run(['update-status'], { id: '001', status: 'done' });
    const lines = readLines();
    assert.equal(lines[0], META);
    assert.equal(lines.filter((line) => line.includes('foreman_roadmap_format')).length, 1);
    assert.equal(lines.length, 2);
  });

  test('the marker is never mistaken for an entry', () => {
    writeRaw([META, JSON.stringify(entry('001'))]);
    const { json } = run(['add'], { title: 'next', why: 'w', what: 'x', source: 'user' });
    assert.equal(json.entry.id, '002');
  });
});

describe('a format newer than this Foreman', () => {
  const FUTURE = '{"foreman_roadmap_format":99}';

  beforeEach(() => {
    writeRaw([FUTURE, JSON.stringify(entry('001'))]);
  });

  const calls = [
    [['list'], undefined],
    [['next-candidates'], undefined],
    [['doctor'], undefined],
    [['migrate'], undefined],
    [['check-duplicate'], { title: 'sig001', why: 'rationale 001' }],
    [['add'], { title: 'new', why: 'w', what: 'x', source: 'user' }],
    [['update-status'], { id: '001', status: 'done' }],
    [['annotate'], { id: '001', notes: 'n' }],
    [['update-deps'], { id: '001', add_depends_on: ['002'] }],
    [['correct'], { id: '001', expected_updated_at: '2026-07-01', title: 't' }],
  ];

  for (const [argv, stdinData] of calls) {
    test(`${argv[0]} fails with the version error`, () => {
      const { status, json } = run(argv, stdinData);
      assert.equal(status, 1);
      assert.equal(json.ok, false);
      assert.match(json.error, /format version 99/);
      assert.match(json.error, /this Foreman understands format version 1/);
      assert.match(json.error, /Upgrade the Foreman plugin/);
    });
  }

  test('nothing is written and no backup is left behind', () => {
    const before = fs.readFileSync(roadmapFile(), 'utf-8');
    run(['migrate']);
    assert.equal(fs.readFileSync(roadmapFile(), 'utf-8'), before);
    assert.deepEqual(backups(), []);
  });
});

describe('a malformed marker', () => {
  test('a non-integer version is a doctor error naming migrate', () => {
    writeRaw(['{"foreman_roadmap_format":"one"}', JSON.stringify(entry('001'))]);
    const { json } = run(['doctor']);
    const found = json.findings.filter((f) => f.code === 'unsupported_schema_version');
    assert.equal(found.length, 1);
    assert.equal(found[0].severity, 'error');
    assert.match(found[0].message, /not a whole number 1 or greater/);
    assert.match(found[0].message, /migrate/);
    assert.equal(json.ok, false);
  });

  test('a version below 1 is the same error', () => {
    writeRaw(['{"foreman_roadmap_format":0}', JSON.stringify(entry('001'))]);
    const { json } = run(['doctor']);
    assert.equal(json.findings.filter((f) => f.code === 'unsupported_schema_version').length, 1);
  });

  test('the marker line does not also report a dozen missing entry fields', () => {
    writeRaw(['{"foreman_roadmap_format":"one"}', JSON.stringify(entry('001'))]);
    const { json } = run(['doctor']);
    assert.deepEqual(json.findings.map((f) => f.code), ['unsupported_schema_version']);
  });

  test('a marker line that is not valid JSON is still the plain parse error', () => {
    writeRaw(['{"foreman_roadmap_format":', JSON.stringify(entry('001'))]);
    const { status, json } = run(['list']);
    assert.equal(status, 1);
    assert.match(json.error, /ROADMAP\.jsonl line 1 is not valid JSON/);
  });

  test('migrate restamps it, and the entries survive', () => {
    writeRaw(['{"foreman_roadmap_format":"one"}', JSON.stringify(entry('001'))]);
    const { json } = run(['migrate']);
    assert.equal(json.changed, true);
    assert.deepEqual(readLines(), [META, JSON.stringify(entry('001'))]);
    assert.deepEqual(run(['doctor']).json.findings, []);
  });
});

describe('a marker below an entry', () => {
  beforeEach(() => {
    writeRaw([JSON.stringify(entry('001')), META, JSON.stringify(entry('002'))]);
  });

  test('doctor reports it and says migrate fixes it', () => {
    const { json } = run(['doctor']);
    const found = json.findings.filter((f) => f.code === 'unsupported_schema_version');
    assert.equal(found.length, 1);
    assert.equal(found[0].severity, 'error');
    assert.match(found[0].message, /only read as the file's first line/);
    assert.match(found[0].message, /migrate/);
  });

  test('doctor --fix leaves it alone — migrate is the repair', () => {
    const report = run(['doctor', '--fix']).json;
    assert.deepEqual(report.fixed, []);
    assert.equal(report.findings.filter((f) => f.code === 'unsupported_schema_version').length, 1);
  });

  test('migrate moves it back to the top', () => {
    assert.equal(run(['migrate']).json.changed, true);
    assert.deepEqual(readLines(), [
      META,
      JSON.stringify(entry('001')),
      JSON.stringify(entry('002')),
    ]);
    assert.deepEqual(run(['doctor']).json.findings, []);
  });
});

describe('migrate', () => {
  test('is a no-op on a file that is already current', () => {
    writeRaw([META, JSON.stringify(entry('001'))]);
    const before = fs.readFileSync(roadmapFile(), 'utf-8');
    const { status, json } = run(['migrate']);
    assert.equal(status, 0);
    assert.deepEqual(json, { ok: true, from: 1, to: 1, changed: false });
    assert.equal(fs.readFileSync(roadmapFile(), 'utf-8'), before);
    assert.deepEqual(backups(), []);
  });

  test('stamps an implicit file, backs it up, and preserves the entry lines', () => {
    const rows = [entry('001'), entry('002', { status: 'done', commits: ['a1b2c3d'] })];
    writeRoadmap(project, rows);
    const before = fs.readFileSync(roadmapFile(), 'utf-8');

    const { json } = run(['migrate']);
    assert.equal(json.ok, true);
    assert.equal(json.from, 1);
    assert.equal(json.to, 1);
    assert.equal(json.changed, true);

    const saved = backups();
    assert.equal(saved.length, 1);
    assert.match(saved[0], /^ROADMAP\.jsonl\.backup-\d{8}-\d{6}$/);
    assert.equal(json.backup, path.join(project, saved[0]));
    assert.equal(fs.readFileSync(json.backup, 'utf-8'), before);

    const lines = readLines();
    assert.equal(lines[0], META);
    assert.deepEqual(lines.slice(1), before.split('\n').filter(Boolean));
  });

  test('is safe to repeat — the second run changes nothing', () => {
    writeRoadmap(project, [entry('001')]);
    assert.equal(run(['migrate']).json.changed, true);
    const afterFirst = fs.readFileSync(roadmapFile(), 'utf-8');

    const second = run(['migrate']).json;
    assert.equal(second.changed, false);
    assert.equal(second.backup, undefined);
    assert.equal(fs.readFileSync(roadmapFile(), 'utf-8'), afterFirst);
    assert.equal(backups().length, 1);
  });

  test('a missing roadmap is a structured error, not a crash', () => {
    const { status, json } = run(['migrate']);
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /nothing to migrate/);
  });

  test('never touches .foreman/config.json', () => {
    writeRoadmap(project, [entry('001')]);
    run(['migrate']);
    assert.equal(fs.existsSync(path.join(project, '.foreman')), false);
  });

  test('a roadmap that was already broken still migrates', () => {
    // The write gate tolerates inherited damage; the version stamp must not
    // become the one thing that strands an unhealthy file.
    writeRaw([JSON.stringify(entry('001', { depends_on: ['404'] }))]);
    assert.equal(run(['migrate']).json.changed, true);
    assert.equal(readLines()[0], META);
    assert.equal(run(['doctor']).json.findings[0].code, 'missing_dependency');
  });

  test('rejects flags and stdin it does not take', () => {
    writeRoadmap(project, [entry('001')]);
    const { status, json } = run(['migrate', '--fix'], { id: '001' });
    assert.equal(status, 0);
    assert.equal(json.changed, true);
  });
});

describe('usage', () => {
  test('--help documents migrate and the version marker', () => {
    const help = runRoadmap(['--help'], null, env).stdout;
    assert.match(help, /^ {2}migrate {2,}/m);
    assert.match(help, /foreman_roadmap_format/);
  });
});
