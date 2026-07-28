'use strict';

// [Foreman: 130] The planned/observed split, and the format-2 bump that
// carries it.
//
// Covers:
//   - migrate 1 -> 2: `touches` becomes planned_touches, observed_touches
//     starts empty, the marker says 2, a backup is written first, the archive
//     is upgraded with a backup of its own, and the whole thing is repeat-safe
//   - a format-1 file still READS everywhere (list/next-candidates/doctor),
//     normalized in memory, with the file left byte-identical
//   - every WRITE on a format-1 file is refused with one error naming migrate
//   - a close folds derived files into observed_touches only; the prediction
//     is never touched, and scope drift still measures prediction vs derived
//     (prefix-aware in both directions)
//   - collision reads the PREDICTED surface only — an overlap that exists
//     solely in observed_touches must not flag, which is the false collision
//     this split exists to remove
//   - correct replaces planned_touches and refuses observed_touches outright
//   - add accepts `touches` as an input alias, but stores the new fields
//   - --hint scans BOTH surfaces (an entry is findable by where it has been)
//
// The post-commit tag's own decision (it compares planned_touches, never the
// accumulated observed half) is pinned in post_commit.test.js.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  runRoadmap,
  makeTmpProject,
  writeRoadmap,
  initGitRepo,
  commitFile,
} = require('./helpers');

const META = '{"foreman_roadmap_format":2}';

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

/** A format-1 entry: one `touches` array, the shape every old roadmap has. */
function v1Entry(id, overrides = {}) {
  return {
    id,
    title: `task ${id}`,
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

function archiveFile() {
  return path.join(project, '.foreman', 'archive.jsonl');
}

/** Write a format-1 ROADMAP.jsonl: raw entry lines, no marker. */
function writeV1(rows) {
  fs.writeFileSync(roadmapFile(), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

function writeV1Archive(rows) {
  fs.mkdirSync(path.dirname(archiveFile()), { recursive: true });
  fs.writeFileSync(archiveFile(), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

function lines(file) {
  return fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
}

function backupsIn(dir, prefix) {
  return fs.readdirSync(dir).filter((name) => name.startsWith(prefix));
}

describe('migrate 1 -> 2 splits the file surface', () => {
  test('the whole old array becomes the prediction and observed starts empty', () => {
    writeV1([
      v1Entry('001', { touches: ['src/auth', 'src/auth/session.ts'] }),
      v1Entry('002', { status: 'done', commits: ['a1b2c3d'], touches: ['docs/plan.md'] }),
    ]);

    const { json } = run(['migrate']);
    assert.equal(json.ok, true);
    assert.equal(json.from, 1);
    assert.equal(json.to, 2);
    assert.equal(json.changed, true);

    const rows = lines(roadmapFile()).slice(1).map((line) => JSON.parse(line));
    assert.deepEqual(rows[0].planned_touches, ['src/auth', 'src/auth/session.ts']);
    assert.deepEqual(rows[0].observed_touches, []);
    assert.deepEqual(rows[1].planned_touches, ['docs/plan.md']);
    assert.deepEqual(rows[1].observed_touches, []);
    for (const row of rows) assert.equal('touches' in row, false);
  });

  test('the marker says 2 and a timestamped backup is written before the rewrite', () => {
    writeV1([v1Entry('001', { touches: ['src/a.ts'] })]);
    const before = fs.readFileSync(roadmapFile(), 'utf-8');

    const { json } = run(['migrate']);

    assert.equal(lines(roadmapFile())[0], META);
    const saved = backupsIn(project, 'ROADMAP.jsonl.backup-');
    assert.equal(saved.length, 1);
    assert.equal(json.backup, path.join(project, saved[0]));
    // The backup is the file as it was, so the upgrade stays recoverable.
    assert.equal(fs.readFileSync(json.backup, 'utf-8'), before);
  });

  test('the archive is upgraded in the same call, with a backup of its own', () => {
    writeV1([v1Entry('001')]);
    writeV1Archive([v1Entry('002', { status: 'done', commits: ['a1'], touches: ['src/old.ts'] })]);

    const { json } = run(['migrate']);
    assert.equal(json.changed, true);
    assert.equal(json.archive.from, 1);
    assert.equal(json.archive.changed, true);

    const archived = lines(archiveFile());
    assert.equal(archived[0], META);
    assert.deepEqual(JSON.parse(archived[1]).planned_touches, ['src/old.ts']);
    assert.deepEqual(JSON.parse(archived[1]).observed_touches, []);
    assert.equal(backupsIn(path.dirname(archiveFile()), 'archive.jsonl.backup-').length, 1);
  });

  test('a project with no archive reports none and writes none', () => {
    writeV1([v1Entry('001')]);
    const { json } = run(['migrate']);
    assert.equal('archive' in json, false);
    assert.equal(fs.existsSync(archiveFile()), false);
  });

  test('is safe to repeat — the second run changes nothing and takes no backup', () => {
    writeV1([v1Entry('001', { touches: ['src/a.ts'] })]);
    writeV1Archive([v1Entry('002', { status: 'done', commits: ['a1'] })]);
    run(['migrate']);
    const roadmapAfter = fs.readFileSync(roadmapFile(), 'utf-8');
    const archiveAfter = fs.readFileSync(archiveFile(), 'utf-8');

    const second = run(['migrate']).json;
    assert.equal(second.changed, false);
    assert.equal(second.backup, undefined);
    assert.equal(second.archive.changed, false);
    assert.equal(fs.readFileSync(roadmapFile(), 'utf-8'), roadmapAfter);
    assert.equal(fs.readFileSync(archiveFile(), 'utf-8'), archiveAfter);
    assert.equal(backupsIn(project, 'ROADMAP.jsonl.backup-').length, 1);
  });
});

describe('a format-1 file still reads, unmigrated', () => {
  beforeEach(() => {
    writeV1([
      v1Entry('001', { status: 'in_progress', touches: ['src/auth'] }),
      v1Entry('002', { touches: ['src/billing'] }),
    ]);
  });

  test('list shows the split fields, normalized in memory', () => {
    const { json } = run(['list', '--ids', '002']);
    const [entry] = json.entries;
    assert.deepEqual(entry.planned_touches, ['src/billing']);
    assert.deepEqual(entry.observed_touches, []);
    assert.equal('touches' in entry, false);
  });

  test('next-candidates ranks and flags collisions off the normalized fields', () => {
    const { json } = run(['next-candidates']);
    assert.deepEqual(json.candidates.map((c) => c.id), ['002']);
    assert.deepEqual(json.candidates[0].planned_touches, ['src/billing']);
    assert.deepEqual(json.in_progress[0].planned_touches, ['src/auth']);
  });

  test('doctor reports nothing about the two fields it never sees on disk', () => {
    const { json } = run(['doctor']);
    assert.equal(json.summary.errors, 0);
    assert.deepEqual(
      json.findings.filter((f) => String(f.field || '').endsWith('_touches')),
      []
    );
  });

  test('reading changes nothing on disk', () => {
    const before = fs.readFileSync(roadmapFile(), 'utf-8');
    run(['list']);
    run(['next-candidates']);
    run(['doctor']);
    assert.equal(fs.readFileSync(roadmapFile(), 'utf-8'), before);
  });
});

describe('a format-1 file refuses every write', () => {
  const mutations = [
    [['add'], { title: 'new', why: 'w', what: 'x', source: 'user' }],
    [['update-status'], { id: '001', status: 'done' }],
    [['annotate'], { id: '001', notes: 'a breadcrumb' }],
    [['update-deps'], { id: '001', add_depends_on: ['002'] }],
    [['correct'], { id: '001', expected_updated_at: '2026-07-01', what: 'reworded' }],
    [['archive'], { ids: ['002'] }],
  ];

  for (const [argv, stdinData] of mutations) {
    test(`${argv[0]} names migrate and writes nothing`, () => {
      writeV1([v1Entry('001'), v1Entry('002', { status: 'done', commits: ['a1'] })]);
      const before = fs.readFileSync(roadmapFile(), 'utf-8');

      const { status, json } = run(argv, stdinData);
      assert.equal(status, 1);
      assert.equal(json.ok, false);
      assert.match(json.error, /format version 1/);
      assert.match(json.error, /roadmap\.js migrate/);
      assert.equal(fs.readFileSync(roadmapFile(), 'utf-8'), before);
    });
  }

  test('an unmigrated ARCHIVE stops a two-file move before either file is written', () => {
    // The roadmap alone is current, so only the archive is behind. The move
    // writes the destination first, and a refusal partway would leave the id
    // in both files.
    writeRoadmap(project, [{ ...v1Entry('001', { status: 'done', commits: ['a1'] }) }]);
    writeV1Archive([v1Entry('002', { status: 'done', commits: ['a2'] })]);
    const before = fs.readFileSync(archiveFile(), 'utf-8');

    const { status, json } = run(['archive'], { ids: ['001'] });
    assert.equal(status, 1);
    assert.match(json.error, /archive\.jsonl is format version 1/);
    assert.equal(fs.readFileSync(archiveFile(), 'utf-8'), before);
    // and the roadmap still holds the entry that never moved
    assert.deepEqual(run(['list']).json.entries.map((e) => e.id), ['001']);
  });

  test('migrate then the same mutation succeeds', () => {
    writeV1([v1Entry('001')]);
    assert.equal(run(['migrate']).json.changed, true);
    const { status, json } = run(['update-status'], { id: '001', status: 'in_progress' });
    assert.equal(status, 0);
    assert.equal(json.entry.status, 'in_progress');
  });
});

describe('a close records the observed surface only', () => {
  beforeEach(() => {
    initGitRepo(project);
  });

  function seed(planned) {
    writeRoadmap(project, [
      {
        id: '001',
        title: 'a',
        why: 'a',
        what: 'a',
        status: 'in_progress',
        source: 'user',
        depends_on: [],
        planned_touches: planned,
        observed_touches: [],
        commits: [],
        created_at: '2026-07-01',
        updated_at: '2026-07-01',
        notes: '',
      },
    ]);
  }

  test('derived files land in observed_touches, the prediction is untouched', () => {
    seed(['src/predicted.ts']);
    const sha = commitFile(project, 'src/actual.ts', 'export const x = 1;\n');

    const { json } = run(['update-status'], { id: '001', status: 'done', commit: sha });

    assert.deepEqual(json.entry.observed_touches, ['src/actual.ts']);
    assert.deepEqual(json.entry.planned_touches, ['src/predicted.ts']);
    assert.deepEqual(json.derived_touches, ['src/actual.ts']);
  });

  test('scope drift still measures the prediction against what was derived', () => {
    seed(['src/predicted.ts']);
    const sha = commitFile(project, 'src/actual.ts', 'export const x = 1;\n');

    const { json } = run(['update-status'], { id: '001', status: 'done', commit: sha });

    assert.deepEqual(json.scope_drift.untouched, ['src/predicted.ts']);
    assert.deepEqual(json.scope_drift.unpredicted, ['src/actual.ts']);
    assert.match(json.entry.notes, /scope drift — predicted but untouched: src\/predicted\.ts; touched but unpredicted: src\/actual\.ts/);
  });

  test('an area-level prediction covers the files beneath it — no phantom drift', () => {
    seed(['src/auth']);
    const sha = commitFile(project, 'src/auth/session.ts', 'export const x = 1;\n');

    const { json } = run(['update-status'], { id: '001', status: 'done', commit: sha });

    assert.equal(json.scope_drift, undefined);
    assert.deepEqual(json.entry.observed_touches, ['src/auth/session.ts']);
  });

  test('a second close does not re-append the same drift line', () => {
    seed(['src/predicted.ts']);
    const sha = commitFile(project, 'src/actual.ts', 'export const x = 1;\n');
    run(['update-status'], { id: '001', status: 'done', commit: sha });
    const { json } = run(['update-status'], { id: '001', status: 'done', commit: sha });
    assert.equal(json.entry.notes.match(/scope drift/g).length, 1);
  });
});

describe('collision reads the predicted surface only', () => {
  test('an overlap that exists only in observed_touches does not collide', () => {
    // The in-progress entry committed src/shared.ts on an earlier close, so
    // that path sits in its OBSERVED half. Nobody is working there now, so a
    // candidate planning to touch it is not colliding with anything — this is
    // the false collision the split removes.
    writeRoadmap(project, [
      {
        id: '001',
        title: 'in flight',
        why: 'w',
        what: 'x',
        status: 'in_progress',
        source: 'user',
        depends_on: [],
        planned_touches: ['src/elsewhere.ts'],
        observed_touches: ['src/shared.ts'],
        commits: [],
        created_at: '2026-07-01',
        updated_at: '2026-07-01',
        notes: '',
      },
      {
        id: '002',
        title: 'candidate',
        why: 'w',
        what: 'x',
        status: 'planned',
        source: 'user',
        depends_on: [],
        planned_touches: ['src/shared.ts'],
        observed_touches: [],
        commits: [],
        created_at: '2026-07-01',
        updated_at: '2026-07-01',
        notes: '',
      },
    ]);
    const { json } = run(['next-candidates']);
    assert.equal(json.candidates[0].id, '002');
    assert.equal(json.candidates[0].collision, false);
  });

  test('an overlap between the two predictions still collides', () => {
    writeRoadmap(project, [
      {
        id: '001',
        title: 'in flight',
        why: 'w',
        what: 'x',
        status: 'in_progress',
        source: 'user',
        depends_on: [],
        planned_touches: ['src/shared.ts'],
        observed_touches: [],
        commits: [],
        created_at: '2026-07-01',
        updated_at: '2026-07-01',
        notes: '',
      },
      {
        id: '002',
        title: 'candidate',
        why: 'w',
        what: 'x',
        status: 'planned',
        source: 'user',
        depends_on: [],
        planned_touches: ['src/shared.ts'],
        observed_touches: [],
        commits: [],
        created_at: '2026-07-01',
        updated_at: '2026-07-01',
        notes: '',
      },
    ]);
    const { json } = run(['next-candidates']);
    assert.equal(json.candidates[0].collision, true);
  });
});

describe('add and correct: the prediction is the editable half', () => {
  test('add accepts the legacy `touches` key as an alias, storing the new fields', () => {
    const { json } = run(['add'], {
      title: 'aliased',
      why: 'w',
      what: 'x',
      source: 'user',
      touches: ['src/auth/middleware.ts'],
    });
    assert.deepEqual(json.entry.planned_touches, ['src/auth/middleware.ts']);
    assert.deepEqual(json.entry.observed_touches, []);
    assert.equal('touches' in json.entry, false);
  });

  test('add takes planned_touches canonically, and refuses a seeded observed half', () => {
    const { json } = run(['add'], {
      title: 'canonical',
      why: 'w',
      what: 'x',
      source: 'user',
      planned_touches: ['src/a.ts'],
    });
    assert.deepEqual(json.entry.planned_touches, ['src/a.ts']);

    const refused = run(['add'], {
      title: 'forged',
      why: 'w',
      what: 'x',
      source: 'user',
      observed_touches: ['src/a.ts'],
    });
    assert.equal(refused.status, 1);
    assert.match(refused.json.error, /observed_touches is not a add input/);
  });

  test('correct replaces the prediction and refuses the observed half', () => {
    const added = run(['add'], {
      title: 'correctable',
      why: 'w',
      what: 'x',
      source: 'user',
      planned_touches: ['src/a.ts', 'src/b.ts'],
    }).json.entry;

    const { json } = run(['correct'], {
      id: added.id,
      expected_updated_at: added.updated_at,
      planned_touches: ['src/b.ts'],
    });
    assert.deepEqual(json.entry.planned_touches, ['src/b.ts']);
    assert.deepEqual(json.changed, ['planned_touches']);

    const refused = run(['correct'], {
      id: added.id,
      expected_updated_at: json.entry.updated_at,
      observed_touches: ['src/forged.ts'],
    });
    assert.equal(refused.status, 1);
    assert.match(refused.json.error, /observed_touches is not a correct input/);
  });

  // [Foreman: 187] The trust boundary moves to the door: an absolute or
  // escaping planned path is refused at add/correct instead of persisting
  // behind the doctor's warning.
  test('add and correct refuse absolute or escaping planned paths outright', () => {
    for (const bad of [['../outside.ts'], ['/etc/passwd'], ['C:\\Windows\\hosts'], ['src/..\\..\\up.ts']]) {
      const refused = run(['add'], { title: `bad ${bad[0]}`, why: 'w', what: 'x', source: 'user', planned_touches: bad });
      assert.equal(refused.status, 1, bad[0]);
      assert.match(refused.json.error, /refusing absolute or escaping path/);
    }

    const added = run(['add'], {
      title: 'containable', why: 'w', what: 'x', source: 'user', planned_touches: ['src/ok.ts'],
    }).json.entry;
    const refused = run(['correct'], {
      id: added.id,
      expected_updated_at: added.updated_at,
      planned_touches: ['../escape.ts'],
    });
    assert.equal(refused.status, 1);
    assert.match(refused.json.error, /refusing absolute or escaping path/);
  });

  test('the touches alias goes through the same safety gate', () => {
    const refused = run(['add'], { title: 'alias bad', why: 'w', what: 'x', source: 'user', touches: ['../x.ts'] });
    assert.equal(refused.status, 1);
    assert.match(refused.json.error, /refusing absolute or escaping path/);
  });
});

describe('--hint scans both surfaces', () => {
  test('a hint matching only the observed half still finds the entry', () => {
    // Deliberate: a hint is how a user says "the thing about X", and where an
    // entry has already been is part of what it is about. Collision is the
    // rule that must stay blind to history, not relevance.
    writeRoadmap(project, [
      {
        id: '001',
        title: 'first',
        why: 'w',
        what: 'x',
        status: 'planned',
        source: 'user',
        depends_on: [],
        planned_touches: ['src/unrelated.ts'],
        observed_touches: ['src/tokenizer.ts'],
        commits: [],
        created_at: '2026-06-01',
        updated_at: '2026-06-01',
        notes: '',
      },
      {
        id: '002',
        title: 'second',
        why: 'w',
        what: 'x',
        status: 'planned',
        source: 'user',
        depends_on: [],
        planned_touches: ['src/other.ts'],
        observed_touches: [],
        commits: [],
        created_at: '2026-07-01',
        updated_at: '2026-07-01',
        notes: '',
      },
    ]);
    const { json } = run(['next-candidates', '--hint', 'tokenizer']);
    assert.equal(json.hint_matched, true);
    assert.equal(json.candidates[0].id, '001');
    assert.ok(json.candidates[0].hint_score > 0);
    assert.equal(json.candidates[1].hint_score, 0);
  });

  test('a hint matching the prediction works the same way', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', why: 'w', what: 'x', status: 'planned', source: 'user', depends_on: [], planned_touches: ['src/format.js'], observed_touches: [], commits: [], created_at: '2026-06-01', updated_at: '2026-06-01', notes: '' },
      { id: '002', title: 'b', why: 'w', what: 'x', status: 'planned', source: 'user', depends_on: [], planned_touches: ['src/tokenizer.js'], observed_touches: [], commits: [], created_at: '2026-07-01', updated_at: '2026-07-01', notes: '' },
    ]);
    const { json } = run(['next-candidates', '--hint', 'tokenizer']);
    assert.equal(json.candidates[0].id, '002');
  });
});
