'use strict';

// [Foreman: 131] The `awaiting_acceptance` lifecycle state — implementation
// finished AND checked, waiting only on the user's yes.
//
// Covers:
//   - update-status/correct/annotate accept it; `add` cannot create it
//   - next-candidates never offers one as a candidate, and surfaces them in
//     their own compact array (both shapes, absent when empty)
//   - openness: an awaiting parent does NOT satisfy a dependent, an awaiting
//     dependent still counts toward unblocks, archive refuses it
//   - collision stays in_progress-only: awaiting work is already committed
//   - doctor knows the status and warns when it records no evidence
//   - the two skills and session-start say the same thing the code does

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  runRoadmap,
  runScriptRaw,
  makeTmpProject,
  writeRoadmap,
} = require('./helpers');

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

// Distinct wording per id — a shared template scores high enough on the
// duplicate heuristic to add similar_titles warnings to every fixture.
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

function readSkill(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf-8');
}

describe('awaiting_acceptance as a status value', () => {
  test('update-status accepts it and records the commit alongside', () => {
    writeRoadmap(project, [entry('001', { status: 'in_progress' })]);

    const { status, json } = run(['update-status'], {
      id: '001',
      status: 'awaiting_acceptance',
      commit: 'a1b2c3d',
      notes: 'suite green',
    });

    assert.equal(status, 0);
    assert.equal(json.entry.status, 'awaiting_acceptance');
    assert.deepEqual(json.entry.commits, ['a1b2c3d']);
  });

  test('the recovery path back to in_progress works', () => {
    writeRoadmap(project, [entry('001', { status: 'awaiting_acceptance' })]);

    const { json } = run(['update-status'], {
      id: '001',
      status: 'in_progress',
      notes: 'user says the edge case is still broken',
    });

    assert.equal(json.entry.status, 'in_progress');
  });

  test('add cannot create an entry already awaiting acceptance', () => {
    const { status, json } = run(['add'], {
      title: 'a',
      why: 'a',
      what: 'a',
      source: 'user',
      status: 'awaiting_acceptance',
    });

    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /add status must be one of/);
  });

  test('correct still works on an awaiting entry — it is not history yet', () => {
    writeRoadmap(project, [entry('001', { status: 'awaiting_acceptance' })]);

    const { status, json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { what: 'work 001' },
      what: 'work 001, restated',
    });

    assert.equal(status, 0);
    assert.deepEqual(json.changed, ['what']);
  });

  test('annotate still appends on an awaiting entry without moving status', () => {
    writeRoadmap(project, [entry('001', { status: 'awaiting_acceptance' })]);

    const { status, json } = run(['annotate'], { id: '001', notes: 'ping' });

    assert.equal(status, 0);
    assert.equal(json.entry.status, 'awaiting_acceptance');
    assert.match(json.entry.notes, /ping/);
  });
});

describe('awaiting_acceptance is never a candidate', () => {
  test('an awaiting entry is not offered as work to start', () => {
    writeRoadmap(project, [
      entry('001', { status: 'awaiting_acceptance' }),
      entry('002', { status: 'planned' }),
    ]);

    const { json } = run(['next-candidates']);

    assert.deepEqual(json.candidates.map((c) => c.id), ['002']);
    assert.equal(json.total_unblocked, 1);
  });

  test('an awaiting parent does not satisfy its dependent', () => {
    writeRoadmap(project, [
      entry('001', { status: 'awaiting_acceptance' }),
      entry('002', { status: 'planned', depends_on: ['001'] }),
    ]);

    const { json } = run(['next-candidates']);

    assert.deepEqual(json.candidates, []);
    assert.equal(json.total_unblocked, 0);
  });

  test('the dispatch readiness guard refuses an awaiting dependency', () => {
    writeRoadmap(project, [
      entry('001', { status: 'awaiting_acceptance' }),
      entry('002', { status: 'planned', depends_on: ['001'] }),
    ]);

    const { json } = run(['update-status'], {
      id: '002',
      status: 'in_progress',
      expected_status: 'planned',
      require_ready: true,
    });

    assert.equal(json.skipped, true);
    assert.equal(json.reason, 'dependencies_not_done');
    assert.deepEqual(json.blocking_dependencies.map((d) => d.status), ['awaiting_acceptance']);
  });

  test('moving a parent to awaiting unblocks nothing', () => {
    writeRoadmap(project, [
      entry('001', { status: 'in_progress' }),
      entry('002', { status: 'planned', depends_on: ['001'] }),
    ]);

    const { json } = run(['update-status'], { id: '001', status: 'awaiting_acceptance' });

    assert.equal(json.newly_unblocked, undefined);
  });

  test('an awaiting dependent still counts as open work behind a candidate', () => {
    writeRoadmap(project, [
      entry('001', { status: 'planned' }),
      entry('002', { status: 'awaiting_acceptance', depends_on: ['001'] }),
    ]);

    const { json } = run(['next-candidates']);

    assert.equal(json.candidates[0].id, '001');
    assert.equal(json.candidates[0].unblocks, 1);
    assert.equal(json.candidates[0].unblocks_total, 1);
  });
});

describe('next-candidates awaiting_acceptance array', () => {
  const waiting = () =>
    writeRoadmap(project, [
      entry('001', { status: 'awaiting_acceptance', updated_at: '2026-07-05' }),
      entry('002', { status: 'planned' }),
    ]);

  test('full shape carries compact rows', () => {
    waiting();

    const { json } = run(['next-candidates']);

    assert.deepEqual(json.awaiting_acceptance, [
      { id: '001', title: 'sig001', why: 'rationale 001', updated_at: '2026-07-05' },
    ]);
  });

  test('--menu carries the identical rows', () => {
    waiting();

    const { json } = run(['next-candidates', '--menu']);

    assert.deepEqual(json.awaiting_acceptance, [
      { id: '001', title: 'sig001', why: 'rationale 001', updated_at: '2026-07-05' },
    ]);
  });

  test('awaiting entries are not folded into in_progress — the action differs', () => {
    writeRoadmap(project, [
      entry('001', { status: 'awaiting_acceptance' }),
      entry('002', { status: 'in_progress' }),
    ]);

    const { json } = run(['next-candidates', '--menu']);

    assert.deepEqual(json.in_progress.map((e) => e.id), ['002']);
    assert.deepEqual(json.awaiting_acceptance.map((e) => e.id), ['001']);
  });

  test('the key is absent, not empty, when nothing is waiting', () => {
    writeRoadmap(project, [entry('001', { status: 'planned' })]);

    assert.equal(run(['next-candidates']).json.awaiting_acceptance, undefined);
    assert.equal(run(['next-candidates', '--menu']).json.awaiting_acceptance, undefined);
  });
});

// The decision, pinned: collision is the proxy for "someone is mid-flight in
// these files". An awaiting entry's work is committed, so its touches cannot
// conflict with anything — only in_progress entries populate the set.
describe('collision stays in_progress-only', () => {
  test('overlapping an awaiting entry does not flag a candidate', () => {
    writeRoadmap(project, [
      entry('001', { status: 'awaiting_acceptance', touches: ['src/auth'] }),
      entry('002', { status: 'planned', touches: ['src/auth/session.ts'] }),
    ]);

    assert.equal(run(['next-candidates']).json.candidates[0].collision, false);
  });

  test('overlapping an in_progress entry still flags it', () => {
    writeRoadmap(project, [
      entry('001', { status: 'in_progress', touches: ['src/auth'] }),
      entry('002', { status: 'planned', touches: ['src/auth/session.ts'] }),
    ]);

    assert.equal(run(['next-candidates']).json.candidates[0].collision, true);
  });
});

describe('archive refuses an awaiting entry', () => {
  test('it is open work, not history', () => {
    writeRoadmap(project, [entry('001', { status: 'awaiting_acceptance' })]);

    const { status, json } = run(['archive'], { ids: ['001'] });

    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /entry 001 is awaiting_acceptance — only done\/dropped\/rejected/);
  });
});

describe('doctor', () => {
  test('knows the status — no unknown_status finding', () => {
    writeRoadmap(project, [entry('001', { status: 'awaiting_acceptance', notes: 'suite green' })]);

    const report = run(['doctor']).json;

    assert.equal(report.ok, true);
    assert.deepEqual(report.findings.filter((f) => f.code === 'unknown_status'), []);
  });

  test('awaiting_without_evidence warns when nothing records the work', () => {
    writeRoadmap(project, [entry('001', { status: 'awaiting_acceptance' })]);

    const finding = run(['doctor']).json.findings.find(
      (f) => f.code === 'awaiting_without_evidence'
    );

    assert.ok(finding, 'expected an awaiting_without_evidence finding');
    assert.equal(finding.severity, 'warning');
    assert.deepEqual(finding.ids, ['001']);
    assert.equal(finding.repairable, false);
  });

  test('a recorded commit or a note is evidence enough', () => {
    writeRoadmap(project, [
      entry('001', { status: 'awaiting_acceptance', commits: ['a1b2c3d'] }),
      entry('002', { status: 'awaiting_acceptance', notes: 'investigated, nothing to commit' }),
    ]);

    const codes = run(['doctor']).json.findings.map((f) => f.code);

    assert.ok(!codes.includes('awaiting_without_evidence'));
  });

  test('a done entry still reports terminal_without_evidence, not the new code', () => {
    writeRoadmap(project, [entry('001', { status: 'done' })]);

    const codes = run(['doctor']).json.findings.map((f) => f.code);

    assert.ok(codes.includes('terminal_without_evidence'));
    assert.ok(!codes.includes('awaiting_without_evidence'));
  });

  test('an awaiting dependent of a dropped parent is still stranded', () => {
    writeRoadmap(project, [
      entry('001', { status: 'dropped', notes: 'abandoned' }),
      entry('002', { status: 'awaiting_acceptance', depends_on: ['001'], notes: 'x' }),
    ]);

    const codes = run(['doctor']).json.findings.map((f) => f.code);

    assert.ok(codes.includes('stranded_dependency'));
  });
});

describe('session-start surfaces awaiting work', () => {
  function sessionStart() {
    const result = runScriptRaw('session-start.js', { source: 'startup' }, env);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }

  test('an awaiting entry is announced as waiting on the user', () => {
    writeRoadmap(project, [entry('001', { status: 'awaiting_acceptance', title: 'Ship it' })]);

    const out = sessionStart();

    assert.match(out, /Ship it/);
    assert.match(out, /awaiting your acceptance/);
  });

  test('an in_progress entry is not tagged as awaiting', () => {
    writeRoadmap(project, [entry('001', { status: 'in_progress', title: 'Still going' })]);

    const out = sessionStart();

    assert.match(out, /Still going/);
    assert.doesNotMatch(out, /awaiting your acceptance/);
  });
});

describe('skill contracts', () => {
  test('the roadmap skill offers acceptance and the send-back path', () => {
    const skill = readSkill('skills', 'roadmap', 'pick.md');

    assert.match(skill, /`Accept: <title> \(<id>\)`/);
    assert.match(skill, /"status":"done"/);
    assert.match(skill, /accept options lead/);
    assert.match(skill, /declining sends it back/);
  });

  // [Foreman: 185] The primary close path honors requireVerification: the
  // embedded paragraph holds an earned done for acceptance, gated at craft
  // time by the preparation result.
  //
  // entry 203: skills/roadmap/pick.md no longer embeds this paragraph or
  // explains its gating in prose — craft-handoff.js's entryParagraphText
  // bakes the hold sentence directly from a `requireVerification` argument,
  // so this pins the guarantee at its new home (not already covered by
  // craft-handoff.test.js).
  test('the entry paragraph (craft-handoff.js) holds done for acceptance, config-gated', () => {
    const { entryParagraphText } = require('../scripts/craft-handoff.js');
    const held = entryParagraphText({
      id: '001',
      resume: false,
      requireVerification: true,
      decisionLogEnabled: false,
      isDecision: false,
      destination: 'clipboard',
    });
    assert.match(held, /write\s+`awaiting_acceptance` instead/);
    assert.match(held, /Say so in your final message too/);

    const notHeld = entryParagraphText({
      id: '001',
      resume: false,
      requireVerification: false,
      decisionLogEnabled: false,
      isDecision: false,
      destination: 'clipboard',
    });
    assert.doesNotMatch(notHeld, /awaiting_acceptance/);
    assert.doesNotMatch(notHeld, /Say so in your final message too/);
  });

  test('the schema documents the lifecycle and the downgrade cost', () => {
    const schema = readSkill('roadmap-schema.md');

    assert.match(schema, /planned ──> in_progress ──> awaiting_acceptance ──> done/);
    assert.match(schema, /not a transition matrix/);
    assert.match(schema, /Downgrade note/);
  });
});
