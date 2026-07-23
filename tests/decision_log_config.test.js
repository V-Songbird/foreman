'use strict';

// Tests for scripts/decision-log-config.js — the shared reader for the
// decision-log feature's settings (env override -> .foreman/config.json's
// `decisionLog` group -> defaults), used by render-sections.js,
// hooks/task-completed.js, and a tripwire hook.
//
// Covers:
//   - no config.json -> DECISION_LOG_DEFAULTS, no warning
//   - full decisionLog group read
//   - partial group (only some keys set) falls back per-key
//   - corrupt config.json -> defaults, one warning
//   - invalid gate value -> default "nudge", warning names the value
//   - invalid dir value (leading slash, "..") -> default dir, warning
//   - FOREMAN_DECISION_LOG "1"/"true"/"0"/"false" override enabled,
//     including precedence over config, and other values are ignored
//   - FOREMAN_DECISION_LOG_DIR overrides dir, including precedence over
//     config; invalid value is ignored with a warning

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { makeTmpProject, writeConfig } = require('./helpers');
const {
  readDecisionLog,
  DECISION_LOG_DEFAULTS,
  VALID_GATES,
} = require('../scripts/decision-log-config');

let project;

beforeEach(() => {
  project = makeTmpProject();
});

afterEach(() => {
  delete process.env.FOREMAN_DECISION_LOG;
  delete process.env.FOREMAN_DECISION_LOG_DIR;
});

describe('decision-log-config', () => {
  test('no config.json -> DECISION_LOG_DEFAULTS, no warning', () => {
    const result = readDecisionLog(project);
    assert.deepEqual(result, { ...DECISION_LOG_DEFAULTS, warning: null });
  });

  test('full decisionLog group is read', () => {
    writeConfig(project, { decisionLog: { enabled: true, dir: 'adr', gate: 'block' } });
    const result = readDecisionLog(project);
    assert.deepEqual(result, { enabled: true, dir: 'adr', gate: 'block', warning: null });
  });

  test('partial group falls back per-key', () => {
    writeConfig(project, { decisionLog: { enabled: true } });
    const result = readDecisionLog(project);
    assert.equal(result.enabled, true);
    assert.equal(result.dir, DECISION_LOG_DEFAULTS.dir);
    assert.equal(result.gate, DECISION_LOG_DEFAULTS.gate);
    assert.equal(result.warning, null);
  });

  test('missing decisionLog group -> defaults, no warning', () => {
    writeConfig(project, { usePersona: true });
    const result = readDecisionLog(project);
    assert.deepEqual(result, { ...DECISION_LOG_DEFAULTS, warning: null });
  });

  test('corrupt config.json -> defaults, one warning', () => {
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const result = readDecisionLog(project);
    assert.equal(result.enabled, DECISION_LOG_DEFAULTS.enabled);
    assert.equal(result.dir, DECISION_LOG_DEFAULTS.dir);
    assert.equal(result.gate, DECISION_LOG_DEFAULTS.gate);
    assert.match(result.warning, /could not be read as JSON/);
    assert.match(result.warning, /every decisionLog setting fell back to its default/);
  });

  test('invalid gate value -> defaults to "nudge", warning names the value', () => {
    writeConfig(project, { decisionLog: { gate: 'yolo' } });
    const result = readDecisionLog(project);
    assert.equal(result.gate, 'nudge');
    assert.ok(VALID_GATES.has(result.gate));
    assert.match(result.warning, /"yolo"/);
    assert.match(result.warning, /defaulted to "nudge"/);
  });

  test('invalid dir value (leading slash) -> default dir, warning', () => {
    writeConfig(project, { decisionLog: { dir: '/etc/docs' } });
    const result = readDecisionLog(project);
    assert.equal(result.dir, DECISION_LOG_DEFAULTS.dir);
    assert.match(result.warning, /"\/etc\/docs"/);
  });

  test('invalid dir value (".." segment) -> default dir, warning', () => {
    writeConfig(project, { decisionLog: { dir: '../outside' } });
    const result = readDecisionLog(project);
    assert.equal(result.dir, DECISION_LOG_DEFAULTS.dir);
    assert.match(result.warning, /\.\.\/outside/);
  });

  test('FOREMAN_DECISION_LOG=1 overrides enabled:false in config', () => {
    writeConfig(project, { decisionLog: { enabled: false } });
    process.env.FOREMAN_DECISION_LOG = '1';
    const result = readDecisionLog(project);
    assert.equal(result.enabled, true);
  });

  test('FOREMAN_DECISION_LOG=true overrides enabled:false in config', () => {
    writeConfig(project, { decisionLog: { enabled: false } });
    process.env.FOREMAN_DECISION_LOG = 'true';
    const result = readDecisionLog(project);
    assert.equal(result.enabled, true);
  });

  test('FOREMAN_DECISION_LOG=0 overrides enabled:true in config', () => {
    writeConfig(project, { decisionLog: { enabled: true } });
    process.env.FOREMAN_DECISION_LOG = '0';
    const result = readDecisionLog(project);
    assert.equal(result.enabled, false);
  });

  test('FOREMAN_DECISION_LOG=false overrides enabled:true in config', () => {
    writeConfig(project, { decisionLog: { enabled: true } });
    process.env.FOREMAN_DECISION_LOG = 'false';
    const result = readDecisionLog(project);
    assert.equal(result.enabled, false);
  });

  test('FOREMAN_DECISION_LOG with an unrecognized value is ignored', () => {
    writeConfig(project, { decisionLog: { enabled: true } });
    process.env.FOREMAN_DECISION_LOG = 'yes-please';
    const result = readDecisionLog(project);
    assert.equal(result.enabled, true);
    assert.equal(result.warning, null);
  });

  test('FOREMAN_DECISION_LOG_DIR overrides dir set in config', () => {
    writeConfig(project, { decisionLog: { dir: 'adr' } });
    process.env.FOREMAN_DECISION_LOG_DIR = 'notes/decisions';
    const result = readDecisionLog(project);
    assert.equal(result.dir, 'notes/decisions');
    assert.equal(result.warning, null);
  });

  test('FOREMAN_DECISION_LOG_DIR overrides the default dir when config is absent', () => {
    process.env.FOREMAN_DECISION_LOG_DIR = 'notes/decisions';
    const result = readDecisionLog(project);
    assert.equal(result.dir, 'notes/decisions');
  });

  test('FOREMAN_DECISION_LOG_DIR with an invalid value is ignored, warning kept', () => {
    writeConfig(project, { decisionLog: { dir: 'adr' } });
    process.env.FOREMAN_DECISION_LOG_DIR = '../escape';
    const result = readDecisionLog(project);
    assert.equal(result.dir, 'adr');
    assert.match(result.warning, /FOREMAN_DECISION_LOG_DIR/);
    assert.match(result.warning, /ignored/);
  });

  test('FOREMAN_DECISION_LOG_DIR empty string is ignored (falls through to config/default)', () => {
    writeConfig(project, { decisionLog: { dir: 'adr' } });
    process.env.FOREMAN_DECISION_LOG_DIR = '';
    const result = readDecisionLog(project);
    assert.equal(result.dir, 'adr');
    assert.equal(result.warning, null);
  });
});
