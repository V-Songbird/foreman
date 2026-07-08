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
