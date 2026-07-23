'use strict';

// Tests for scripts/render-sections.js — validates and renders
// .foreman/config.json's optional `customSections` array into inline XML,
// and its optional `omitSections` array into a list of tags to drop, both
// for prompt-template.md's craft-time step.
//
// Covers:
//   - no config.json / no customSections field -> empty sections, no warnings
//   - corrupt config.json fails soft, same spirit as post-commit.js's readConfig
//   - a valid entry renders as <tag>\ncontent\n</tag>
//   - content is XML-escaped (&, <, >)
//   - a bad tag format, a reserved tag, a duplicate tag, and empty content
//     are each skipped with a warning instead of failing the whole call
//   - omitSections accepts only tone/example/background/output_format
//   - a non-omittable tag (including a guardrail like scope_discipline),
//     a non-string entry, and a duplicate are each skipped with a warning
//   - usePersona: declared in config (default true); other plugins' flag
//     files and the legacy inheritOperatorTone key are ignored entirely
//   - decisionLog: {enabled,dir} delegated to decision-log-config; disabled
//     by default, honored from config and the FOREMAN_DECISION_LOG* env
//     path, and its warning (invalid dir / corrupt config) surfaced through
//     render's own warning channel

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runRenderSections, makeTmpProject, writeConfig } = require('./helpers');

let project;
let env;

beforeEach(() => {
  project = makeTmpProject();
  env = { CLAUDE_PROJECT_DIR: project };
});

/** Fresh temp dir standing in for $CLAUDE_CONFIG_DIR, holding the named flag files. */
function makeFlagDir(...fileNames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-config-'));
  for (const name of fileNames) fs.writeFileSync(path.join(dir, name), '');
  return dir;
}

function run() {
  const result = runRenderSections(env);
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new Error(`non-JSON stdout (status ${result.status}): ${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, json };
}

describe('render-sections', () => {
  test('no config.json -> empty sections, no warnings', () => {
    const { status, json } = run();
    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.deepEqual(json.sections, []);
    assert.deepEqual(json.warnings, []);
  });

  test('config.json without customSections -> empty sections', () => {
    writeConfig(project, { discoverySuggestions: true });
    const { json } = run();
    assert.deepEqual(json.sections, []);
  });

  test('corrupt config.json fails soft -> empty sections, no throw', () => {
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const { status, json } = run();
    assert.equal(status, 0);
    assert.deepEqual(json.sections, []);
  });

  test('corrupt config.json warns rather than failing silently', () => {
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const { json } = run();
    assert.ok(json.warnings.some((w) => w.includes('could not be read as JSON')));
  });

  test('a missing config.json is the uninitialized case and stays silent', () => {
    const { status, json } = run();
    assert.equal(status, 0);
    assert.deepEqual(json.warnings, []);
  });

  test('valid entry renders as <tag>\\ncontent\\n</tag>', () => {
    writeConfig(project, {
      customSections: [{ tag: 'compliance_notice', content: 'Needs sign-off.' }],
    });
    const { json } = run();
    assert.equal(json.sections.length, 1);
    assert.equal(json.sections[0].tag, 'compliance_notice');
    assert.equal(json.sections[0].xml, '<compliance_notice>\nNeeds sign-off.\n</compliance_notice>');
    assert.deepEqual(json.warnings, []);
  });

  test('content is XML-escaped', () => {
    writeConfig(project, {
      customSections: [{ tag: 'note', content: 'A & B <are> "fine" > C' }],
    });
    const { json } = run();
    assert.equal(json.sections[0].xml, '<note>\nA &amp; B &lt;are&gt; "fine" &gt; C\n</note>');
  });

  test('bad tag format is skipped with a warning', () => {
    writeConfig(project, {
      customSections: [{ tag: 'Not Valid', content: 'x' }],
    });
    const { json } = run();
    assert.deepEqual(json.sections, []);
    assert.equal(json.warnings.length, 1);
    assert.match(json.warnings[0], /must match/);
  });

  test('reserved tag is skipped with a warning', () => {
    writeConfig(project, {
      customSections: [{ tag: 'scope_discipline', content: 'override attempt' }],
    });
    const { json } = run();
    assert.deepEqual(json.sections, []);
    assert.match(json.warnings[0], /reserved/);
  });

  test('duplicate tag is skipped with a warning, first one wins', () => {
    writeConfig(project, {
      customSections: [
        { tag: 'note', content: 'first' },
        { tag: 'note', content: 'second' },
      ],
    });
    const { json } = run();
    assert.equal(json.sections.length, 1);
    assert.match(json.sections[0].xml, /first/);
    assert.match(json.warnings[0], /duplicates/);
  });

  test('empty content is skipped with a warning', () => {
    writeConfig(project, {
      customSections: [{ tag: 'note', content: '   ' }],
    });
    const { json } = run();
    assert.deepEqual(json.sections, []);
    assert.match(json.warnings[0], /non-empty/);
  });

  test('one bad entry does not block a good one', () => {
    writeConfig(project, {
      customSections: [
        { tag: 'task_rules', content: 'reserved, skipped' },
        { tag: 'house_style', content: 'Use tabs.' },
      ],
    });
    const { json } = run();
    assert.equal(json.sections.length, 1);
    assert.equal(json.sections[0].tag, 'house_style');
    assert.equal(json.warnings.length, 1);
  });
});

describe('render-sections — omitSections', () => {
  test('no config.json -> empty omit', () => {
    const { json } = run();
    assert.deepEqual(json.omit, []);
  });

  test('valid omittable tags pass through', () => {
    writeConfig(project, { omitSections: ['tone', 'background', 'example', 'output_format'] });
    const { json } = run();
    assert.deepEqual(json.omit, ['tone', 'background', 'example', 'output_format']);
    assert.deepEqual(json.warnings, []);
  });

  test('a guardrail tag is rejected, never silently honored', () => {
    writeConfig(project, { omitSections: ['scope_discipline'] });
    const { json } = run();
    assert.deepEqual(json.omit, []);
    assert.match(json.warnings[0], /cannot be omitted/);
  });

  test('task_context and truth_grounding are rejected too', () => {
    writeConfig(project, { omitSections: ['task_context', 'truth_grounding', 'task_rules'] });
    const { json } = run();
    assert.deepEqual(json.omit, []);
    assert.equal(json.warnings.length, 3);
  });

  test('an unknown tag is rejected with a warning', () => {
    writeConfig(project, { omitSections: ['not_a_real_tag'] });
    const { json } = run();
    assert.deepEqual(json.omit, []);
    assert.match(json.warnings[0], /cannot be omitted/);
  });

  test('a non-string entry is rejected with a warning', () => {
    writeConfig(project, { omitSections: [42] });
    const { json } = run();
    assert.deepEqual(json.omit, []);
    assert.match(json.warnings[0], /must be a string/);
  });

  test('a duplicate is skipped with a warning', () => {
    writeConfig(project, { omitSections: ['tone', 'tone'] });
    const { json } = run();
    assert.deepEqual(json.omit, ['tone']);
    assert.match(json.warnings[0], /duplicates/);
  });

  test('customSections and omitSections warnings both surface together', () => {
    writeConfig(project, {
      customSections: [{ tag: 'scope_discipline', content: 'x' }],
      omitSections: ['scope_discipline'],
    });
    const { json } = run();
    assert.equal(json.sections.length, 0);
    assert.equal(json.omit.length, 0);
    assert.equal(json.warnings.length, 2);
  });
});

describe('render-sections — usePersona', () => {
  test('no config -> usePersona defaults to true', () => {
    const { json } = run();
    assert.equal(json.usePersona, true);
  });

  test('usePersona:false is honored', () => {
    writeConfig(project, { usePersona: false });
    const { json } = run();
    assert.equal(json.usePersona, false);
  });

  test('usePersona:true is explicit and equivalent to the default', () => {
    writeConfig(project, { usePersona: true });
    const { json } = run();
    assert.equal(json.usePersona, true);
  });

  test('unparseable config defaults usePersona to true', () => {
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const { json } = run();
    assert.equal(json.usePersona, true);
  });

  test('flag files and legacy inheritOperatorTone are ignored — declaration, not detection', () => {
    writeConfig(project, { inheritOperatorTone: false });
    env.CLAUDE_CONFIG_DIR = makeFlagDir('.style-a-active', '.style-b-active');
    const { json } = run();
    assert.equal(json.usePersona, true);
    // legacy detection-era keys must never come back in the output
    assert.equal(Object.keys(json).some((k) => /active$/i.test(k)), false);
    assert.equal('inheritOperatorTone' in json, false);
  });
});

describe('render-sections — targetModel', () => {
  test('no config.json -> targetModel defaults to "inherit"', () => {
    const { json } = run();
    assert.equal(json.targetModel, 'inherit');
    assert.deepEqual(json.warnings, []);
  });

  test('config.json without targetModel -> defaults to "inherit"', () => {
    writeConfig(project, { discoverySuggestions: true });
    const { json } = run();
    assert.equal(json.targetModel, 'inherit');
  });

  for (const value of ['haiku', 'sonnet', 'opus', 'fable', 'inherit']) {
    test(`targetModel: "${value}" passes through`, () => {
      writeConfig(project, { targetModel: value });
      const { json } = run();
      assert.equal(json.targetModel, value);
      assert.deepEqual(json.warnings, []);
    });
  }

  test('an invalid targetModel defaults to "inherit" with a warning, no throw', () => {
    writeConfig(project, { targetModel: 'gpt4' });
    const { status, json } = run();
    assert.equal(status, 0);
    assert.equal(json.targetModel, 'inherit');
    assert.equal(json.warnings.length, 1);
    assert.match(json.warnings[0], /not one of/);
  });

  test('a non-string targetModel defaults to "inherit" with a warning', () => {
    writeConfig(project, { targetModel: 42 });
    const { json } = run();
    assert.equal(json.targetModel, 'inherit');
    assert.match(json.warnings[0], /not one of/);
  });

  test('corrupt config.json fails soft -> targetModel "inherit", no throw', () => {
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const { status, json } = run();
    assert.equal(status, 0);
    assert.equal(json.targetModel, 'inherit');
  });
});

describe('render-sections — fableEnabled', () => {
  test('no config.json -> fableEnabled defaults to false', () => {
    const { json } = run();
    assert.equal(json.fableEnabled, false);
    assert.deepEqual(json.warnings, []);
  });

  test('config.json without fableEnabled -> defaults to false', () => {
    writeConfig(project, { discoverySuggestions: true });
    const { json } = run();
    assert.equal(json.fableEnabled, false);
  });

  for (const value of [true, false]) {
    test(`fableEnabled: ${value} passes through`, () => {
      writeConfig(project, { fableEnabled: value });
      const { json } = run();
      assert.equal(json.fableEnabled, value);
      assert.deepEqual(json.warnings, []);
    });
  }

  test('a non-boolean fableEnabled defaults to false with a warning, no throw', () => {
    writeConfig(project, { fableEnabled: 'on' });
    const { status, json } = run();
    assert.equal(status, 0);
    assert.equal(json.fableEnabled, false);
    assert.equal(json.warnings.length, 1);
    assert.match(json.warnings[0], /not a boolean/);
  });

  test('a customSections tag named "orchestration" is reserved and skipped', () => {
    writeConfig(project, { customSections: [{ tag: 'orchestration', content: 'x' }] });
    const { json } = run();
    assert.deepEqual(json.sections, []);
    assert.match(json.warnings[0], /reserved/);
  });

  test('a customSections tag named "decision_log" is reserved and skipped', () => {
    writeConfig(project, { customSections: [{ tag: 'decision_log', content: 'x' }] });
    const { json } = run();
    assert.deepEqual(json.sections, []);
    assert.match(json.warnings[0], /reserved/);
  });
});

describe('render-sections — decisionLog', () => {
  test('no config.json -> enabled by default, default dir, no warnings', () => {
    const { json } = run();
    assert.equal(json.decisionLog.enabled, true);
    assert.equal(json.decisionLog.dir, 'docs/foreman');
    assert.deepEqual(json.warnings, []);
  });

  test('config.json without decisionLog -> enabled by default, default dir', () => {
    writeConfig(project, { discoverySuggestions: true });
    const { json } = run();
    assert.equal(json.decisionLog.enabled, true);
    assert.equal(json.decisionLog.dir, 'docs/foreman');
  });

  test('decisionLog.enabled:true flows into the output shape', () => {
    writeConfig(project, { decisionLog: { enabled: true } });
    const { json } = run();
    assert.equal(json.decisionLog.enabled, true);
    assert.equal(json.decisionLog.dir, 'docs/foreman');
    assert.deepEqual(json.warnings, []);
  });

  test('decisionLog.enabled:false explicitly opts out of the default', () => {
    writeConfig(project, { decisionLog: { enabled: false } });
    const { json } = run();
    assert.equal(json.decisionLog.enabled, false);
    assert.equal(json.decisionLog.dir, 'docs/foreman');
    assert.deepEqual(json.warnings, []);
  });

  test('a custom dir flows through to the rendered output', () => {
    writeConfig(project, { decisionLog: { enabled: true, dir: 'docs/adr' } });
    const { json } = run();
    assert.equal(json.decisionLog.enabled, true);
    assert.equal(json.decisionLog.dir, 'docs/adr');
  });

  // gate is a close-time concern (task-completed.js); it never reaches the
  // craft-time output shape even when set.
  test('gate is not exposed in the craft-time output', () => {
    writeConfig(project, { decisionLog: { enabled: true, gate: 'block' } });
    const { json } = run();
    assert.equal('gate' in json.decisionLog, false);
  });

  test('FOREMAN_DECISION_LOG=1 enables via the env path', () => {
    env.FOREMAN_DECISION_LOG = '1';
    const { json } = run();
    assert.equal(json.decisionLog.enabled, true);
  });

  test('FOREMAN_DECISION_LOG_DIR overrides the dir via the env path', () => {
    env.FOREMAN_DECISION_LOG = '1';
    env.FOREMAN_DECISION_LOG_DIR = 'docs/decisions';
    const { json } = run();
    assert.equal(json.decisionLog.enabled, true);
    assert.equal(json.decisionLog.dir, 'docs/decisions');
  });

  test('an invalid dir defaults and surfaces a warning through render-sections', () => {
    writeConfig(project, { decisionLog: { enabled: true, dir: '../escape' } });
    const { status, json } = run();
    assert.equal(status, 0);
    assert.equal(json.decisionLog.enabled, true);
    assert.equal(json.decisionLog.dir, 'docs/foreman');
    assert.ok(json.warnings.some((w) => /relative path/.test(w)));
  });

  test('corrupt config.json surfaces the decisionLog corrupt warning too', () => {
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const { status, json } = run();
    assert.equal(status, 0);
    assert.equal(json.decisionLog.enabled, true);
    assert.ok(json.warnings.some((w) => w.includes('decisionLog')));
  });
});
