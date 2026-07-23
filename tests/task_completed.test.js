'use strict';

// hooks/task-completed.js — the mechanical close-gate mirroring
// task-created.js's open transition:
//   - fires only when task_description carries the embedded entry marker
//   - gates completion while the named entry is still planned/in_progress
//   - silent no-op for every other state, a missing/corrupt roadmap, or a
//     description without the marker
//   - never writes to ROADMAP.jsonl

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  runScriptRaw,
  makeTmpProject,
  writeRoadmap,
  writeConfig,
  initGitRepo,
  commitFile,
} = require('./helpers');

let project;
let env;

beforeEach(() => {
  project = makeTmpProject();
  env = { CLAUDE_PROJECT_DIR: project };
});

function payload(description, taskId, sessionId) {
  return {
    hook_event_name: 'TaskCompleted',
    session_id: sessionId || 'session-A',
    task_id: taskId || '1',
    task_subject: 'Do the thing',
    task_description: description,
  };
}

function run(p) {
  const result = runScriptRaw('task-completed.js', p, env);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function entry(id, status) {
  return { id, title: 'a', status, why: '', what: '', notes: '', commits: [], touches: [], depends_on: [] };
}

const MARKER = 'This task is ROADMAP.jsonl entry `001`. Mark it in_progress before doing anything else.';
const MARKER_NO_TICKS = 'This task is ROADMAP.jsonl entry 001. Mark it in_progress before doing anything else.';

describe('task-completed marker extraction (shared regex)', () => {
  test('backticked id matches and gates a planned entry', () => {
    writeRoadmap(project, [entry('001', 'planned')]);
    const out = run(payload(MARKER));
    assert.notEqual(out, '');
  });

  test('non-backticked id matches and gates a planned entry', () => {
    writeRoadmap(project, [entry('001', 'planned')]);
    const out = run(payload(MARKER_NO_TICKS));
    assert.notEqual(out, '');
  });
});

describe('task-completed status matrix', () => {
  test('planned entry is gated', () => {
    writeRoadmap(project, [entry('001', 'planned')]);
    assert.notEqual(run(payload(MARKER)), '');
  });

  test('in_progress entry is gated', () => {
    writeRoadmap(project, [entry('001', 'in_progress')]);
    assert.notEqual(run(payload(MARKER)), '');
  });

  for (const status of ['done', 'dropped', 'rejected', 'deferred']) {
    test(`${status} entry is silent`, () => {
      writeRoadmap(project, [entry('001', status)]);
      // Isolate the open-entry gate from the decision-log backstop, which is
      // now on by default and would nudge a doc-less `done` close.
      writeConfig(project, { decisionLog: { enabled: false } });
      assert.equal(run(payload(MARKER)), '');
    });
  }

  test('missing entry id is silent', () => {
    writeRoadmap(project, [entry('002', 'planned')]);
    assert.equal(run(payload(MARKER)), ''); // names 001, which does not exist
  });

  test('no marker in description is silent', () => {
    writeRoadmap(project, [entry('001', 'planned')]);
    assert.equal(run(payload('An ordinary task about entry 001 with no marker phrase.')), '');
  });

  test('no ROADMAP.jsonl is silent', () => {
    assert.equal(run(payload(MARKER)), '');
  });

  test('a non-TaskCompleted event is ignored defensively', () => {
    writeRoadmap(project, [entry('001', 'planned')]);
    assert.equal(run({ ...payload(MARKER), hook_event_name: 'TaskCreated' }), '');
  });
});

describe('task-completed fails open on a corrupt roadmap', () => {
  test('corrupt roadmap is a silent no-op', () => {
    fs.writeFileSync(path.join(project, 'ROADMAP.jsonl'), '{broken\n', 'utf-8');
    assert.equal(run(payload(MARKER)), '');
  });
});

describe('task-completed gate-mode config resolution', () => {
  test('off: always silent even for an open entry', () => {
    writeRoadmap(project, [entry('001', 'planned')]);
    writeConfig(project, { taskCloseGate: 'off' });
    assert.equal(run(payload(MARKER)), '');
  });

  test('nudge: emits systemMessage, no decision field', () => {
    writeRoadmap(project, [entry('001', 'planned')]);
    writeConfig(project, { taskCloseGate: 'nudge' });
    const out = JSON.parse(run(payload(MARKER)));
    assert.equal(typeof out.systemMessage, 'string');
    assert.ok(out.systemMessage.includes('001'));
    assert.equal(out.decision, undefined);
  });

  test('block: emits decision block with a reason', () => {
    writeRoadmap(project, [entry('001', 'planned')]);
    writeConfig(project, { taskCloseGate: 'block' });
    const out = JSON.parse(run(payload(MARKER)));
    assert.equal(out.decision, 'block');
    assert.equal(typeof out.reason, 'string');
  });

  test('absent config defaults to nudge', () => {
    writeRoadmap(project, [entry('001', 'planned')]);
    const out = JSON.parse(run(payload(MARKER)));
    assert.equal(typeof out.systemMessage, 'string');
    assert.equal(out.decision, undefined);
  });

  test('invalid config value defaults to nudge', () => {
    writeRoadmap(project, [entry('001', 'planned')]);
    writeConfig(project, { taskCloseGate: 'nonsense' });
    const out = JSON.parse(run(payload(MARKER)));
    assert.equal(typeof out.systemMessage, 'string');
    assert.equal(out.decision, undefined);
  });
});

describe('task-completed once-only latch per task_id', () => {
  test('a second completion for the same task_id passes silently', () => {
    writeRoadmap(project, [entry('001', 'planned')]);
    writeConfig(project, { taskCloseGate: 'block' });
    const first = run(payload(MARKER, 'task-A'));
    assert.notEqual(first, '');
    const second = run(payload(MARKER, 'task-A'));
    assert.equal(second, '');
  });

  test('a different task_id still gates', () => {
    writeRoadmap(project, [entry('001', 'planned')]);
    writeConfig(project, { taskCloseGate: 'block' });
    run(payload(MARKER, 'task-A'));
    const other = run(payload(MARKER, 'task-B'));
    assert.notEqual(other, '');
  });

  test('a reused task_id from a different session still gates (cross-session collision)', () => {
    // task_id is a small per-session counter that restarts at 1 in every
    // fresh session -- session-B reusing session-A's task_id '1' must not
    // let it inherit session-A's already-latched gate.
    writeRoadmap(project, [entry('001', 'planned'), entry('002', 'planned')]);
    writeConfig(project, { taskCloseGate: 'block' });
    const MARKER_002 = 'This task is ROADMAP.jsonl entry `002`. Mark it in_progress before doing anything else.';
    const first = run(payload(MARKER, '1', 'session-A'));
    assert.notEqual(first, '');
    const second = run(payload(MARKER_002, '1', 'session-B'));
    assert.notEqual(second, '');
  });
});

describe('task-completed block-mode reason shape', () => {
  test('reason carries the entry id, the close command, provenance, and a complete-again instruction', () => {
    writeRoadmap(project, [entry('001', 'planned')]);
    writeConfig(project, { taskCloseGate: 'block' });
    const out = JSON.parse(run(payload(MARKER)));
    assert.equal(out.decision, 'block');
    assert.ok(out.reason.includes('001'));
    assert.ok(out.reason.includes('update-status'));
    assert.ok(/automated/i.test(out.reason));
    assert.ok(/not you declining|not the user declining/i.test(out.reason));
    assert.ok(/complet(e|ing) (this task |it )?again/i.test(out.reason));
  });
});

// --- Decision-log backstop (entry 092) ----------------------------------
//
// Fires only on a `done` close, only when decisionLog.enabled is true, and
// only after the open-entry gate above did NOT fire. Its config lives under
// the `decisionLog` group ({enabled, dir, gate}) -- distinct from the
// top-level taskCloseGate the open gate reads.

function doneEntry(id, extra) {
  return { ...entry(id, 'done'), ...(extra || {}) };
}

function dlConfig(gate, extra) {
  return { decisionLog: { enabled: true, gate, ...(extra || {}) } };
}

describe('decision-log backstop: enablement', () => {
  test('enabled by default: a done entry with no doc nudges', () => {
    writeRoadmap(project, [doneEntry('001')]);
    const out = JSON.parse(run(payload(MARKER)));
    assert.equal(typeof out.systemMessage, 'string');
    assert.ok(out.systemMessage.includes('001'));
    assert.equal(out.decision, undefined);
  });

  test('explicitly disabled: still silent', () => {
    writeRoadmap(project, [doneEntry('001')]);
    writeConfig(project, { decisionLog: { enabled: false, gate: 'block' } });
    assert.equal(run(payload(MARKER)), '');
  });

  test('enabled but gate off: silent', () => {
    writeRoadmap(project, [doneEntry('001')]);
    writeConfig(project, dlConfig('off'));
    assert.equal(run(payload(MARKER)), '');
  });
});

describe('decision-log backstop: missing doc', () => {
  test('nudge mode emits systemMessage naming the close command, no decision', () => {
    writeRoadmap(project, [doneEntry('001')]);
    writeConfig(project, dlConfig('nudge'));
    const out = JSON.parse(run(payload(MARKER)));
    assert.equal(typeof out.systemMessage, 'string');
    assert.ok(out.systemMessage.includes('001'));
    assert.match(out.systemMessage, /update-status/);
    assert.match(out.systemMessage, /"doc"/);
    assert.equal(out.decision, undefined);
  });

  test('block mode emits a decision block reusing the checkpoint framing', () => {
    writeRoadmap(project, [doneEntry('001')]);
    writeConfig(project, dlConfig('block'));
    const out = JSON.parse(run(payload(MARKER)));
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /automated roadmap checkpoint/i);
    assert.match(out.reason, /not you declining/i);
    assert.ok(out.reason.includes('001'));
    assert.match(out.reason, /no decision doc/i);
  });
});

describe('decision-log backstop: doc value handling', () => {
  test('doc "none" passes silently', () => {
    writeRoadmap(project, [doneEntry('001', { doc: 'none' })]);
    writeConfig(project, dlConfig('block'));
    assert.equal(run(payload(MARKER)), '');
  });

  test('doc path with no file on disk is a violation naming the path', () => {
    writeRoadmap(project, [doneEntry('001', { doc: 'docs/foreman/001.md' })]);
    writeConfig(project, dlConfig('block'));
    const out = JSON.parse(run(payload(MARKER)));
    assert.equal(out.decision, 'block');
    assert.ok(out.reason.includes('docs/foreman/001.md'));
    assert.match(out.reason, /no file exists/i);
  });
});

describe('decision-log backstop: anchor placement (real git)', () => {
  function writeDoc(rel) {
    const full = path.join(project, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '# ADR 001\n', 'utf-8');
  }

  test('doc file present + a commit carrying the anchor passes silently', () => {
    initGitRepo(project);
    const sha = commitFile(project, 'src/thing.js', '// [Foreman: 001]\nmodule.exports = 1;\n');
    writeDoc('docs/foreman/001.md');
    writeRoadmap(project, [doneEntry('001', { doc: 'docs/foreman/001.md', commits: [sha] })]);
    writeConfig(project, dlConfig('block'));
    assert.equal(run(payload(MARKER)), '');
  });

  test('doc file present but no commit carries the anchor is a violation', () => {
    initGitRepo(project);
    const sha = commitFile(project, 'src/thing.js', 'module.exports = 1;\n');
    writeDoc('docs/foreman/001.md');
    writeRoadmap(project, [doneEntry('001', { doc: 'docs/foreman/001.md', commits: [sha] })]);
    writeConfig(project, dlConfig('block'));
    const out = JSON.parse(run(payload(MARKER)));
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /\[Foreman: 001\]/);
    assert.match(out.reason, /anchor/i);
  });

  test('git failure (bogus sha, no repo) treats the anchor check as passed', () => {
    // No initGitRepo -- git show cannot resolve the sha; infra never blocks.
    writeDoc('docs/foreman/001.md');
    writeRoadmap(project, [doneEntry('001', { doc: 'docs/foreman/001.md', commits: ['deadbeef'] })]);
    writeConfig(project, dlConfig('block'));
    assert.equal(run(payload(MARKER)), '');
  });
});

describe('decision-log backstop: commitless (investigation-only) close', () => {
  test('doc path + file present + no commits skips the anchor check (silent)', () => {
    const full = path.join(project, 'docs/foreman/001.md');
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '# ADR 001\n', 'utf-8');
    writeRoadmap(project, [doneEntry('001', { doc: 'docs/foreman/001.md', commits: [] })]);
    writeConfig(project, dlConfig('block'));
    assert.equal(run(payload(MARKER)), '');
  });

  test('no doc + no commits still demands a doc-or-none record', () => {
    writeRoadmap(project, [doneEntry('001', { commits: [] })]);
    writeConfig(project, dlConfig('block'));
    const out = JSON.parse(run(payload(MARKER)));
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /no decision doc/i);
  });
});

describe('decision-log backstop: precedence and latch independence', () => {
  test('an open entry uses the open-entry gate, never the decision-log check', () => {
    // Open entry + decisionLog enabled: the open gate (taskCloseGate:nudge)
    // owns the turn; the decision-log block must not also fire.
    writeRoadmap(project, [entry('001', 'planned')]);
    writeConfig(project, { taskCloseGate: 'nudge', decisionLog: { enabled: true, gate: 'block' } });
    const out = JSON.parse(run(payload(MARKER)));
    assert.equal(typeof out.systemMessage, 'string');
    assert.match(out.systemMessage, /still open/);
    assert.equal(out.decision, undefined);
  });

  test('the decision-log check fires after the open gate consumed the base latch, once per task', () => {
    writeConfig(project, { taskCloseGate: 'block', decisionLog: { enabled: true, gate: 'block' } });

    // Open entry: open gate fires, consuming session-A:task-A.
    writeRoadmap(project, [entry('001', 'planned')]);
    const opened = JSON.parse(run(payload(MARKER, 'task-A')));
    assert.match(opened.reason, /still open/);

    // Same task_id, entry now done without a doc: the decision-log check has
    // its own :dl latch, so the consumed base latch does not suppress it.
    writeRoadmap(project, [doneEntry('001')]);
    const dl = JSON.parse(run(payload(MARKER, 'task-A')));
    assert.match(dl.reason, /no decision doc/i);

    // ...and it fires at most once per task_id.
    assert.equal(run(payload(MARKER, 'task-A')), '');
  });
});

describe('task-completed never throws', () => {
  test('garbage stdin exits cleanly with no output', () => {
    const result = runScriptRaw('task-completed.js', '{not json at all', env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  });

  test('empty stdin exits cleanly with no output', () => {
    const result = runScriptRaw('task-completed.js', '', env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  });
});
