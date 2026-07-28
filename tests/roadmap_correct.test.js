'use strict';

// Tests for `roadmap.js correct` — the guarded repair path for an entry whose
// description or planned file surface went stale.
//
// Covers:
//   - title/why/what/kind/touches each correctable on their own, and together
//   - `changed` lists only the fields that actually differed
//   - expected_updated_at is required, and a stale one is refused without
//     touching the file
//   - a title equal to another entry's is refused (add's exact-replay key)
//   - done/dropped/rejected entries are refused — that is history rewriting
//   - kind "build" drops the stored key, round-tripping back to "decision"
//   - touches is a full replacement (it can shrink), not an append
//   - a call naming no correctable field is refused
//   - long why/what still warn, same soft caps as add
//   - graph-fact fields stay absent: no correctable field moves the graph
//   - the direct-edit guard hook never sees a CLI write, so `correct` lands

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runRoadmap, runScriptRaw, makeTmpProject, writeRoadmap } = require('./helpers');
const { today } = require('../scripts/roadmap');

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

function entryFixture(overrides = {}) {
  return {
    id: '001',
    title: 'Add JWT refresh middleware',
    why: 'Sessions expire mid-request under load.',
    what: 'Refresh the access token before its 15-min expiry.',
    status: 'planned',
    source: 'user',
    depends_on: [],
    touches: ['src/auth/middleware.ts'],
    commits: [],
    created_at: '2026-06-22',
    updated_at: '2026-07-01',
    notes: '',
    ...overrides,
  };
}

function seed(entries) {
  writeRoadmap(project, entries || [entryFixture()]);
}

function onDisk() {
  return fs
    .readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('correct — happy path per field', () => {
  test('title is replaced and reported as changed', () => {
    seed();
    const { status, json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      title: 'Add JWT refresh middleware to the edge proxy',
    });
    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.equal(json.entry.title, 'Add JWT refresh middleware to the edge proxy');
    assert.deepEqual(json.changed, ['title']);
    assert.equal(onDisk()[0].title, 'Add JWT refresh middleware to the edge proxy');
  });

  test('why is replaced', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      why: 'The refresh only fails behind the proxy, not under load.',
    });
    assert.equal(json.entry.why, 'The refresh only fails behind the proxy, not under load.');
    assert.deepEqual(json.changed, ['why']);
  });

  test('what is replaced', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      what: 'Refresh in the proxy layer, not the app middleware.',
    });
    assert.equal(json.entry.what, 'Refresh in the proxy layer, not the app middleware.');
    assert.deepEqual(json.changed, ['what']);
  });

  test('kind "decision" is stored', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      kind: 'decision',
    });
    assert.equal(json.entry.kind, 'decision');
    assert.deepEqual(json.changed, ['kind']);
    assert.equal(onDisk()[0].kind, 'decision');
  });

  test('touches is replaced wholesale', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      touches: ['src/proxy/refresh.ts', 'tests/proxy.test.ts'],
    });
    assert.deepEqual(json.entry.touches, ['src/proxy/refresh.ts', 'tests/proxy.test.ts']);
    assert.deepEqual(json.changed, ['touches']);
  });

  test('updated_at is bumped to today on a real correction', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      why: 'Different rationale entirely.',
    });
    assert.equal(json.entry.updated_at, today());
  });

  test('in_progress and deferred entries are correctable too', () => {
    for (const status of ['in_progress', 'deferred']) {
      seed([entryFixture({ status })]);
      const { json } = run(['correct'], {
        id: '001',
        expected_updated_at: '2026-07-01',
        what: `Reworded for the ${status} case.`,
      });
      assert.equal(json.ok, true, `${status} should be correctable`);
      assert.deepEqual(json.changed, ['what']);
    }
  });
});

describe('correct — multi-field and changed accounting', () => {
  test('one call corrects several fields, changed lists them in field order', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      title: 'Refresh tokens at the edge proxy',
      why: 'The middleware never sees the expired token.',
      what: 'Move the refresh into the proxy.',
      kind: 'decision',
      touches: ['src/proxy/refresh.ts'],
    });
    assert.deepEqual(json.changed, ['title', 'why', 'what', 'kind', 'touches']);
    const [stored] = onDisk();
    assert.equal(stored.title, 'Refresh tokens at the edge proxy');
    assert.equal(stored.kind, 'decision');
    assert.deepEqual(stored.touches, ['src/proxy/refresh.ts']);
  });

  test('a field passed with its current value is not "changed"', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      title: 'Add JWT refresh middleware',
      touches: ['src/auth/middleware.ts'],
      what: 'Actually corrected.',
    });
    assert.deepEqual(json.changed, ['what']);
  });

  test('an all-no-op correction changes nothing and leaves updated_at alone', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      title: 'Add JWT refresh middleware',
      kind: 'build',
    });
    assert.equal(json.ok, true);
    assert.deepEqual(json.changed, []);
    assert.equal(json.entry.updated_at, '2026-07-01');
    assert.equal(onDisk()[0].updated_at, '2026-07-01');
  });
});

describe('correct — staleness guard', () => {
  test('a stale expected_updated_at is refused and writes nothing', () => {
    seed();
    const { status, json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-06-30',
      title: 'Something a stale session wanted',
    });
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /2026-07-01/);
    assert.match(json.error, /2026-06-30/);
    const [stored] = onDisk();
    assert.equal(stored.title, 'Add JWT refresh middleware');
    assert.equal(stored.updated_at, '2026-07-01');
  });

  test('a missing expected_updated_at is refused', () => {
    seed();
    const { status, json } = run(['correct'], { id: '001', why: 'No guard passed.' });
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /expected_updated_at/);
    assert.equal(onDisk()[0].why, 'Sessions expire mid-request under load.');
  });

  test('the value to pass next time is the one the correction returned', () => {
    seed();
    const first = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      why: 'First correction.',
    });
    const second = run(['correct'], {
      id: '001',
      expected_updated_at: first.json.entry.updated_at,
      why: 'Second correction.',
    });
    assert.equal(second.json.ok, true);
    assert.equal(second.json.entry.why, 'Second correction.');
  });
});

describe('correct — rejections', () => {
  test('a title equal to another entry\'s is refused', () => {
    seed([
      entryFixture(),
      entryFixture({ id: '002', title: 'Add refresh-token revocation endpoint' }),
    ]);
    const { status, json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      title: 'Add refresh-token revocation endpoint',
    });
    assert.equal(status, 1);
    assert.match(json.error, /002/);
    assert.match(json.error, /unique/);
    assert.equal(onDisk()[0].title, 'Add JWT refresh middleware');
  });

  test('correcting an entry to its own title is fine (it is a no-op)', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      title: 'Add JWT refresh middleware',
      why: 'Reworded.',
    });
    assert.deepEqual(json.changed, ['why']);
  });

  test('done, dropped, and rejected entries are refused', () => {
    for (const status of ['done', 'dropped', 'rejected']) {
      seed([entryFixture({ status, commits: ['a1b2c3d'], notes: 'shipped' })]);
      const result = run(['correct'], {
        id: '001',
        expected_updated_at: '2026-07-01',
        title: `Rewriting ${status} history`,
      });
      assert.equal(result.status, 1, `${status} must not be correctable`);
      assert.match(result.json.error, new RegExp(status));
      assert.equal(onDisk()[0].title, 'Add JWT refresh middleware');
    }
  });

  test('a call naming no correctable field is refused', () => {
    seed();
    const { status, json } = run(['correct'], { id: '001', expected_updated_at: '2026-07-01' });
    assert.equal(status, 1);
    assert.match(json.error, /at least one of title, why, what, kind, touches/);
  });

  test('an empty-string title is refused', () => {
    seed();
    const { status, json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      title: '   ',
    });
    assert.equal(status, 1);
    assert.match(json.error, /title must be a non-empty string/);
  });

  test('an unknown kind is refused', () => {
    seed();
    const { status, json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      kind: 'chore',
    });
    assert.equal(status, 1);
    assert.match(json.error, /kind must be one of/);
  });

  test('a non-array touches is refused', () => {
    seed();
    const { status, json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      touches: 'src/auth/middleware.ts',
    });
    assert.equal(status, 1);
    assert.match(json.error, /touches must be an array/);
  });

  test('an unknown id is refused', () => {
    seed();
    const { status, json } = run(['correct'], {
      id: '404',
      expected_updated_at: '2026-07-01',
      why: 'Nobody home.',
    });
    assert.equal(status, 1);
    assert.match(json.error, /no entry with id 404/);
  });
});

describe('correct — kind round-trip', () => {
  test('"build" drops the stored key, "decision" puts it back', () => {
    seed([entryFixture({ kind: 'decision' })]);
    const toBuild = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      kind: 'build',
    });
    assert.deepEqual(toBuild.json.changed, ['kind']);
    assert.equal('kind' in toBuild.json.entry, false);
    assert.equal('kind' in onDisk()[0], false);

    const back = run(['correct'], {
      id: '001',
      expected_updated_at: toBuild.json.entry.updated_at,
      kind: 'decision',
    });
    assert.deepEqual(back.json.changed, ['kind']);
    assert.equal(onDisk()[0].kind, 'decision');
  });

  test('"build" on an entry that has no kind key is a no-op', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      kind: 'build',
    });
    assert.deepEqual(json.changed, []);
  });
});

describe('correct — touches is a replacement, not a fold', () => {
  test('the planned surface can shrink', () => {
    seed([entryFixture({ touches: ['src/a.ts', 'src/b.ts', 'src/c.ts'] })]);
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      touches: ['src/b.ts'],
    });
    assert.deepEqual(json.entry.touches, ['src/b.ts']);
    assert.deepEqual(onDisk()[0].touches, ['src/b.ts']);
  });

  test('an empty array clears the prediction', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      touches: [],
    });
    assert.deepEqual(json.entry.touches, []);
    assert.deepEqual(json.changed, ['touches']);
  });
});

describe('correct — warnings', () => {
  test('a long why and what still write, with the same soft-cap hints add gives', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      why: 'w'.repeat(300),
      what: 'x'.repeat(500),
    });
    assert.equal(json.ok, true);
    assert.equal(json.warnings.length, 2);
    assert.match(json.warnings[0], /why is 300 chars/);
    assert.match(json.warnings[1], /what is 500 chars/);
    assert.equal(onDisk()[0].why.length, 300);
  });

  test('a short correction carries no warnings field', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      why: 'Short and specific.',
    });
    assert.equal('warnings' in json, false);
  });
});

describe('correct — graph facts', () => {
  test('no correctable field moves the graph, so the fact fields stay absent', () => {
    seed([
      entryFixture(),
      entryFixture({ id: '002', title: 'Depends on 001', depends_on: ['001'] }),
    ]);
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      title: 'Reworded blocker',
      touches: ['src/whatever.ts'],
      kind: 'decision',
    });
    assert.equal(json.ok, true);
    assert.equal('newly_unblocked' in json, false);
    assert.equal('newly_blocked' in json, false);
    assert.equal('stranded_dependents' in json, false);
  });
});

describe('correct — the direct-edit guard', () => {
  test('the guard never inspects a CLI write, and the correction lands', () => {
    seed();
    const hook = runScriptRaw(
      'guard-roadmap-edit.js',
      {
        tool_name: 'Bash',
        tool_input: { command: `echo '{"id":"001"}' | node scripts/roadmap.js correct` },
      },
      {}
    );
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stdout, '', 'the guard must stay silent for the supported CLI path');

    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      why: 'Corrected through the CLI the guard points at.',
    });
    assert.equal(json.ok, true);
    assert.equal(onDisk()[0].why, 'Corrected through the CLI the guard points at.');
  });

  test('a direct Edit of ROADMAP.jsonl is still denied — correct is the repair path', () => {
    const hook = runScriptRaw(
      'guard-roadmap-edit.js',
      { tool_name: 'Edit', tool_input: { file_path: path.join(project, 'ROADMAP.jsonl') } },
      {}
    );
    const payload = JSON.parse(hook.stdout);
    assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
  });
});

describe('correct — help', () => {
  test('--help documents the subcommand and its guard', () => {
    const result = runRoadmap(['--help'], undefined, env);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\bcorrect\b/);
    assert.match(result.stdout, /expected_updated_at/);
  });
});
