'use strict';

// Shared settings reader for the decision-log feature (per-task ADR docs
// under a configurable dir, anchored from code by `[Foreman: <id>]`
// comments). Three consumers — scripts/render-sections.js (prompt-craft
// time), hooks/task-completed.js (close gate), and a tripwire hook — all
// need the same values through one precedence chain: env override ->
// .foreman/config.json -> defaults. This module owns that chain once so
// none of the three restate it or drift apart.

const fs = require('fs');
const path = require('path');

const DECISION_LOG_DEFAULTS = Object.freeze({
  enabled: true,
  dir: 'docs/foreman',
  gate: 'nudge',
});

const VALID_GATES = new Set(['off', 'nudge', 'block']);

function configPath(root) {
  return path.join(root, '.foreman', 'config.json');
}

// A relative path with no leading slash/backslash, no drive-letter root,
// and no ".." segment — the scope the caller trusts a dir to write ADR
// docs under. Trailing slashes and "./" segments are tolerated.
function isValidDir(value) {
  if (typeof value !== 'string' || value === '') return false;
  if (value.startsWith('/') || value.startsWith('\\')) return false;
  if (path.isAbsolute(value)) return false;
  return value.split(/[\\/]+/).filter(Boolean).every((seg) => seg !== '..');
}

// Fail-soft, same spirit as render-sections.js's readConfig: a missing or
// corrupt config.json never blocks a caller, it just means decisionLog
// reverts to its defaults for this read. A file that exists but won't
// parse loses every decisionLog setting to its default, and that loss is
// reported (not silent) since two of the three consumers are gates.
function readGroup(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(root), 'utf-8'));
    return { group: (parsed && parsed.decisionLog) || {}, warning: null };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { group: {}, warning: null };
    return {
      group: {},
      warning:
        '.foreman/config.json exists but could not be read as JSON — every decisionLog ' +
        'setting fell back to its default for this read.',
    };
  }
}

/**
 * Resolve decision-log settings for `root` through env override ->
 * .foreman/config.json's `decisionLog` group -> DECISION_LOG_DEFAULTS.
 * Never throws, never touches the filesystem beyond one read.
 */
function readDecisionLog(root) {
  const { group, warning: corruptWarning } = readGroup(root);
  const warnings = corruptWarning ? [corruptWarning] : [];

  let enabled = DECISION_LOG_DEFAULTS.enabled;
  if (typeof group.enabled === 'boolean') enabled = group.enabled;

  let dir = DECISION_LOG_DEFAULTS.dir;
  if (group.dir !== undefined) {
    if (isValidDir(group.dir)) {
      dir = group.dir;
    } else {
      warnings.push(
        `decisionLog.dir: ${JSON.stringify(group.dir)} is not a relative path without ".." ` +
          `segments — defaulted to "${DECISION_LOG_DEFAULTS.dir}"`
      );
    }
  }

  let gate = DECISION_LOG_DEFAULTS.gate;
  if (group.gate !== undefined) {
    if (typeof group.gate === 'string' && VALID_GATES.has(group.gate)) {
      gate = group.gate;
    } else {
      warnings.push(
        `decisionLog.gate: ${JSON.stringify(group.gate)} is not one of ${[...VALID_GATES].join(', ')} ` +
          `— defaulted to "${DECISION_LOG_DEFAULTS.gate}"`
      );
    }
  }

  // Env overrides apply after config. FOREMAN_DECISION_LOG only recognizes
  // the four listed tokens and otherwise leaves `enabled` untouched, per
  // spec — no warning for that case, unlike the dir override below.
  const envEnabled = process.env.FOREMAN_DECISION_LOG;
  if (envEnabled === '1' || envEnabled === 'true') enabled = true;
  else if (envEnabled === '0' || envEnabled === 'false') enabled = false;

  const envDir = process.env.FOREMAN_DECISION_LOG_DIR;
  if (envDir !== undefined && envDir !== '') {
    if (isValidDir(envDir)) {
      dir = envDir;
    } else {
      warnings.push(
        `FOREMAN_DECISION_LOG_DIR: ${JSON.stringify(envDir)} is not a relative path without ".." ` +
          'segments — ignored'
      );
    }
  }

  return { enabled, dir, gate, warning: warnings.length ? warnings.join(' ') : null };
}

module.exports = { readDecisionLog, DECISION_LOG_DEFAULTS, VALID_GATES };
