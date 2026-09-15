'use strict';

// The one settings reader for the ledger — Foreman's single record of what a
// closed task learned about a code area. Five consumers need the same answer
// (the close in scripts/roadmap.js, the handoff in scripts/craft-handoff.js,
// the read-back in hooks/ledger-recall.js, scripts/render-sections.js and the
// doctor), so the precedence chain lives here once: env override ->
// .foreman/config.json -> defaults.
//
// `ledger` replaced two earlier keys, `areaNotes` and `decisionLog`. Both are
// still read, so a project that opted into either keeps working untouched;
// `ledger` wins wherever it is present. The old env overrides are honored for
// the same reason.

const path = require('path');
const { readConfigFile } = require('./foreman-config');

// Off by default. Enabling it writes a file into the project and spends
// craft-time git calls resolving how stale each served record is, so a
// project opts in rather than inheriting the cost.
//
// `dir` is read-only ground: where this project keeps decision documents, so
// an `[Foreman: <id>]` anchor can be resolved back to the doc it names.
// Foreman never writes there — what a project keeps in that directory, and in
// what shape, is the project's business.
const LEDGER_DEFAULTS = Object.freeze({ enabled: false, dir: 'docs/foreman' });

// Read in order, first hit wins, `ledger` always first.
const ENABLED_KEYS = Object.freeze(['ledger', 'areaNotes', 'decisionLog']);
const DIR_KEYS = Object.freeze(['ledger', 'decisionLog', 'areaNotes']);
const ENABLED_ENV = Object.freeze(['FOREMAN_LEDGER', 'FOREMAN_AREA_NOTES', 'FOREMAN_DECISION_LOG']);
const DIR_ENV = Object.freeze(['FOREMAN_LEDGER_DIR', 'FOREMAN_DECISION_LOG_DIR']);

// A relative path with no leading slash/backslash, no drive-letter root,
// and no ".." segment — the scope the caller trusts a dir to be read under.
// Trailing slashes and "./" segments are tolerated.
function isValidDir(value) {
  if (typeof value !== 'string' || value === '') return false;
  if (value.startsWith('/') || value.startsWith('\\')) return false;
  if (path.isAbsolute(value)) return false;
  return value.split(/[\\/]+/).filter(Boolean).every((seg) => seg !== '..');
}

// Fail-soft in the one safe direction: a missing or corrupt
// `.foreman/config.json` reads as disabled, which is silence rather than a
// half-written store. A corrupt file still reports its `warning`, because a
// project that meant to opt in deserves to hear that it did not.
function readGroups(root) {
  const { config, error } = readConfigFile(root);
  if (error) {
    return {
      config: {},
      warning:
        '.foreman/config.json exists but could not be read as JSON — every ledger '
        + 'setting fell back to its default for this read.',
    };
  }
  return { config, warning: null };
}

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== '') return { name, value };
  }
  return null;
}

/**
 * Resolve ledger settings for `root` through env override ->
 * .foreman/config.json -> LEDGER_DEFAULTS.
 * Never throws, never touches the filesystem beyond one read.
 */
function readLedger(root) {
  const { config, warning: corruptWarning } = readGroups(root);
  const warnings = corruptWarning ? [corruptWarning] : [];

  let enabled = LEDGER_DEFAULTS.enabled;
  for (const key of ENABLED_KEYS) {
    const group = config[key];
    if (group && typeof group.enabled === 'boolean') {
      enabled = group.enabled;
      break;
    }
  }

  let dir = LEDGER_DEFAULTS.dir;
  for (const key of DIR_KEYS) {
    const group = config[key];
    if (!group || group.dir === undefined) continue;
    if (isValidDir(group.dir)) {
      dir = group.dir;
    } else {
      warnings.push(
        `${key}.dir: ${JSON.stringify(group.dir)} is not a relative path without ".." `
          + `segments — defaulted to "${LEDGER_DEFAULTS.dir}"`
      );
    }
    break;
  }

  // Env overrides apply after config, and only for the four listed tokens —
  // anything else leaves the resolved value alone, with no warning. Tests set
  // these; nothing in the product writes them.
  const envEnabled = firstEnv(ENABLED_ENV);
  if (envEnabled) {
    if (envEnabled.value === '1' || envEnabled.value === 'true') enabled = true;
    else if (envEnabled.value === '0' || envEnabled.value === 'false') enabled = false;
  }

  const envDir = firstEnv(DIR_ENV);
  if (envDir) {
    if (isValidDir(envDir.value)) {
      dir = envDir.value;
    } else {
      warnings.push(
        `${envDir.name}: ${JSON.stringify(envDir.value)} is not a relative path without ".." `
          + 'segments — ignored'
      );
    }
  }

  return { enabled, dir, warning: warnings.length ? warnings.join(' ') : null };
}

module.exports = { readLedger, isValidDir, LEDGER_DEFAULTS };
