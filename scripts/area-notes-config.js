'use strict';

// Settings reader for the lesson ledger — the one-line durable facts a close
// can record about a code area, served back to a later task whose planned
// files intersect them. Same precedence chain decision-log-config.js owns for
// its feature: env override -> .foreman/config.json -> defaults, in one place
// so the writer (roadmap.js's close), the guard, the doctor and the handoff
// never drift apart on what "enabled" means.

const { readConfigFile } = require('./foreman-config');

// Off by default. Enabling it writes a file into the project and spends
// craft-time git calls resolving how stale each served record is, so a
// project opts in rather than inheriting the cost.
const AREA_NOTES_DEFAULTS = Object.freeze({ enabled: false });

/**
 * Resolve lesson-ledger settings for `root`.
 *
 * Fail-soft in the one safe direction: a missing or corrupt
 * `.foreman/config.json` reads as disabled, which is silence rather than a
 * half-written store. A corrupt file still reports its `warning`, because a
 * project that meant to opt in deserves to hear that it did not.
 */
function readAreaNotes(root) {
  const { config, error } = readConfigFile(root);
  const group = error ? {} : config.areaNotes || {};
  const warning = error
    ? '.foreman/config.json exists but could not be read as JSON — areaNotes fell back to disabled for this read.'
    : null;

  let enabled = AREA_NOTES_DEFAULTS.enabled;
  if (typeof group.enabled === 'boolean') enabled = group.enabled;

  // Env override applies after config, and only for the four listed tokens —
  // anything else leaves the resolved value alone. Tests set it; nothing in
  // the product writes it.
  const env = process.env.FOREMAN_AREA_NOTES;
  if (env === '1' || env === 'true') enabled = true;
  else if (env === '0' || env === 'false') enabled = false;

  return { enabled, warning };
}

module.exports = { readAreaNotes, AREA_NOTES_DEFAULTS };
