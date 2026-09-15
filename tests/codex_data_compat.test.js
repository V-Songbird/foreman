'use strict';

// Records Foreman writes while Codex runs it (codex-suggested entries, exact
// model ids, Codex effort tiers, a Codex-written lesson), handled end to end by
// the one CLI both hosts share.
//
// Covers:
//   - doctor reports nothing for codex-suggested entries, exact model ids, the
//     none/minimal/ultra effort tiers, an archived Codex-closed entry, a lesson
//     recorded on one, and the settings both editions share
//   - list, list --summary, list --stats, next-candidates and correct read and
//     repair them
//   - update-status and annotate write to them, including a close that records
//     a lesson
//   - archive and restore move them, and reassign-id renumbers one
//   - notes, note-supersede and note-prune handle a Codex-written lesson
//   - a handoff crafts, for either host, for a Codex-suggested entry whose
//     parent Codex closed
//   - isValidModel keeps the legacy labels and exact ids, and refuses anything
//     that is not an identifier

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  runRoadmap, runNodeScript, makeTmpProject, writeRoadmap, writeArchiveFile, writeConfig, SCRIPTS_DIR,
} = require('./helpers');
const { isValidModel, MODELS } = require('../scripts/roadmap');

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

function record(fields) {
  return {
    status: 'planned',
    source: 'user',
    depends_on: [],
    planned_touches: [],
    observed_touches: [],
    commits: [],
    created_at: '2026-09-10',
    updated_at: '2026-09-10',
    notes: '',
    ...fields,
  };
}

// Distinct wording per entry, so the duplicate heuristic stays quiet.
const CODEX_ENTRIES = [
  { id: '001', title: 'Parse alpha manifests', why: 'Alpha manifests fail on nested keys.', what: 'Handle nested keys in parse() in src/alpha.js.', status: 'done', source: 'codex-suggested', model: 'gpt-5.6-sol', effort: 'ultra', planned_touches: ['src/alpha.js'], observed_touches: ['src/alpha.js'], commits: ['a1b2c3d'] },
  { id: '002', title: 'Render beta chart legend', why: 'Legend overlaps bars on narrow screens.', what: 'Wrap legend labels in src/beta.js.', status: 'done', model: 'gpt-5.6-luna', effort: 'none', commits: ['b2c3d4e'] },
  { id: '003', title: 'Cache gamma tiles', why: 'Tile fetches repeat on every pan.', what: 'Memoize tile requests in src/gamma.js.', status: 'awaiting_acceptance', source: 'codex-suggested', model: 'gpt-5.6-sol', effort: 'minimal', commits: ['c3d4e5f'] },
  { id: '004', title: 'Retry delta uploads', why: 'Uploads drop on flaky networks.', what: 'Add bounded retries around parse() in src/alpha.js.', source: 'codex-suggested', depends_on: ['001'], planned_touches: ['src/alpha.js'] },
];

const CODEX_SETTINGS = {
  requireVerification: true,
  discoverySuggestions: true,
  taskCloseGate: 'block',
  trialLog: false,
  usePersona: true,
  omitSections: ['tone'],
  checkpoints: { baseBranch: 'main', branch: true, onFinish: 'ask' },
  ledger: { enabled: true, dir: 'docs/foreman' },
};

const CODEX_LESSON = {
  area: 'src',
  paths: ['src/alpha.js'],
  entry: '001',
  anchor: { kind: 'commit', sha: 'a1b2c3d' },
  date: '2026-09-10',
  lesson: 'alpha manifests parse in src/alpha.js parse(); nested keys need the recursive walker',
};

function seedCodexProject() {
  writeRoadmap(project, CODEX_ENTRIES.map(record));
  writeConfig(project, CODEX_SETTINGS);
  fs.writeFileSync(
    path.join(project, '.foreman', 'notes.jsonl'),
    [JSON.stringify({ foreman_notes_format: 1 }), JSON.stringify(CODEX_LESSON)].join('\n') + '\n',
    'utf-8'
  );
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'alpha.js'), 'function parse() {}\nmodule.exports = { parse };\n', 'utf-8');
}

function storedRows(file) {
  return fs.readFileSync(file, 'utf-8').trim().split('\n')
    .map((line) => JSON.parse(line))
    .filter((row) => row.id !== undefined)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function defects(report) {
  return report.findings.filter((item) => item.severity !== 'info');
}

describe('doctor on Codex-written data', () => {
  test('reports nothing for its entries, archive, lesson and settings', () => {
    seedCodexProject();
    writeArchiveFile(project, [record({ id: '005', title: 'Index epsilon logs', why: 'Log search scans every file.', what: 'Build a daily index in src/epsilon.js.', status: 'done', source: 'codex-suggested', model: 'gpt-5.6-luna', effort: 'ultra', commits: ['d4e5f6a'] })]);
    const { status, json } = run(['doctor']);
    assert.equal(status, 0);
    assert.deepEqual(defects(json), []);
    assert.deepEqual(json.summary, { errors: 0, warnings: 0 });
  });
});

describe('reading and repairing Codex-written entries', () => {
  test('list, list --summary, list --stats and next-candidates read them', () => {
    seedCodexProject();
    const listed = run(['list']);
    assert.equal(listed.status, 0, JSON.stringify(listed.json));
    assert.deepEqual(listed.json.entries.map((e) => [e.id, e.source, e.model, e.effort]), [
      ['001', 'codex-suggested', 'gpt-5.6-sol', 'ultra'],
      ['002', 'user', 'gpt-5.6-luna', 'none'],
      ['003', 'codex-suggested', 'gpt-5.6-sol', 'minimal'],
      ['004', 'codex-suggested', undefined, undefined],
    ]);
    assert.equal(run(['list', '--summary']).json.entries.length, 4);
    assert.deepEqual(run(['list', '--stats']).json.stats, {
      closed: 3,
      by_model: { 'gpt-5.6-sol': 2, 'gpt-5.6-luna': 1 },
      by_effort: { none: 1, minimal: 1, ultra: 1 },
      no_model: 0,
      no_effort: 0,
    });
    const candidates = run(['next-candidates']);
    assert.equal(candidates.status, 0, JSON.stringify(candidates.json));
    assert.deepEqual(candidates.json.candidates.map((c) => c.id), ['004']);
  });

  test('correct repairs an open Codex-suggested entry that carries a Codex model', () => {
    seedCodexProject();
    const { status, json } = run(['correct'], {
      id: '003',
      expected_updated_at: '2026-09-10',
      expected: { what: 'Memoize tile requests in src/gamma.js.' },
      what: 'Memoize tile requests per zoom level in src/gamma.js.',
    });
    assert.equal(status, 0, JSON.stringify(json));
    assert.deepEqual(json.changed, ['what']);
    assert.equal(json.entry.model, 'gpt-5.6-sol');
    assert.equal(json.entry.source, 'codex-suggested');
  });
});

describe('writing to Codex-written entries', () => {
  test('update-status closes one with an exact model id and sends another back', () => {
    seedCodexProject();
    const closed = run(['update-status'], { id: '004', status: 'done', commit: 'e5f6a7b', model: 'gpt-5.6-luna', effort: 'none' });
    assert.equal(closed.status, 0, JSON.stringify(closed.json));
    assert.equal(closed.json.entry.model, 'gpt-5.6-luna');
    assert.equal(closed.json.entry.effort, 'none');

    const sentBack = run(['update-status'], { id: '003', status: 'in_progress', notes: 'the user saw a stale tile after zooming' });
    assert.equal(sentBack.status, 0, JSON.stringify(sentBack.json));
    assert.equal(sentBack.json.entry.model, 'gpt-5.6-sol');
    assert.equal(sentBack.json.entry.effort, 'minimal');

    assert.equal(run(['annotate'], { id: '003', notes: 'unverified: zoom out twice and check the tiles reload' }).status, 0);
    assert.equal(run(['doctor']).json.summary.errors, 0);
  });

  test('a close carrying Codex values records its lesson beside the Codex-written one', () => {
    seedCodexProject();
    const { status, json } = run(['update-status'], {
      id: '004',
      status: 'done',
      model: 'gpt-5.6-sol',
      effort: 'ultra',
      add_touches: ['src/alpha.js'],
      lesson: 'upload retries reuse the parse() walker in src/alpha.js',
    });
    assert.equal(status, 0, JSON.stringify(json));
    assert.equal(json.lesson.stored, true, JSON.stringify(json.lesson));
    assert.equal(run(['notes']).json.records.length, 2);
  });
});

describe('moving Codex-written entries', () => {
  test('archive and restore move them verbatim', () => {
    seedCodexProject();
    const roadmapFile = path.join(project, 'ROADMAP.jsonl');
    const before = storedRows(roadmapFile);

    const archived = run(['archive'], { ids: ['001', '002'] });
    assert.equal(archived.status, 0, JSON.stringify(archived.json));
    assert.deepEqual(archived.json.archived, ['001', '002']);
    assert.deepEqual(run(['list', '--archived', '--stats']).json.stats.by_model, { 'gpt-5.6-sol': 1, 'gpt-5.6-luna': 1 });
    assert.equal(run(['doctor']).json.summary.errors, 0);

    const restored = run(['restore'], { ids: ['001', '002'] });
    assert.equal(restored.status, 0, JSON.stringify(restored.json));
    assert.deepEqual(storedRows(roadmapFile), before);
    assert.equal(run(['doctor']).json.summary.errors, 0);
  });

  test('reassign-id renumbers a duplicate holder that carries a Codex model', () => {
    writeRoadmap(project, [
      record({ id: '001', title: 'Cache gamma tiles', why: 'Tile fetches repeat on every pan.', what: 'Memoize tile requests in src/gamma.js.', status: 'done', model: 'opus', effort: 'high', commits: ['b2c3d4e'] }),
      record({ id: '001', title: 'Index epsilon logs', why: 'Log search scans every file.', what: 'Build a daily index in src/epsilon.js.', status: 'done', source: 'codex-suggested', model: 'gpt-5.6-luna', effort: 'none', commits: ['c3d4e5f'] }),
    ]);
    const { status, json } = run(['reassign-id'], { id: '001', keep: 'Cache gamma tiles' });
    assert.equal(status, 0, JSON.stringify(json));
    const moved = run(['list', '--ids', '002']).json.entries[0];
    assert.equal(moved.title, 'Index epsilon logs');
    assert.equal(moved.model, 'gpt-5.6-luna');
    assert.equal(run(['doctor']).json.summary.errors, 0);
  });
});

describe('the ledger with a Codex-written lesson', () => {
  test('notes serves it, note-supersede retires it and note-prune clears it', () => {
    seedCodexProject();
    const served = run(['notes']).json;
    assert.equal(served.records.length, 1, JSON.stringify(served));
    const { key } = served.records[0];

    const retired = run(['note-supersede'], { key, by_entry: '004' });
    assert.equal(retired.json.superseded, true, JSON.stringify(retired.json));
    assert.deepEqual(run(['notes']).json.records, []);

    const dry = run(['note-prune', '--dry-run']).json;
    assert.equal(dry.dry_run, true);
    assert.deepEqual(dry.dropped, { dead: 0, superseded: 1 });
    const pruned = run(['note-prune']).json;
    assert.equal(pruned.pruned, true, JSON.stringify(pruned));
    assert.equal(pruned.kept, 0);
    assert.equal(run(['doctor']).json.summary.errors, 0);
  });
});

describe('handoff crafting', () => {
  for (const host of ['claude', 'codex']) {
    test(`crafts a gate-passing handoff for a Codex-suggested entry whose parent Codex closed (${host})`, () => {
      seedCodexProject();
      const result = runNodeScript(path.join(SCRIPTS_DIR, 'craft-handoff.js'), [], {
        entry: '004',
        host,
        destination: 'clipboard',
        judgment: {
          role: 'a senior backend engineer',
          goal: 'to add bounded retries to uploads so all tests pass',
          context: 'Uploads go through parse() in src/alpha.js before they are sent.',
          steps: ['Reproduce the dropped upload against the failing test.', 'Add bounded retries.'],
          constraints: ['Do not change the upload API.'],
          verification: [{ run: 'npm test', expected: 'all tests pass' }],
        },
      }, env);
      let json;
      try {
        json = JSON.parse(result.stdout);
      } catch {
        throw new Error(`non-JSON stdout (status ${result.status}): ${result.stdout}\n${result.stderr}`);
      }
      assert.equal(result.status, 0, JSON.stringify(json));
      assert.equal(json.ok, true);
      assert.equal(json.host, host);
      assert.equal(json.gate.ok, true, JSON.stringify(json.gate.errors));
      assert.match(json.prompt, /ROADMAP\.jsonl entry `004`/);
    });
  }
});

describe('isValidModel', () => {
  test('keeps every legacy label and exact ids', () => {
    for (const model of [...MODELS, 'gpt-5.6-sol', 'gpt-5.6-luna', 'claude-opus-5', 'org/model:tag_1.2', 'm'.repeat(128)]) {
      assert.equal(isValidModel(model), true, model);
    }
  });

  test('refuses an empty, over-long or malformed value', () => {
    for (const model of ['', 'm'.repeat(129), 'gpt 5.6', '.hidden', '-flag', 'model!', 'naïve', null, 42]) {
      assert.equal(isValidModel(model), false, String(model));
    }
  });
});
