#!/usr/bin/env node
"use strict";

// Standalone Node CLI; project selection is shared by runtime.projectDir.

const { readLedger } = require("./ledger-config");
const { configPath, readConfigFile } = require("./foreman-config");

const { projectDir } = require("./runtime");

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
  const requireVerificationResult = readRequireVerification(config);
  const ledger = readLedgerSection(root);
  return {
    usePersona: readUsePersona(config),
    omit: omitResult.omit,
    requireVerification: requireVerificationResult.value,
    ledger: { enabled: ledger.enabled, dir: ledger.dir },
    warnings: [
      ...(configWarning ? [configWarning] : []),
      ...omitResult.warnings,
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
  readLedgerSection,
  renderOmit,
  render,
  OMITTABLE_TAGS,
};
