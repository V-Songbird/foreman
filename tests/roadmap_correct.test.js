'use strict';

// Tests for `roadmap.js correct` — the guarded repair path for an entry whose
// description or planned file surface went stale.
//
// Covers:
//   - title/why/what/kind/touches each correctable on their own, and together
//   - `changed` lists only the fields that actually differed
//   - expected_updated_at is required, and a stale one is refused without
//     touching the file
//   - expected is the content compare-and-swap `expected_updated_at` cannot
//     cover on its own: a same-day second correction composed against a
//     stale `expected.<field>` is refused and the first correction survives,
//     a changed field with no matching `expected` entry names the field,
//     and a `planned_touches` mismatch is refused the same way
//   - a title equal to another entry's is refused (add's exact-replay key)
//   - done/dropped/rejected entries are refused — that is history rewriting
//   - kind "build" drops the stored key, round-tripping back to "decision"
//   - touches is a full replacement (it can shrink), not an append
//   - a call naming no correctable field is refused
//   - long why/what still warn, same soft caps as add
//   - graph-fact fields stay absent: no correctable field moves the graph
//   - an applied correction stamps one dated notes line naming the changed
//     fields (and only their names), appends rather than overwrites, stamps
//     nothing on a no-op, and is what roadmap-health counts
//   - the usage text and the Correct-a-task branch both name exactly
//     CORRECTABLE_STATUSES, and neither offers a terminal status
//   - the direct-edit guard hook never sees a CLI write, so `correct` lands

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runRoadmap, runScriptRaw, makeTmpProject, writeRoadmap } = require('./helpers');
const {
  today,
  CORRECTION_MARKER,
  CORRECTABLE_STATUSES,
  TERMINAL_STATUSES,
} = require('../scripts/roadmap');
const { fileMetrics } = require('../scripts/health/roadmap-health');

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
    planned_touches: ['src/auth/middleware.ts'],
    observed_touches: [],
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

// The format marker every write stamps as line 1 is not an entry; drop it
// so these assertions stay about the entries.
function onDisk() {
  return fs
    .readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.id !== undefined);
}

describe('correct — happy path per field', () => {
  test('title is replaced and reported as changed', () => {
    seed();
    const { status, json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { title: 'Add JWT refresh middleware' },
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
      expected: { why: 'Sessions expire mid-request under load.' },
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
      expected: { what: 'Refresh the access token before its 15-min expiry.' },
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
      expected: { kind: 'build' },
      kind: 'decision',
    });
    assert.equal(json.entry.kind, 'decision');
    assert.deepEqual(json.changed, ['kind']);
    assert.equal(onDisk()[0].kind, 'decision');
  });

  test('planned_touches is replaced wholesale', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { planned_touches: ['src/auth/middleware.ts'] },
      planned_touches: ['src/proxy/refresh.ts', 'tests/proxy.test.ts'],
    });
    assert.deepEqual(json.entry.planned_touches, ['src/proxy/refresh.ts', 'tests/proxy.test.ts']);
    assert.deepEqual(json.changed, ['planned_touches']);
  });

  test('updated_at is bumped to today on a real correction', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { why: 'Sessions expire mid-request under load.' },
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
        expected: { what: 'Refresh the access token before its 15-min expiry.' },
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
      expected: {
        title: 'Add JWT refresh middleware',
        why: 'Sessions expire mid-request under load.',
        what: 'Refresh the access token before its 15-min expiry.',
        kind: 'build',
        planned_touches: ['src/auth/middleware.ts'],
      },
      title: 'Refresh tokens at the edge proxy',
      why: 'The middleware never sees the expired token.',
      what: 'Move the refresh into the proxy.',
      kind: 'decision',
      planned_touches: ['src/proxy/refresh.ts'],
    });
    assert.deepEqual(json.changed, ['title', 'why', 'what', 'kind', 'planned_touches']);
    const [stored] = onDisk();
    assert.equal(stored.title, 'Refresh tokens at the edge proxy');
    assert.equal(stored.kind, 'decision');
    assert.deepEqual(stored.planned_touches, ['src/proxy/refresh.ts']);
  });

  test('a field passed with its current value is not "changed"', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: {
        title: 'Add JWT refresh middleware',
        planned_touches: ['src/auth/middleware.ts'],
        what: 'Refresh the access token before its 15-min expiry.',
      },
      title: 'Add JWT refresh middleware',
      planned_touches: ['src/auth/middleware.ts'],
      what: 'Actually corrected.',
    });
    assert.deepEqual(json.changed, ['what']);
  });

  test('an all-no-op correction changes nothing and leaves updated_at alone', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { title: 'Add JWT refresh middleware', kind: 'build' },
      title: 'Add JWT refresh middleware',
      kind: 'build',
    });
    assert.equal(json.ok, true);
    assert.deepEqual(json.changed, []);
    assert.equal(json.entry.updated_at, '2026-07-01');
    assert.equal(onDisk()[0].updated_at, '2026-07-01');
  });
});

// [Foreman: 178] Before this, an applied correction left no trace at all and
// the health report's applied-corrections count had nothing to read.
describe('correct — the applied-correction stamp', () => {
  test('a correction appends one dated line naming the changed fields', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { what: 'Refresh the access token before its 15-min expiry.' },
      what: 'Refresh in the proxy layer, not the app middleware.',
    });
    assert.equal(json.entry.notes, `${today()} ${CORRECTION_MARKER}what`);
    assert.equal(onDisk()[0].notes, `${today()} ${CORRECTION_MARKER}what`);
  });

  test('the stamp names every changed field, in the same order as changed', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: {
        title: 'Add JWT refresh middleware',
        what: 'Refresh the access token before its 15-min expiry.',
        planned_touches: ['src/auth/middleware.ts'],
      },
      title: 'Refresh tokens at the edge proxy',
      what: 'Move the refresh into the proxy.',
      planned_touches: ['src/proxy/refresh.ts'],
    });
    assert.deepEqual(json.changed, ['title', 'what', 'planned_touches']);
    assert.equal(
      json.entry.notes,
      `${today()} ${CORRECTION_MARKER}${json.changed.join(', ')}`
    );
  });

  test('the stamp appends, it never overwrites an existing note', () => {
    seed([entryFixture({ notes: '2026-06-30 survey (unconfirmed): the helper moved' })]);
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { why: 'Sessions expire mid-request under load.' },
      why: 'The refresh only fails behind the proxy.',
    });
    assert.deepEqual(json.entry.notes.split('\n'), [
      '2026-06-30 survey (unconfirmed): the helper moved',
      `${today()} ${CORRECTION_MARKER}why`,
    ]);
  });

  test('the stamp carries the field names only, never the prose it replaced', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { what: 'Refresh the access token before its 15-min expiry.' },
      what: 'Refresh in the proxy layer, not the app middleware.',
    });
    assert.ok(!json.entry.notes.includes('15-min expiry'), 'old prose belongs to git, not notes');
    assert.ok(!json.entry.notes.includes('proxy layer'), 'new prose is already in `what`');
  });

  test('an all-no-op correction stamps nothing', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { title: 'Add JWT refresh middleware', kind: 'build' },
      title: 'Add JWT refresh middleware',
      kind: 'build',
    });
    assert.deepEqual(json.changed, []);
    assert.equal(json.entry.notes, '');
    assert.equal(onDisk()[0].notes, '');
  });

  // `annotate` takes free text, so a note that merely quotes the phrase must
  // not read as a correction. A real stamp starts its own dated line.
  test('a hand-written note quoting the marker is not counted', () => {
    seed([
      entryFixture({
        notes: '2026-07-02 reviewed by hand -- no correction applied: needed, it all checks out',
      }),
    ]);
    const { corrections } = fileMetrics(onDisk(), [], today());
    assert.equal(corrections.applied.count, 0);
    assert.deepEqual(corrections.applied.ids, []);
  });

  // `notes` arrives as JSON, so a `\n` in the payload becomes a real newline.
  // One append must stay one line, or a single annotate can smuggle in a
  // second line that looks like the script wrote it.
  test('an annotated note cannot forge a stamp with an embedded newline', () => {
    seed();
    run(['annotate'], {
      id: '001',
      notes: 'looks innocent\n2026-01-01 correction applied: title, why',
    });
    const [stored] = onDisk();
    assert.equal(stored.notes.split('\n').length, 1, 'one append is one line');
    assert.equal(fileMetrics([stored], [], today()).corrections.applied.count, 0);
  });

  test('reordering planned_touches is not a correction and stamps nothing', () => {
    seed([entryFixture({ planned_touches: ['src/auth/middleware.ts', 'src/auth/routes.ts'] })]);
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { planned_touches: ['src/auth/middleware.ts', 'src/auth/routes.ts'] },
      planned_touches: ['src/auth/routes.ts', 'src/auth/middleware.ts'],
    });
    assert.deepEqual(json.changed, [], 'the same set in a different order is not a change');
    assert.equal(json.entry.notes, '');
    assert.equal(onDisk()[0].updated_at, '2026-07-01');
  });

  test('roadmap health counts the stamp this command actually writes', () => {
    seed();
    run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { what: 'Refresh the access token before its 15-min expiry.' },
      what: 'Refresh in the proxy layer, not the app middleware.',
    });
    const [stored] = onDisk();
    const { corrections } = fileMetrics([stored], [], today());
    assert.equal(corrections.applied.count, 1);
    assert.deepEqual(corrections.applied.ids, ['001']);
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
      expected: { why: 'Sessions expire mid-request under load.' },
      why: 'First correction.',
    });
    const second = run(['correct'], {
      id: '001',
      expected_updated_at: first.json.entry.updated_at,
      expected: { why: 'First correction.' },
      why: 'Second correction.',
    });
    assert.equal(second.json.ok, true);
    assert.equal(second.json.entry.why, 'Second correction.');
  });
});

describe('correct — content compare-and-swap', () => {
  // expected_updated_at is date-only, so two sessions that both read an
  // entry today both pass it -- this is the guard that catches the
  // same-day case the date guard cannot.
  test('a same-day second correction with a stale expected.what is refused, and the first correction survives', () => {
    seed([entryFixture({ updated_at: today() })]);
    const first = run(['correct'], {
      id: '001',
      expected_updated_at: today(),
      expected: { what: 'Refresh the access token before its 15-min expiry.' },
      what: 'First session rewrote this.',
    });
    assert.equal(first.json.ok, true);

    const second = run(['correct'], {
      id: '001',
      expected_updated_at: today(),
      // Composed against the text this session read BEFORE the first
      // session's write -- stale, even though the date guard still matches.
      expected: { what: 'Refresh the access token before its 15-min expiry.' },
      what: 'Second session, composed against text it never saw.',
    });
    assert.equal(second.status, 1);
    assert.equal(second.json.ok, false);
    assert.equal(onDisk()[0].what, 'First session rewrote this.');
  });

  test('a correct expected passes and the correction applies', () => {
    seed([entryFixture({ updated_at: today() })]);
    const { status, json } = run(['correct'], {
      id: '001',
      expected_updated_at: today(),
      expected: { what: 'Refresh the access token before its 15-min expiry.' },
      what: 'Reworded against the current text.',
    });
    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.equal(json.entry.what, 'Reworded against the current text.');
  });

  test('a missing expected for a changed field is an error naming the field', () => {
    seed();
    const { status, json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      what: 'No expected.what came along with this.',
    });
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /expected\.what/);
    assert.equal(onDisk()[0].what, 'Refresh the access token before its 15-min expiry.');
  });

  test('a planned_touches expected-mismatch is refused', () => {
    seed();
    const { status, json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { planned_touches: ['src/a-stale-view.ts'] },
      planned_touches: ['src/new.ts'],
    });
    assert.equal(status, 1);
    assert.match(json.error, /planned_touches/);
    assert.deepEqual(onDisk()[0].planned_touches, ['src/auth/middleware.ts']);
  });

  test('the refusal message tells the caller to re-read and re-apply', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { why: 'Someone else already corrected this.' },
      why: 'Composed against stale text.',
    });
    assert.match(json.error, /re-read the entry and re-apply the correction/);
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
      expected: { title: 'Add JWT refresh middleware' },
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
      expected: { title: 'Add JWT refresh middleware', why: 'Sessions expire mid-request under load.' },
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
    assert.match(json.error, /at least one of title, why, what, kind, planned_touches/);
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
      expected: { kind: 'decision' },
      kind: 'build',
    });
    assert.deepEqual(toBuild.json.changed, ['kind']);
    assert.equal('kind' in toBuild.json.entry, false);
    assert.equal('kind' in onDisk()[0], false);

    const back = run(['correct'], {
      id: '001',
      expected_updated_at: toBuild.json.entry.updated_at,
      expected: { kind: 'build' },
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
      expected: { kind: 'build' },
      kind: 'build',
    });
    assert.deepEqual(json.changed, []);
  });
});

// [Foreman: 202] The guard compares the same multiset of paths, not the same
// order, and accepts the same `touches` input alias on the `expected` side
// the payload side already does.
describe('correct — expected.planned_touches is compared as a set', () => {
  test('a reordered expected.planned_touches still passes', () => {
    seed([entryFixture({ planned_touches: ['src/a.ts', 'src/b.ts', 'src/c.ts'] })]);
    const { status, json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { planned_touches: ['src/c.ts', 'src/a.ts', 'src/b.ts'] },
      planned_touches: ['src/b.ts'],
    });
    assert.equal(status, 0, JSON.stringify(json));
    assert.equal(json.ok, true);
    assert.deepEqual(json.entry.planned_touches, ['src/b.ts']);
  });

  test('expected.touches is accepted as an alias for expected.planned_touches', () => {
    seed([entryFixture({ planned_touches: ['src/a.ts', 'src/b.ts'] })]);
    const { status, json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { touches: ['src/b.ts', 'src/a.ts'] },
      planned_touches: ['src/next.ts'],
    });
    assert.equal(status, 0, JSON.stringify(json));
    assert.equal(json.ok, true);
    assert.deepEqual(json.entry.planned_touches, ['src/next.ts']);
  });

  test('a genuinely different set is still refused', () => {
    seed([entryFixture({ planned_touches: ['src/a.ts', 'src/b.ts'] })]);
    const { status, json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { planned_touches: ['src/a.ts', 'src/different.ts'] },
      planned_touches: ['src/next.ts'],
    });
    assert.equal(status, 1);
    assert.match(json.error, /planned_touches/);
    assert.deepEqual(onDisk()[0].planned_touches, ['src/a.ts', 'src/b.ts']);
  });
});

describe('correct — planned_touches is a replacement, not a fold', () => {
  test('the planned surface can shrink', () => {
    seed([entryFixture({ planned_touches: ['src/a.ts', 'src/b.ts', 'src/c.ts'] })]);
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { planned_touches: ['src/a.ts', 'src/b.ts', 'src/c.ts'] },
      planned_touches: ['src/b.ts'],
    });
    assert.deepEqual(json.entry.planned_touches, ['src/b.ts']);
    assert.deepEqual(onDisk()[0].planned_touches, ['src/b.ts']);
  });

  test('an empty array clears the prediction', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { planned_touches: ['src/auth/middleware.ts'] },
      planned_touches: [],
    });
    assert.deepEqual(json.entry.planned_touches, []);
    assert.deepEqual(json.changed, ['planned_touches']);
  });

  // [Foreman: 130] The observed half is history the entry's own commits
  // already describe, so it survives a correction of the forecast untouched.
  test('correcting the prediction leaves the observed surface alone', () => {
    seed([entryFixture({ status: 'in_progress', observed_touches: ['src/shipped.ts'] })]);
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: { planned_touches: ['src/auth/middleware.ts'] },
      planned_touches: ['src/next.ts'],
    });
    assert.deepEqual(json.entry.observed_touches, ['src/shipped.ts']);
    assert.deepEqual(onDisk()[0].observed_touches, ['src/shipped.ts']);
  });
});

describe('correct — warnings', () => {
  test('a long why and what still write, with the same soft-cap hints add gives', () => {
    seed();
    const { json } = run(['correct'], {
      id: '001',
      expected_updated_at: '2026-07-01',
      expected: {
        why: 'Sessions expire mid-request under load.',
        what: 'Refresh the access token before its 15-min expiry.',
      },
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
      expected: { why: 'Sessions expire mid-request under load.' },
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
      expected: {
        title: 'Add JWT refresh middleware',
        planned_touches: ['src/auth/middleware.ts'],
        kind: 'build',
      },
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
      expected: { why: 'Sessions expire mid-request under load.' },
      why: 'Corrected through the CLI the guard points at.',
    });
    assert.equal(json.ok, true);
    assert.equal(onDisk()[0].why, 'Corrected through the CLI the guard points at.');
  });

  test('a direct Edit of ROADMAP.jsonl is still denied — correct is the repair path', () => {
    seed();
    const hook = runScriptRaw(
      'guard-roadmap-edit.js',
      { tool_name: 'Edit', tool_input: { file_path: path.join(project, 'ROADMAP.jsonl') } },
      { CLAUDE_PROJECT_DIR: project }
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

// [Foreman: 177] Both surfaces said "planned/in_progress/deferred" long after
// CORRECTABLE_STATUSES had gained awaiting_acceptance, so a user was told an
// entry could not be corrected that the script corrects fine. The usage text
// now interpolates the set; the skill file cannot, so this pins it.
describe('correct — the correctable set is stated the same everywhere', () => {
  test('the usage text names exactly CORRECTABLE_STATUSES', () => {
    const result = runRoadmap(['--help'], undefined, env);
    assert.equal(result.status, 0);
    assert.ok(
      result.stdout.includes(`only ${[...CORRECTABLE_STATUSES].join('/')}`),
      `usage text does not name the correctable set:\n${result.stdout}`
    );
  });

  test('the Correct-a-task branch names exactly CORRECTABLE_STATUSES', () => {
    const branch = fs
      .readFileSync(path.join(__dirname, '..', 'skills', 'roadmap', 'correct.md'), 'utf-8')
      .replace(/\s+/g, ' ');
    const listed = branch.match(/Correctable statuses: ((?:`[a-z_]+`(?:, )?)+)/);
    assert.ok(listed, 'correct.md must carry a "Correctable statuses:" list');
    const named = listed[1].match(/`([a-z_]+)`/g).map((token) => token.replace(/`/g, ''));
    assert.deepEqual(named.sort(), [...CORRECTABLE_STATUSES].sort());
  });

  test('no terminal status is offered as correctable in either surface', () => {
    const branch = fs.readFileSync(
      path.join(__dirname, '..', 'skills', 'roadmap', 'correct.md'),
      'utf-8'
    );
    for (const status of TERMINAL_STATUSES) {
      assert.ok(!CORRECTABLE_STATUSES.has(status), `${status} must not be correctable`);
      assert.ok(
        !branch.includes(`Correctable statuses:`) || !branch.match(
          new RegExp(`Correctable statuses:[^—]*\`${status}\``)
        ),
        `correct.md lists the terminal status ${status} as correctable`
      );
    }
  });
});
