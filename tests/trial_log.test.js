'use strict';

// [Foreman: 208] The opt-in trial log's writer and the surfaces wired to it.
//
// Covers:
//   - off by default: no config, no key, a false key, and a corrupt config
//     all record nothing and create no file
//   - the closed vocabulary is a real gate: unknown event, missing field,
//     wrong-typed field, and an unlisted extra key are all refused
//   - every recorded line carries event/ts/session and nothing else
//   - the session token is opaque, stable within a session, and renewed by
//     startSession
//   - a write failure is reported, never thrown
//   - first_pick fires once ever, and its seconds_since_init is null by
//     design rather than by omission
//   - resume recovery counts a success only after an earlier day saw the work
//     un-recovered — a task that ran start to finish is not a recovery
//   - the wired surfaces: next-candidates --menu, safe-commit's refusals

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  makeTmpProject,
  writeConfig,
  writeRoadmap,
  runRoadmap,
  runNodeScript,
  initGitRepo,
  commitFile,
  HOOKS_DIR,
  SCRIPTS_DIR,
} = require('./helpers');
const trial = require('../scripts/trial-log');

let project;

beforeEach(() => {
  project = makeTmpProject();
});

function on() {
  writeConfig(project, { trialLog: true });
}

function lines() {
  try {
    return fs
      .readFileSync(trial.logPath(project), 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function record(event, fields) {
  return trial.record(event, fields, { root: project });
}

describe('trial log — opt-in', () => {
  test('records nothing with no config at all', () => {
    const result = record('session_start', {});
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'disabled');
    assert.ok(!fs.existsSync(trial.logPath(project)), 'no log file may be created while off');
  });

  test('records nothing when the key is absent or false', () => {
    for (const config of [{}, { trialLog: false }, { trialLog: 'yes' }, { trialLog: 1 }]) {
      writeConfig(project, config);
      assert.equal(record('session_start', {}).reason, 'disabled', JSON.stringify(config));
    }
    assert.deepEqual(lines(), []);
  });

  test('a corrupt config reads as off, never as an error', () => {
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{ not json');
    assert.equal(record('session_start', {}).reason, 'disabled');
  });

  test('records once the project opts in', () => {
    on();
    assert.equal(record('session_start', {}).recorded, true);
    assert.equal(lines().length, 1);
  });
});

describe('trial log — the closed vocabulary', () => {
  beforeEach(on);

  test('an unknown event is refused', () => {
    const result = record('user_said_something', {});
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'invalid');
    assert.match(result.error, /unknown event/);
    assert.deepEqual(lines(), []);
  });

  test('a missing required field is refused, naming it', () => {
    const result = record('question_asked', {});
    assert.equal(result.reason, 'invalid');
    assert.match(result.error, /question_asked requires flow/);
  });

  test('a value outside the closed list is refused', () => {
    assert.match(record('question_asked', { flow: 'checkout' }).error, /not a legal value/);
    assert.match(record('commit_interrupted', { hook: 'safe-commit', reason_class: 'the tree was dirty' }).error, /not a legal value/);
    assert.match(record('recovery_attempted', { kind: 'resume-in-progress', success: 'yes' }).error, /not a legal value/);
    assert.match(record('menu_shown', { candidates: -1, hint: false }).error, /not a legal value/);
    assert.deepEqual(lines(), []);
  });

  // The privacy guarantee is only worth something if a free-text value cannot
  // ride along on an otherwise-legal event.
  test('an extra key is refused rather than passed through', () => {
    const result = record('menu_shown', { candidates: 3, hint: false, title: 'Add JWT refresh middleware' });
    assert.equal(result.reason, 'invalid');
    assert.match(result.error, /does not record title/);
    assert.deepEqual(lines(), []);
  });

  test('every legal event shape is accepted', () => {
    const legal = [
      ['menu_shown', { candidates: 3, hint: false }],
      ['pick_accepted', { rank: 1 }],
      ['pick_overridden', { chosen_rank: null }],
      ['hint_used', { hit: true }],
      ['session_start', {}],
      ['init_started', {}],
      ['init_completed', { tasks: 6 }],
      ['first_pick', { seconds_since_init: null, sessions_since_init: 0 }],
      ['question_asked', { flow: 'pick' }],
      ['commit_interrupted', { hook: 'safe-commit', reason_class: 'dirty_tree' }],
      ['recovery_attempted', { kind: 'resume-in-progress', success: true }],
    ];
    for (const [event, fields] of legal) {
      assert.equal(record(event, fields).recorded, true, `${event} should be legal`);
    }
    assert.equal(lines().length, legal.length);
  });
});

describe('trial log — what a line carries', () => {
  beforeEach(on);

  test('every line is event + ts + session and its own declared fields', () => {
    record('menu_shown', { candidates: 2, hint: true });
    const [line] = lines();
    assert.deepEqual(Object.keys(line).sort(), ['candidates', 'event', 'hint', 'session', 'ts'].sort());
    assert.match(line.ts, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('the session token is opaque and stable across writes', () => {
    record('session_start', {});
    record('menu_shown', { candidates: 1, hint: false });
    const [a, b] = lines();
    assert.match(a.session, /^[0-9a-f]{12}$/);
    assert.equal(a.session, b.session);
    assert.ok(!a.session.includes(path.basename(project)), 'the token must not be derived from the project');
  });

  test('startSession renews the token so two sessions do not pair as one', () => {
    trial.startSession({ root: project });
    const first = lines()[0].session;
    trial.startSession({ root: project });
    const second = lines()[1].session;
    assert.notEqual(first, second);
  });
});

describe('trial log — a trial never breaks the work', () => {
  test('an unwritable log is reported, not thrown', () => {
    on();
    // A directory where the log file belongs makes appendFileSync fail the
    // same way a read-only .foreman would.
    fs.mkdirSync(trial.logPath(project), { recursive: true });
    const result = record('session_start', {});
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'write_failed');
  });
});

describe('trial log — first_pick', () => {
  beforeEach(on);

  test('fires once and never again', () => {
    assert.equal(trial.recordFirstPick({ root: project }).recorded, true);
    assert.equal(trial.recordFirstPick({ root: project }).reason, 'already_recorded');
    assert.equal(lines().filter((l) => l.event === 'first_pick').length, 1);
  });

  // Not an oversight: the log stores dates, never times, so no elapsed
  // duration can be derived from it.
  test('seconds_since_init is null by design; sessions_since_init counts', () => {
    record('init_completed', { tasks: 4 });
    record('session_start', {});
    record('session_start', {});
    trial.recordFirstPick({ root: project });

    const pick = lines().find((l) => l.event === 'first_pick');
    assert.equal(pick.seconds_since_init, null);
    assert.equal(pick.sessions_since_init, 2);
  });

  test('both are null on a project whose init predates the trial', () => {
    trial.recordFirstPick({ root: project });
    const pick = lines().find((l) => l.event === 'first_pick');
    assert.equal(pick.seconds_since_init, null);
    assert.equal(pick.sessions_since_init, null);
  });
});

describe('trial log — resume recovery', () => {
  beforeEach(on);

  // The failure rows session-start writes are what make a later close a
  // recovery. Without one, a close is just a task finishing.
  test('a close with no earlier interruption is not a recovery', () => {
    const result = trial.recordResumeRecovered({ root: project });
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'no_prior_interruption');
    assert.deepEqual(lines(), []);
  });

  test('a same-day interruption does not count — the view is per-day', () => {
    record('recovery_attempted', { kind: 'resume-in-progress', success: false });
    assert.equal(trial.recordResumeRecovered({ root: project }).reason, 'no_prior_interruption');
  });

  test('an interruption seen on an earlier day makes the close a recovery', () => {
    record('recovery_attempted', { kind: 'resume-in-progress', success: false });
    // Rewrite that row's date to an earlier day — the only thing this test
    // cannot do is wait until tomorrow.
    const rows = lines();
    rows[0].ts = '2026-01-01';
    fs.writeFileSync(trial.logPath(project), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

    assert.equal(trial.recordResumeRecovered({ root: project }).recorded, true);
    const recovered = lines().filter((l) => l.event === 'recovery_attempted' && l.success === true);
    assert.equal(recovered.length, 1);
  });
});

describe('trial log — wired surfaces', () => {
  function entry(id, overrides = {}) {
    return {
      id,
      title: `Task ${id}`,
      why: `Why ${id}`,
      what: `What ${id}`,
      status: 'planned',
      source: 'user',
      depends_on: [],
      planned_touches: [`src/${id}.js`],
      observed_touches: [],
      commits: [],
      created_at: '2026-07-01',
      updated_at: '2026-07-27',
      notes: '',
      ...overrides,
    };
  }

  test('next-candidates --menu records the menu the user is about to read', () => {
    on();
    writeRoadmap(project, [entry('001'), entry('002', { status: 'in_progress' })]);
    runRoadmap(['next-candidates', '--menu'], undefined, { CLAUDE_PROJECT_DIR: project });

    const menus = lines().filter((l) => l.event === 'menu_shown');
    assert.equal(menus.length, 1);
    // One candidate plus the in_progress row the finish-first check promotes.
    assert.equal(menus[0].candidates, 2);
    assert.equal(menus[0].hint, false);
    assert.equal(lines().filter((l) => l.event === 'hint_used').length, 0);
  });

  test('a hinted menu also records whether the hint found anything', () => {
    on();
    writeRoadmap(project, [entry('001', { title: 'Add JWT refresh middleware' })]);
    runRoadmap(['next-candidates', '--menu', '--hint', 'refresh middleware'], undefined, {
      CLAUDE_PROJECT_DIR: project,
    });

    const [hint] = lines().filter((l) => l.event === 'hint_used');
    assert.equal(hint.hit, true);
    assert.equal(lines().find((l) => l.event === 'menu_shown').hint, true);
  });

  test('the full (non-menu) shape records nothing — no menu was shown', () => {
    on();
    writeRoadmap(project, [entry('001')]);
    runRoadmap(['next-candidates'], undefined, { CLAUDE_PROJECT_DIR: project });
    assert.deepEqual(lines(), []);
  });

  test('a menu on a project that never opted in records nothing', () => {
    writeRoadmap(project, [entry('001')]);
    runRoadmap(['next-candidates', '--menu'], undefined, { CLAUDE_PROJECT_DIR: project });
    assert.deepEqual(lines(), []);
  });

  test('session start records the session and each un-recovered open entry', () => {
    on();
    writeRoadmap(project, [
      // Interrupted: open and already carrying a commit.
      entry('001', { status: 'in_progress', commits: ['abc1234'] }),
      // Open but never started — not an interruption.
      entry('002', { status: 'in_progress' }),
      entry('003'),
    ]);
    runNodeScript(path.join(HOOKS_DIR, 'session-start.js'), [], { source: 'startup', cwd: project }, {
      CLAUDE_PROJECT_DIR: project,
    });

    assert.equal(lines().filter((l) => l.event === 'session_start').length, 1);
    const resumes = lines().filter((l) => l.event === 'recovery_attempted');
    assert.equal(resumes.length, 1);
    assert.deepEqual(
      { kind: resumes[0].kind, success: resumes[0].success },
      { kind: 'resume-in-progress', success: false }
    );
  });

  // safe-commit's `begin` reports a dirty tree with ok:true and a prose
  // reason about the user's working tree. TRIALS.md says that prose is
  // deliberately not what reason_class records — the closed name is.
  test('a dirty-tree refusal records the class, never safe-commit\'s prose reason', () => {
    on();
    initGitRepo(project);
    commitFile(project, 'a.txt', 'a\n');
    fs.writeFileSync(path.join(project, 'dirty.txt'), 'x\n');

    const result = runNodeScript(path.join(SCRIPTS_DIR, 'safe-commit.js'), ['begin'], null, {
      CLAUDE_PROJECT_DIR: project,
    });
    const returned = JSON.parse(result.stdout);
    assert.equal(returned.dirty, true);

    const [interrupted] = lines().filter((l) => l.event === 'commit_interrupted');
    assert.equal(interrupted.hook, 'safe-commit');
    assert.equal(interrupted.reason_class, 'dirty_tree');
    assert.ok(
      !JSON.stringify(interrupted).includes(returned.reason),
      'the working-tree prose must not reach the log'
    );
  });

  test('a clean begin is not an interruption', () => {
    on();
    initGitRepo(project);
    // The opt-in config itself is a working-tree change until it is
    // committed, so commit it before asking whether the tree is clean.
    commitFile(project, '.foreman/config.json', JSON.stringify({ trialLog: true }));
    commitFile(project, 'a.txt', 'a\n');

    const result = runNodeScript(path.join(SCRIPTS_DIR, 'safe-commit.js'), ['begin'], null, {
      CLAUDE_PROJECT_DIR: project,
    });
    assert.equal(JSON.parse(result.stdout).dirty, false);
    assert.deepEqual(lines(), []);
  });
});
