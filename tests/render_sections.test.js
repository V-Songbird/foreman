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
//   - ledger: {enabled,dir} delegated to ledger-config; disabled
//     by default, honored from config and the FOREMAN_LEDGER* env
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
  test('no config.json -> no warnings', () => {
    const { status, json } = run();
    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.deepEqual(json.warnings, []);
  });

  test('corrupt config.json fails soft, no throw', () => {
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const { status, json } = run();
    assert.equal(status, 0);
    assert.equal(json.ok, true);
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

  // customSections was removed in 1.0. A leftover key is forward-compatible
  // noise here (doctor is what reports it), never a rendered section.
  test('a leftover customSections key renders nothing at all', () => {
    writeConfig(project, { customSections: [{ tag: 'note', content: 'x' }] });
    const { json } = run();
    assert.equal('sections' in json, false);
    assert.deepEqual(json.warnings, []);
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

  test('omitSections warnings surface alongside a config-level one', () => {
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const { json } = run();
    assert.deepEqual(json.omit, []);
    assert.ok(json.warnings.length >= 1);
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
});

// [Foreman: 185] Default ON and fail-toward-true, matching post-commit's
// reader: the safe reading holds finished work for acceptance.
describe('render-sections — requireVerification', () => {
  test('no config.json -> requireVerification defaults to true', () => {
    const { json } = run();
    assert.equal(json.requireVerification, true);
    assert.deepEqual(json.warnings, []);
  });

  test('config.json without requireVerification -> defaults to true', () => {
    writeConfig(project, { discoverySuggestions: true });
    const { json } = run();
    assert.equal(json.requireVerification, true);
  });

  for (const value of [true, false]) {
    test(`requireVerification: ${value} passes through`, () => {
      writeConfig(project, { requireVerification: value });
      const { json } = run();
      assert.equal(json.requireVerification, value);
      assert.deepEqual(json.warnings, []);
    });
  }

  test('a non-boolean requireVerification defaults to true with a warning', () => {
    writeConfig(project, { requireVerification: 'off' });
    const { status, json } = run();
    assert.equal(status, 0);
    assert.equal(json.requireVerification, true);
    assert.equal(json.warnings.length, 1);
    assert.match(json.warnings[0], /requireVerification.*not a boolean/);
  });

  test('corrupt config.json fails toward true', () => {
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const { json } = run();
    assert.equal(json.requireVerification, true);
  });
});

describe('render-sections — ledger', () => {
  test('no config.json -> disabled by default, default dir, no warnings', () => {
    const { json } = run();
    assert.equal(json.ledger.enabled, false);
    assert.equal(json.ledger.dir, 'docs/foreman');
    assert.deepEqual(json.warnings, []);
  });

  test('config.json without ledger -> disabled by default, default dir', () => {
    writeConfig(project, { discoverySuggestions: true });
    const { json } = run();
    assert.equal(json.ledger.enabled, false);
    assert.equal(json.ledger.dir, 'docs/foreman');
  });

  test('ledger.enabled:true flows into the output shape', () => {
    writeConfig(project, { ledger: { enabled: true } });
    const { json } = run();
    assert.equal(json.ledger.enabled, true);
    assert.equal(json.ledger.dir, 'docs/foreman');
    assert.deepEqual(json.warnings, []);
  });

  test('ledger.enabled:false explicitly opts out of the default', () => {
    writeConfig(project, { ledger: { enabled: false } });
    const { json } = run();
    assert.equal(json.ledger.enabled, false);
    assert.equal(json.ledger.dir, 'docs/foreman');
    assert.deepEqual(json.warnings, []);
  });

  test('a custom dir flows through to the rendered output', () => {
    writeConfig(project, { ledger: { enabled: true, dir: 'docs/adr' } });
    const { json } = run();
    assert.equal(json.ledger.enabled, true);
    assert.equal(json.ledger.dir, 'docs/adr');
  });

  // The two keys `ledger` replaced still resolve, so a project that opted
  // into either one keeps its setting without editing its config.
  test('the legacy areaNotes key still enables the ledger', () => {
    writeConfig(project, { areaNotes: { enabled: true } });
    const { json } = run();
    assert.equal(json.ledger.enabled, true);
  });

  test('the legacy decisionLog key still enables the ledger, dir included', () => {
    writeConfig(project, { decisionLog: { enabled: true, dir: 'docs/adr' } });
    const { json } = run();
    assert.equal(json.ledger.enabled, true);
    assert.equal(json.ledger.dir, 'docs/adr');
  });

  test('ledger wins over a legacy key that disagrees with it', () => {
    writeConfig(project, { ledger: { enabled: true }, areaNotes: { enabled: false } });
    const { json } = run();
    assert.equal(json.ledger.enabled, true);
  });

  test('FOREMAN_LEDGER=1 enables via the env path', () => {
    env.FOREMAN_LEDGER = '1';
    const { json } = run();
    assert.equal(json.ledger.enabled, true);
  });

  test('the legacy FOREMAN_DECISION_LOG env override still enables it', () => {
    env.FOREMAN_DECISION_LOG = '1';
    const { json } = run();
    assert.equal(json.ledger.enabled, true);
  });

  test('FOREMAN_LEDGER_DIR overrides the dir via the env path', () => {
    env.FOREMAN_LEDGER = '1';
    env.FOREMAN_LEDGER_DIR = 'docs/decisions';
    const { json } = run();
    assert.equal(json.ledger.enabled, true);
    assert.equal(json.ledger.dir, 'docs/decisions');
  });

  test('an invalid dir defaults and surfaces a warning through render-sections', () => {
    writeConfig(project, { ledger: { enabled: true, dir: '../escape' } });
    const { status, json } = run();
    assert.equal(status, 0);
    assert.equal(json.ledger.enabled, true);
    assert.equal(json.ledger.dir, 'docs/foreman');
    assert.ok(json.warnings.some((w) => /relative path/.test(w)));
  });

  test('corrupt config.json surfaces the ledger corrupt warning too', () => {
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const { status, json } = run();
    assert.equal(status, 0);
    assert.equal(json.ledger.enabled, false);
    assert.ok(json.warnings.some((w) => w.includes('ledger')));
  });
});
