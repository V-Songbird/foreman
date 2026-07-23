#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { readDecisionLog } = require("./decision-log-config");

function projectDir() {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

function configPath(root) {
  return path.join(root, ".foreman", "config.json");
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
// custom sections/omissions this time. Fail-soft is not fail-silent
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
  try {
    return { config: JSON.parse(fs.readFileSync(configPath(root), "utf-8")) || {}, warning: null };
  } catch (err) {
    if (err && err.code === "ENOENT") return { config: {}, warning: null };
    return {
      config: {},
      warning:
        '.foreman/config.json exists but could not be read as JSON — every setting fell back to its ' +
        "default for this prompt, including the ones foreman's hooks read. Fix the file and re-run.",
    };
  }
}

const VALID_TARGET_MODELS = new Set(["haiku", "sonnet", "opus", "fable", "inherit"]);

// Declaration, not detection, same spirit as readUsePersona: the project
// states which model crafted prompts/handoffs should assume runs them.
// Default "inherit" (today's behavior, unchanged) applies whenever the
// field is missing, unparseable, or not one of the five valid strings —
// that last case also gets a warning instead of silently coercing.
function readTargetModel(config) {
  const value = config?.targetModel;
  if (value === undefined) return { value: "inherit", warning: null };
  if (typeof value === "string" && VALID_TARGET_MODELS.has(value)) {
    return { value, warning: null };
  }
  return {
    value: "inherit",
    warning: `targetModel: ${JSON.stringify(value)} is not one of ${[...VALID_TARGET_MODELS].join(", ")} — defaulted to "inherit"`,
  };
}

// Declaration, not detection, same spirit as readTargetModel: the project
// states whether the operator can run Fable 5 at all (Max plan or API —
// other plans can't). Default false. When true, the executing-model
// question may offer the Fable-orchestrator option on multi-check tasks —
// see prompt-template.md's fableEnabled bullet.
function readFableEnabled(config) {
  const value = config?.fableEnabled;
  if (value === undefined) return { value: false, warning: null };
  if (typeof value === "boolean") return { value, warning: null };
  return {
    value: false,
    warning: `fableEnabled: ${JSON.stringify(value)} is not a boolean — defaulted to false`,
  };
}

// Delegates the decision-log settings chain (env override ->
// .foreman/config.json's `decisionLog` group -> defaults) to the module
// that owns it for all three consumers, instead of restating the parse
// here. Only `enabled`/`dir` reach a crafted prompt — `gate` is a
// close-time concern hooks/task-completed.js reads, never a craft-time
// one, so it is dropped from this shape. Its `warning` rides the same
// user-visible channel as readConfig's corrupt warning; decision-log-config
// reads the file itself, so a corrupt config yields one warning from each
// reader (both accurate — every setting AND every decisionLog setting fell
// to default).
function readDecisionLogSection(root) {
  const { enabled, dir, warning } = readDecisionLog(root);
  return { enabled, dir, warning };
}

const TAG_RE = /^[a-z][a-z0-9_]*$/;

// Every tag the fixed template already owns — a custom section can never
// shadow a guardrail block like scope_discipline or truth_grounding.
const RESERVED_TAGS = new Set([
  "task_context",
  "truth_grounding",
  "scope_discipline",
  "tone",
  "background",
  "relevant_files",
  "context",
  "task_rules",
  "example",
  "output_format",
  "orchestration",
  "decision_log",
]);

// Only these template tags are ever conditional in the first place — the
// rest (task_context, truth_grounding, scope_discipline, task_rules) are
// the guardrails/core structure omitSections can never touch.
const OMITTABLE_TAGS = new Set(["tone", "example", "background", "output_format"]);

function escapeXml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Validates and renders customSections into inline XML. Never throws —
// each malformed entry is skipped with a warning instead of failing the
// whole prompt assembly.
function renderSections(raw) {
  const sections = [];
  const warnings = [];
  const seenTags = new Set();

  (Array.isArray(raw) ? raw : []).forEach((entry, i) => {
    const tag = entry?.tag;
    const content = entry?.content;
    if (typeof tag !== "string" || !TAG_RE.test(tag)) {
      warnings.push(`customSections[${i}]: tag ${JSON.stringify(tag)} must match ^[a-z][a-z0-9_]*$ — skipped`);
      return;
    }
    if (RESERVED_TAGS.has(tag)) {
      warnings.push(`customSections[${i}]: tag "${tag}" is reserved by the template — skipped`);
      return;
    }
    if (seenTags.has(tag)) {
      warnings.push(`customSections[${i}]: tag "${tag}" duplicates an earlier entry — skipped`);
      return;
    }
    if (typeof content !== "string" || !content.trim()) {
      warnings.push(`customSections[${i}] ("${tag}"): content must be a non-empty string — skipped`);
      return;
    }
    seenTags.add(tag);
    sections.push({ tag, xml: `<${tag}>\n${escapeXml(content.trim())}\n</${tag}>` });
  });

  return { sections, warnings };
}

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
  const sectionsResult = renderSections(config.customSections);
  const omitResult = renderOmit(config.omitSections);
  const targetModelResult = readTargetModel(config);
  const fableEnabledResult = readFableEnabled(config);
  const decisionLog = readDecisionLogSection(root);
  return {
    usePersona: readUsePersona(config),
    sections: sectionsResult.sections,
    omit: omitResult.omit,
    targetModel: targetModelResult.value,
    fableEnabled: fableEnabledResult.value,
    decisionLog: { enabled: decisionLog.enabled, dir: decisionLog.dir },
    warnings: [
      ...(configWarning ? [configWarning] : []),
      ...sectionsResult.warnings,
      ...omitResult.warnings,
      ...(targetModelResult.warning ? [targetModelResult.warning] : []),
      ...(fableEnabledResult.warning ? [fableEnabledResult.warning] : []),
      ...(decisionLog.warning ? [decisionLog.warning] : []),
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
  readTargetModel,
  readFableEnabled,
  readDecisionLogSection,
  escapeXml,
  renderSections,
  renderOmit,
  render,
  TAG_RE,
  RESERVED_TAGS,
  OMITTABLE_TAGS,
  VALID_TARGET_MODELS,
};
