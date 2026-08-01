'use strict';

// Tests for `roadmap.js doctor` / `doctor --fix` and the write gate that
// shares its validator (scripts/roadmap-doctor.js).
//
// Covers:
//   - a clean roadmap (and no config file) produces zero findings
//   - every finding code fires at least once on a matching corruption
//   - severities: a consumer-breaking violation is an error, a mechanically
//     recoverable or merely suspicious one is a warning
//   - --fix applies only the repairable findings, leaves ambiguous ones
//     reported, is idempotent, and does not write when there is nothing to fix
//   - the write path rejects a mutation that would introduce a structural
//     error, while still allowing mutations on a file that was already broken
//   - a fixture modeled on the production roadmap's shapes validates with
//     zero errors

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runRoadmap, makeTmpProject, writeRoadmap, writeConfig } = require('./helpers');

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

function doctor(flags = []) {
  return run(['doctor', ...flags]).json;
}

// doctor always closes with one severity:'info' disclosure naming the hook
// events Foreman depends on. It is not a defect and counts toward neither
// summary total, so every "nothing wrong here" assertion reads past it.
function defects(findings) {
  return findings.filter((item) => item.severity !== 'info');
}

// Distinct wording per id on purpose: entries built from one shared
// template score high enough on the duplicate heuristic to add a
// similar_titles warning to every fixture.
function base(id, overrides = {}) {
  return {
    id,
    title: `sig${id}`,
    why: `rationale ${id}`,
    what: `work ${id}`,
    status: 'planned',
    source: 'user',
    depends_on: [],
    planned_touches: [],
    observed_touches: [],
    commits: [],
    created_at: '2026-07-01',
    updated_at: '2026-07-01',
    notes: '',
    ...overrides,
  };
}

/** The stored entries, without the format marker every write stamps first. */
function storedEntries() {
  return fs
    .readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((row) => row.id !== undefined);
}

/** Findings carrying a given code. */
function withCode(report, code) {
  return report.findings.filter((f) => f.code === code);
}

function assertFinding(report, code, severity, ids) {
  const hits = withCode(report, code);
  assert.ok(hits.length, `expected a ${code} finding, got ${JSON.stringify(report.findings.map((f) => f.code))}`);
  if (severity) assert.equal(hits[0].severity, severity);
  if (ids) assert.deepEqual(hits[0].ids, ids);
  return hits[0];
}

describe('doctor on a healthy roadmap', () => {
  test('a clean roadmap and no config produce zero findings', () => {
    writeRoadmap(project, [base('001'), base('002', { depends_on: ['001'] })]);
    const { status, json } = run(['doctor']);
    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.deepEqual(defects(json.findings), []);
    assert.deepEqual(json.summary, { errors: 0, warnings: 0 });
  });

  test('a missing roadmap is the uninitialized case, not a finding', () => {
    const { json } = run(['doctor']);
    assert.equal(json.ok, true);
    assert.deepEqual(defects(json.findings), []);
  });

  test('a valid config produces no findings', () => {
    writeRoadmap(project, [base('001')]);
    writeConfig(project, {
      discoverySuggestions: false,
      usePersona: false,
      omitSections: ['tone', 'output_format'],
      taskCloseGate: 'block',
      trialLog: true,
      fableEnabled: true,
      requireVerification: false,
      decisionLog: { enabled: true, dir: 'docs/foreman', gate: 'off' },
      checkpoints: { branch: true, onFinish: 'squash', baseBranch: 'main' },
    });
    assert.deepEqual(defects(doctor().findings), []);
  });

  test('ok reports roadmap health, and the call itself still exits 0', () => {
    writeRoadmap(project, [base('001', { status: 'nonsense' })]);
    const { status, json } = run(['doctor']);
    assert.equal(status, 0);
    assert.equal(json.ok, false);
    assert.equal(json.error, undefined);
    assert.equal(json.summary.errors, 1);
  });
});

describe('doctor field and type findings', () => {
  test('missing_field: an absent title is an error, either absent touch surface a repairable warning', () => {
    const noTitle = base('001');
    delete noTitle.title;
    const noTouches = base('002');
    delete noTouches.planned_touches;
    delete noTouches.observed_touches;
    writeRoadmap(project, [noTitle, noTouches]);
    const report = doctor();
    const title = withCode(report, 'missing_field').find((f) => f.field === 'title');
    assert.equal(title.severity, 'error');
    assert.equal(title.repairable, false);
    for (const field of ['planned_touches', 'observed_touches']) {
      const found = withCode(report, 'missing_field').find((f) => f.field === field);
      assert.equal(found.severity, 'warning', field);
      assert.equal(found.repairable, true, field);
    }
  });

  test('invalid_type: depends_on that is not an array', () => {
    writeRoadmap(project, [base('001', { depends_on: 'nope' })]);
    assertFinding(doctor(), 'invalid_type', 'error', ['001']);
  });

  test('invalid_type: a line that is not a JSON object', () => {
    writeRoadmap(project, [base('001'), 42]);
    const finding = assertFinding(doctor(), 'invalid_type', 'error');
    assert.match(finding.message, /line 2 is not a JSON object/);
  });

  test('invalid_type: a non-string item inside planned_touches', () => {
    writeRoadmap(project, [base('001', { planned_touches: ['src/a.ts', 7] })]);
    assertFinding(doctor(), 'invalid_type', 'error', ['001']);
  });

  test('invalid_type: a non-string item inside observed_touches', () => {
    writeRoadmap(project, [base('001', { observed_touches: ['src/a.ts', 7] })]);
    assertFinding(doctor(), 'invalid_type', 'error', ['001']);
  });

  test('invalid_id: an id that is not zero-padded digits', () => {
    writeRoadmap(project, [base('task-1')]);
    assertFinding(doctor(), 'invalid_id', 'error', ['task-1']);
  });

  test('duplicate_id: the same id on two lines', () => {
    writeRoadmap(project, [base('001'), base('001', { title: 'other' })]);
    assertFinding(doctor(), 'duplicate_id', 'error', ['001']);
  });

  test('invalid_date: an impossible updated_at', () => {
    writeRoadmap(project, [base('001', { updated_at: '2026-13-45' })]);
    assertFinding(doctor(), 'invalid_date', 'error', ['001']);
  });

  test('invalid_path: a planned_touches hint that escapes the project', () => {
    writeRoadmap(project, [base('001', { planned_touches: ['../secrets.env'] })]);
    assertFinding(doctor(), 'invalid_path', 'warning', ['001']);
  });

  // [Foreman: 130] The trust boundary is on the hand-written half only.
  // observed_touches is whatever `git show --name-only --relative` reported;
  // a path that looks odd there is the repository's, not a roadmap defect,
  // and no repair here could change it.
  test('invalid_path is NOT raised for observed_touches — that half comes from git', () => {
    writeRoadmap(project, [base('001', { observed_touches: ['../secrets.env'] })]);
    assert.deepEqual(withCode(doctor(), 'invalid_path'), []);
  });

  test('invalid_doc: a doc that is neither "none" nor a relative .md path', () => {
    writeRoadmap(project, [base('001', { doc: '/etc/passwd' })]);
    assertFinding(doctor(), 'invalid_doc', 'error', ['001']);
  });

  // The file's format version lives on its own first line, not on an entry
  // — full coverage of the marker is in roadmap_migrate.test.js.
  test('unsupported_schema_version: a format marker no reader will honor', () => {
    fs.writeFileSync(
      path.join(project, 'ROADMAP.jsonl'),
      `{"foreman_roadmap_format":"one"}\n${JSON.stringify(base('001'))}\n`,
      'utf-8'
    );
    assertFinding(doctor(), 'unsupported_schema_version', 'error', []);
  });

  test('an unversioned file is the compatible state — absence means format 1', () => {
    writeRoadmap(project, [base('001')]);
    assert.deepEqual(withCode(doctor(), 'unsupported_schema_version'), []);
  });
});

describe('doctor enum findings', () => {
  test('unknown_status is an error', () => {
    writeRoadmap(project, [base('001', { status: 'in_review' })]);
    assertFinding(doctor(), 'unknown_status', 'error', ['001']);
  });

  test('unknown_source is only a warning — early entries predate the closed set', () => {
    writeRoadmap(project, [base('001', { source: 'user-requested' })]);
    const report = doctor();
    assertFinding(report, 'unknown_source', 'warning', ['001']);
    assert.equal(report.summary.errors, 0);
  });

  test('unknown_kind is an error', () => {
    writeRoadmap(project, [base('001', { kind: 'research' })]);
    assertFinding(doctor(), 'unknown_kind', 'error', ['001']);
  });

  test('unknown_model is an error', () => {
    writeRoadmap(project, [base('001', { model: 'gpt' })]);
    assertFinding(doctor(), 'unknown_model', 'error', ['001']);
  });

  test('unknown_effort is an error', () => {
    writeRoadmap(project, [base('001', { effort: 'extreme' })]);
    assertFinding(doctor(), 'unknown_effort', 'error', ['001']);
  });
});

describe('doctor graph findings', () => {
  test('missing_dependency: an id that does not exist', () => {
    writeRoadmap(project, [base('001', { depends_on: ['099'] })]);
    const finding = assertFinding(doctor(), 'missing_dependency', 'error', ['001']);
    assert.equal(finding.repairable, false);
  });

  test('self_dependency is a repairable error', () => {
    writeRoadmap(project, [base('001', { depends_on: ['001'] })]);
    const finding = assertFinding(doctor(), 'self_dependency', 'error', ['001']);
    assert.equal(finding.repairable, true);
  });

  test('duplicate_dependency is a repairable warning', () => {
    writeRoadmap(project, [base('001'), base('002', { depends_on: ['001', '001'] })]);
    const finding = assertFinding(doctor(), 'duplicate_dependency', 'warning', ['002']);
    assert.equal(finding.repairable, true);
  });

  test('dependency_cycle: two entries depending on each other', () => {
    writeRoadmap(project, [
      base('001', { depends_on: ['002'] }),
      base('002', { depends_on: ['001'] }),
    ]);
    const finding = assertFinding(doctor(), 'dependency_cycle', 'error');
    assert.equal(finding.repairable, false);
  });

  test('stranded_dependency: an open entry waiting on a dropped one', () => {
    writeRoadmap(project, [
      base('001', { status: 'dropped' }),
      base('002', { depends_on: ['001'] }),
    ]);
    assertFinding(doctor(), 'stranded_dependency', 'warning', ['002']);
  });

  test('a dependency on a done entry is not stranded', () => {
    writeRoadmap(project, [
      base('001', { status: 'done', commits: ['a1b2c3d'] }),
      base('002', { depends_on: ['001'] }),
    ]);
    assert.deepEqual(withCode(doctor(), 'stranded_dependency'), []);
  });

  test('similar_titles: two entries that read like the same task', () => {
    writeRoadmap(project, [
      base('001', { title: 'Add JWT refresh middleware', why: 'sessions expire mid-request under load' }),
      base('002', { title: 'Add JWT refresh middleware again', why: 'sessions expire mid-request under load' }),
    ]);
    assertFinding(doctor(), 'similar_titles', 'warning', ['001', '002']);
  });

  test('terminal_without_evidence: done with no commits and no notes', () => {
    writeRoadmap(project, [base('001', { status: 'done' })]);
    assertFinding(doctor(), 'terminal_without_evidence', 'warning', ['001']);
  });

  test('a done entry with notes but no commits records its evidence', () => {
    writeRoadmap(project, [base('001', { status: 'done', notes: '2026-07-01 closed via staged trailer' })]);
    assert.deepEqual(withCode(doctor(), 'terminal_without_evidence'), []);
  });
});

describe('doctor config findings', () => {
  test('unknown_config_key is a warning — a newer Foreman key is not corruption', () => {
    writeRoadmap(project, [base('001')]);
    writeConfig(project, { someFutureFlag: true });
    const report = doctor();
    assertFinding(report, 'unknown_config_key', 'warning', []);
    assert.equal(report.summary.errors, 0);
  });

  test('invalid_config_value: a known key with a value no reader accepts', () => {
    writeRoadmap(project, [base('001')]);
    writeConfig(project, { taskCloseGate: 'nudge' });
    const finding = assertFinding(doctor(), 'invalid_config_value', 'error');
    assert.equal(finding.field, 'taskCloseGate');
  });

  test('invalid_config_value reaches nested groups', () => {
    writeRoadmap(project, [base('001')]);
    writeConfig(project, { decisionLog: { dir: '../elsewhere' }, checkpoints: { onFinish: 'rebase' } });
    const fields = withCode(doctor(), 'invalid_config_value').map((f) => f.field);
    assert.deepEqual(fields.sort(), ['checkpoints.onFinish', 'decisionLog.dir']);
  });

  test('unknown_config_key reaches nested groups', () => {
    writeRoadmap(project, [base('001')]);
    writeConfig(project, { decisionLog: { push: true } });
    assert.equal(assertFinding(doctor(), 'unknown_config_key', 'warning').field, 'decisionLog.push');
  });

  test('unreadable_config: the file exists but is not JSON', () => {
    writeRoadmap(project, [base('001')]);
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{ not json', 'utf-8');
    assertFinding(doctor(), 'unreadable_config', 'error');
  });
});

describe('doctor --fix', () => {
  test('repairs absent container fields without touching updated_at', () => {
    const entry = base('001');
    delete entry.planned_touches;
    delete entry.observed_touches;
    delete entry.commits;
    delete entry.notes;
    writeRoadmap(project, [entry]);

    const report = doctor(['--fix']);
    assert.equal(report.fixed.length, 4);
    assert.deepEqual(defects(report.findings), []);

    const stored = storedEntries()[0];
    assert.deepEqual(stored.planned_touches, []);
    assert.deepEqual(stored.observed_touches, []);
    assert.deepEqual(stored.commits, []);
    assert.equal(stored.notes, '');
    assert.equal(stored.updated_at, '2026-07-01');
  });

  test('drops a self-dependency edge and a repeated dependency id', () => {
    writeRoadmap(project, [
      base('001'),
      base('002', { depends_on: ['002', '001', '001'] }),
    ]);
    const report = doctor(['--fix']);
    assert.deepEqual(report.fixed.map((f) => f.code).sort(), ['duplicate_dependency', 'self_dependency']);
    assert.deepEqual(storedEntries()[1].depends_on, ['001']);
    assert.equal(report.ok, true);
  });

  test('leaves ambiguous findings alone and still reports them', () => {
    const entry = base('002', { depends_on: ['099'], status: 'mystery' });
    delete entry.planned_touches;
    writeRoadmap(project, [base('001'), entry]);

    const report = doctor(['--fix']);
    assert.deepEqual(report.fixed.map((f) => f.code), ['missing_field']);
    const codes = defects(report.findings).map((f) => f.code).sort();
    assert.deepEqual(codes, ['missing_dependency', 'unknown_status']);
    assert.equal(report.ok, false);
  });

  test('is idempotent — a second run changes nothing', () => {
    const entry = base('001');
    delete entry.depends_on;
    writeRoadmap(project, [entry]);

    doctor(['--fix']);
    const afterFirst = fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8');
    const second = doctor(['--fix']);
    assert.deepEqual(second.fixed, []);
    assert.equal(fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8'), afterFirst);
  });

  test('does not rewrite a healthy roadmap', () => {
    writeRoadmap(project, [base('001')]);
    const before = fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8');
    const report = doctor(['--fix']);
    assert.deepEqual(report.fixed, []);
    assert.equal(fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8'), before);
  });

  test('a config-only problem is reported, never repaired', () => {
    writeRoadmap(project, [base('001')]);
    writeConfig(project, { usePersona: 'yes' });
    const report = doctor(['--fix']);
    assert.deepEqual(report.fixed, []);
    assertFinding(report, 'invalid_config_value', 'error');
  });
});

describe('the write path validates the whole structural contract', () => {
  test('add is rejected when the resulting file would carry a bad planned_touches item', () => {
    const { status, json } = run(['add'], {
      title: 'a', why: 'a', what: 'a', source: 'user', planned_touches: ['src/a.ts', 42],
    });
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /refusing to write ROADMAP\.jsonl/);
    assert.match(json.error, /invalid_type/);
    assert.equal(fs.existsSync(path.join(project, 'ROADMAP.jsonl')), false);
  });

  test('update-status rejects a malformed commit at the input gate, file untouched', () => {
    // [Foreman: 186] `commit` now has its own shape check, so a non-sha is
    // refused before the write gate ever runs — the whole-file contract
    // stays the backstop behind it, as the add case above still proves.
    writeRoadmap(project, [base('001')]);
    const before = fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8');
    const { status, json } = run(['update-status'], { id: '001', status: 'done', commit: 42 });
    assert.equal(status, 1);
    assert.match(json.error, /hex sha/);
    assert.equal(fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8'), before);
  });

  test('damage the mutation did not cause never blocks the write', () => {
    // A legacy entry missing source/created_at cannot be repaired
    // mechanically; refusing every write would strand the whole roadmap.
    const legacy = base('001');
    delete legacy.source;
    delete legacy.created_at;
    writeRoadmap(project, [legacy, base('002')]);

    const { status, json } = run(['update-status'], { id: '002', status: 'in_progress' });
    assert.equal(status, 0);
    assert.equal(json.entry.status, 'in_progress');
    assert.equal(doctor().summary.errors, 2);
  });
});

describe('production roadmap shapes stay valid', () => {
  test('a corpus modeled on the real roadmap validates with zero errors', () => {
    const longNote = Array.from({ length: 12 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')} finding ${i}: `
      + 'checked scripts/roadmap.js and hooks/post-commit.js, folded the derived touches back in, '
      + 'and recorded what actually shipped rather than what was planned.').join('\n');
    writeRoadmap(project, [
      // ids with gaps, every status the corpus contains, model/effort/doc/kind
      base('001', { status: 'done', commits: ['a1b2c3d'], notes: 'closed', doc: 'none' }),
      base('004', { status: 'done', commits: [], notes: longNote, model: 'opus', effort: 'high' }),
      base('017', { status: 'done', commits: ['9f0547f', 'cd74e07'], notes: 'shipped', doc: 'docs/foreman/017.md' }),
      base('042', { status: 'deferred', depends_on: ['017'], notes: 'waiting on an external trigger' }),
      base('085', { status: 'rejected', source: 'claude-suggested', notes: 'declined at proposal time' }),
      base('102', { status: 'dropped', notes: 'not worth doing' }),
      base('119', {
        status: 'done',
        kind: 'decision',
        doc: 'docs/foreman/119.md',
        commits: ['221ae39'],
        notes: 'decided, no code',
        model: 'sonnet',
        effort: 'xhigh',
      }),
      base('124', {
        status: 'in_progress',
        depends_on: ['119'],
        planned_touches: ['scripts/roadmap.js', 'tests/'],
        observed_touches: ['scripts/roadmap.js', 'tests/roadmap.test.js'],
      }),
      base('161', { kind: 'decision', source: 'claude-suggested' }),
      // the one legacy source value the real corpus still carries
      base('176', { source: 'user-requested', depends_on: ['124'] }),
    ]);

    const report = doctor();
    assert.equal(report.summary.errors, 0, JSON.stringify(report.findings));
    assert.equal(report.ok, true);
    assert.deepEqual(withCode(report, 'unknown_source').map((f) => f.ids), [['176']]);
  });

  test('mutations keep working on that corpus', () => {
    writeRoadmap(project, [
      base('001', { status: 'done', commits: ['a1b2c3d'], notes: 'closed' }),
      base('119', { status: 'done', kind: 'decision', doc: 'docs/foreman/119.md', notes: 'decided' }),
      base('176', { source: 'user-requested', depends_on: ['001'] }),
    ]);
    assert.equal(run(['update-status'], { id: '176', status: 'in_progress' }).status, 0);
    assert.equal(run(['annotate'], { id: '176', notes: 'breadcrumb' }).status, 0);
    assert.equal(run(['update-deps'], { id: '176', add_depends_on: ['119'] }).status, 0);
    assert.equal(run(['add'], { title: 'new work', why: 'w', what: 'w', source: 'user' }).json.entry.id, '177');
    assert.equal(doctor().summary.errors, 0);
  });
});
