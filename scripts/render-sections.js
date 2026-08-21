#!/usr/bin/env node
"use strict";

// [Foreman: 062] Standalone CLI contract: this file is plain Node and must
// stay runnable with no harness present. CLAUDE_PROJECT_DIR is optional and
// falls back to cwd; no other harness dependency is permitted here. Pinned by
// tests/standalone.test.js, which spawns it with every CLAUDE_* variable
// deleted.

const fs = require("fs");
const path = require("path");
const { readLedger } = require("./ledger-config");
const { configPath, readConfigFile } = require("./foreman-config");

function projectDir() {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

// Declaration, not detection: the project states whether crafted prompts
// open task_context with a "You are a [role]" persona sentence (true,
// default) or domain framing ("Domain: [specialization]", false — the right
// choice when a style plugin already establishes a persona in
// the destination session). Foreman no longer sniffs other plugins' flag
// files; any present or future style plugin is compatible by construction.
function readUsePersona(config) {
  return config?.usePersona !== false;
}

// Fail-soft, same spirit as post-commit.js's readConfig: a missing or
// corrupt config.json never blocks prompt assembly, it just means no
// omissions this time. Fail-soft is not fail-silent
// though: a file that exists but won't parse loses every setting to its
// default — including usePersona, which reverts to true, so a persona
// opener would pass the gate in a usePersona:false project (check-prompt.js
// imports this same render()). A missing file is the uninitialized case and
// stays silent by construction.
// razor: this is the only reader with a user-visible warning channel. The
// two hook-side readers (hooks/post-commit.js, hooks/task-completed.js)
// keep swallowing their own parse errors because SessionStart/PostToolUse
// have nowhere to surface one — which is why this warning names them.
function readConfig(root) {
  const { config, error } = readConfigFile(root);
  if (!error) return { config, warning: null };
  return {
    config,
    warning:
      '.foreman/config.json exists but could not be read as JSON — every setting fell back to its ' +
      "default for this prompt, including the ones foreman's hooks read. Fix the file and re-run.",
  };
}

// Declaration, not detection: the project states whether it can run
// Fable 5 at all (Max plan or API — other plans can't). Hand-edited in
// .foreman/config.json; init does not ask. Default false. Gates
// whether `Fable` appears as a selectable option in craft-prompt/
// foreman:roadmap's executing-model question — see prompt-template.md's
// fableEnabled bullet.
function readFableEnabled(config) {
  const value = config?.fableEnabled;
  if (value === undefined) return { value: false, warning: null };
  if (typeof value === "boolean") return { value, warning: null };
  return {
    value: false,
    warning: `fableEnabled: ${JSON.stringify(value)} is not a boolean — defaulted to false`,
  };
}

// [Foreman: 185] Same polarity as post-commit's reader: default ON, and
// anything unparseable falls to true — the safe reading holds finished work
// for acceptance rather than skipping it. Craft time bakes this into the
// closing paragraph, which is what makes the primary close path honor it.
function readRequireVerification(config) {
  const value = config?.requireVerification;
  if (value === undefined) return { value: true, warning: null };
  if (typeof value === "boolean") return { value, warning: null };
  return {
    value: true,
    warning: `requireVerification: ${JSON.stringify(value)} is not a boolean — defaulted to true`,
  };
}

// Delegates the ledger settings chain (env override ->
// .foreman/config.json's `ledger` group, or the `areaNotes`/`decisionLog`
// keys it replaced -> defaults) to the module that owns it for every
// consumer, instead of restating the parse here. Its `warning` rides the
// same user-visible channel as readConfig's corrupt warning; ledger-config
// reads the file itself, so a corrupt config yields one warning from each
// reader (both accurate — every setting AND every ledger setting fell to
// default).
function readLedgerSection(root) {
  const { enabled, dir, warning } = readLedger(root);
  return { enabled, dir, warning };
}

// Only these template tags are ever conditional in the first place — the
// rest (task_context, truth_grounding, scope_discipline, task_rules) are
// the guardrails/core structure omitSections can never touch.
const OMITTABLE_TAGS = new Set(["tone", "example", "background", "output_format"]);

// Validates omitSections — only the template's already-conditional tags
// can ever be listed; anything else (a guardrail, a typo, core structure)
// is rejected with a warning, never silently honored.
function renderOmit(raw) {
  const omit = [];
  const warnings = [];
  const seen = new Set();

  (Array.isArray(raw) ? raw : []).forEach((tag, i) => {
    if (typeof tag !== "string") {
      warnings.push(`omitSections[${i}]: must be a string — skipped`);
      return;
    }
    if (!OMITTABLE_TAGS.has(tag)) {
      warnings.push(
        `omitSections[${i}]: "${tag}" cannot be omitted — only ${[...OMITTABLE_TAGS].join(", ")} are — skipped`
      );
      return;
    }
    if (seen.has(tag)) {
      warnings.push(`omitSections[${i}]: "${tag}" duplicates an earlier entry — skipped`);
      return;
    }
    seen.add(tag);
    omit.push(tag);
  });

  return { omit, warnings };
}

function render(root) {
  const { config, warning: configWarning } = readConfig(root);
  const omitResult = renderOmit(config.omitSections);
  const fableEnabledResult = readFableEnabled(config);
  const requireVerificationResult = readRequireVerification(config);
  const ledger = readLedgerSection(root);
  return {
    usePersona: readUsePersona(config),
    omit: omitResult.omit,
    fableEnabled: fableEnabledResult.value,
    requireVerification: requireVerificationResult.value,
    ledger: { enabled: ledger.enabled, dir: ledger.dir },
    warnings: [
      ...(configWarning ? [configWarning] : []),
      ...omitResult.warnings,
      ...(fableEnabledResult.warning ? [fableEnabledResult.warning] : []),
      ...(requireVerificationResult.warning ? [requireVerificationResult.warning] : []),
      ...(ledger.warning ? [ledger.warning] : []),
    ],
  };
}

function main() {
  const result = render(projectDir());
  process.stdout.write(JSON.stringify({ ok: true, ...result }));
}

if (require.main === module) {
  main();
}

module.exports = {
  projectDir,
  configPath,
  readConfig,
  readUsePersona,
  readFableEnabled,
  readLedgerSection,
  renderOmit,
  render,
  OMITTABLE_TAGS,
};
