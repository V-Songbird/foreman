'use strict';

// [Foreman: 209] The model-side half of the trial log. Which menu row the user
// chose, and that a question was asked at all, exist only inside the model's
// own turn — no script and no hook can observe them, so these events are
// written by skill prose or they are not written. Without them
// roadmap-health.js reports recommendation_acceptance and override_rate as
// null however complete the script-side half is.
//
// The instructions are prose, so the pins here are on the things a silent typo
// would break: an event name or a flow that the vocabulary does not carry
// would validate to nothing and lose the row forever.
//
// Covers:
//   - every event the skills name is a real event, and every flow a real flow
//   - each branch records its own flow, and doctor.md records nothing
//   - pick.md carries all four recommendation events
//   - init/SKILL.md carries init_started, init_completed and the snapshot
//     recovery
//   - the shapes the prose writes actually pass the writer's own validator

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { makeTmpProject, runNodeScript, SCRIPTS_DIR } = require('./helpers.js');
const trial = require(path.join(SCRIPTS_DIR, 'trial-log.js'));

const SKILLS = path.join(__dirname, '..', 'skills');
const TRIAL_CLI = path.join(SCRIPTS_DIR, 'trial-log.js');

function skill(...rel) {
  return fs.readFileSync(path.join(SKILLS, ...rel), 'utf-8');
}

// Every `trial-log.js <event> '<json>'` invocation written anywhere in skills/.
function invocations() {
  const found = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) {
        const text = fs.readFileSync(full, 'utf-8');
        const re = /trial-log\.js\s+([a-z_]+)\s+'([^']*)'/g;
        let m;
        while ((m = re.exec(text)) !== null) {
          found.push({ file: path.relative(SKILLS, full).split(path.sep).join('/'), event: m[1], fields: m[2] });
        }
      }
    }
  })(SKILLS);
  return found;
}

describe('the model-side trial events', () => {
  test('the skills write at least one invocation, or this whole file is vacuous', () => {
    assert.ok(invocations().length >= 8, `only ${invocations().length} invocations found`);
  });

  test('every event name the skills write is a real event', () => {
    const known = new Set(Object.keys(trial.EVENTS));
    for (const inv of invocations()) {
      assert.ok(known.has(inv.event), `${inv.file} writes unknown event "${inv.event}"`);
    }
  });

  test('every flow the skills write is a real flow', () => {
    const known = new Set(trial.FLOWS);
    for (const inv of invocations()) {
      const m = inv.fields.match(/"flow"\s*:\s*"([^"]+)"/);
      if (!m) continue;
      assert.ok(known.has(m[1]), `${inv.file} writes unknown flow "${m[1]}"`);
    }
  });

  test('every recovery kind the skills write is a real kind', () => {
    const known = new Set(trial.RECOVERY_KINDS);
    for (const inv of invocations()) {
      const m = inv.fields.match(/"kind"\s*:\s*"([^"]+)"/);
      if (!m) continue;
      assert.ok(known.has(m[1]), `${inv.file} writes unknown recovery kind "${m[1]}"`);
    }
  });

  test('each branch records its own flow', () => {
    const expected = [
      ['roadmap/add.md', 'add'],
      ['roadmap/correct.md', 'correct'],
      ['survey/SKILL.md', 'survey'],
      ['roadmap/pick.md', 'pick'],
      ['init/SKILL.md', 'init'],
    ];
    for (const [rel, flow] of expected) {
      const text = skill(...rel.split('/'));
      assert.match(
        text,
        new RegExp(`question_asked '\\{"flow":"${flow}"\\}'`),
        `${rel} does not record question_asked with flow "${flow}"`
      );
    }
  });

  test('doctor.md records nothing, because it has no flow to record', () => {
    assert.ok(!trial.FLOWS.includes('doctor'), 'a doctor flow appeared; this test needs revisiting');
    assert.ok(
      !/trial-log\.js/.test(skill('roadmap', 'doctor.md')),
      'doctor.md writes a trial event but the vocabulary has no flow for it'
    );
  });

  test('pick.md carries all four recommendation events', () => {
    const text = skill('roadmap', 'pick.md');
    for (const event of ['menu_shown', 'hint_used', 'pick_accepted', 'pick_overridden']) {
      assert.match(text, new RegExp(`trial-log\\.js ${event} `), `pick.md never records ${event}`);
    }
    // The two branches that must NOT record a pick are named out loud.
    const flat = text.replace(/\s+/g, ' ');
    assert.ok(/settles existing work rather than answering "what next", so it records neither/.test(flat));
    assert.ok(/defer\*\* sub-branch records neither/.test(flat));
  });

  test('init/SKILL.md carries the setup pair and the snapshot recovery', () => {
    const text = skill('init', 'SKILL.md');
    for (const event of ['init_started', 'init_completed', 'recovery_attempted']) {
      assert.match(text, new RegExp(`trial-log\\.js ${event} `), `init never records ${event}`);
    }
    assert.match(text, /"kind":"reinit-snapshot"/);
    const flat = text.replace(/\s+/g, ' ');
    assert.ok(
      /how many `add` calls actually succeeded, never how many were drafted/.test(flat),
      'init_completed no longer says tasks counts successes, not drafts'
    );
    assert.ok(
      /`init_started` with no `init_completed`/.test(flat),
      'the abandoned-setup record is no longer described'
    );
  });

  test('every prose invocation says it is silent and never blocks', () => {
    const files = new Set(invocations().map((i) => i.file));
    for (const rel of files) {
      const flat = fs.readFileSync(path.join(SKILLS, rel), 'utf-8').replace(/\s+/g, ' ');
      assert.ok(
        /no-op unless the project set `trialLog`/.test(flat),
        `${rel} does not say the write is a no-op when the trial is off`
      );
      assert.ok(
        /never blocks the flow/.test(flat),
        `${rel} does not say the write never blocks the flow`
      );
    }
  });

  test('the shapes the prose writes pass the writer\'s own validator', () => {
    const shapes = [
      ['question_asked', { flow: 'pick' }],
      ['menu_shown', { candidates: 3, hint: true }],
      ['hint_used', { hit: false }],
      ['pick_accepted', { rank: 1 }],
      ['pick_overridden', { chosen_rank: 2 }],
      ['pick_overridden', { chosen_rank: null }],
      ['init_started', {}],
      ['init_completed', { tasks: 4 }],
      ['recovery_attempted', { kind: 'reinit-snapshot', success: true }],
    ];
    for (const [event, fields] of shapes) {
      assert.equal(
        trial.validate(event, fields),
        null,
        `${event} ${JSON.stringify(fields)} would be dropped as invalid`
      );
    }
  });

  test('the CLI the prose calls actually appends a row when the trial is on', () => {
    const project = makeTmpProject();
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(
      path.join(project, '.foreman', 'config.json'),
      JSON.stringify({ trialLog: true }),
      'utf-8'
    );

    const result = runNodeScript(TRIAL_CLI, ['question_asked', '{"flow":"pick"}'], null, {
      CLAUDE_PROJECT_DIR: project,
    });
    const out = JSON.parse(result.stdout);
    assert.equal(out.recorded, true, JSON.stringify(out));

    const rows = trial.readEvents(project);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event, 'question_asked');
    assert.equal(rows[0].flow, 'pick');
  });

  test('the same call is a silent no-op on a project that never opted in', () => {
    const project = makeTmpProject();
    const result = runNodeScript(TRIAL_CLI, ['question_asked', '{"flow":"pick"}'], null, {
      CLAUDE_PROJECT_DIR: project,
    });
    const out = JSON.parse(result.stdout);
    assert.equal(out.recorded, false);
    assert.equal(out.reason, 'disabled');
    assert.equal(result.status, 0, 'an opted-out project must not see a failure');
    assert.ok(!fs.existsSync(trial.logPath(project)), 'a log was created for a project that never opted in');
  });
});
