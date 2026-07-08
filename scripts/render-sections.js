#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

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
// custom sections/omissions this time.
function readConfig(root) {
  try {
    return JSON.parse(fs.readFileSync(configPath(root), "utf-8")) || {};
  } catch {
    return {};
  }
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
  const config = readConfig(root);
  const sectionsResult = renderSections(config.customSections);
  const omitResult = renderOmit(config.omitSections);
  return {
    usePersona: readUsePersona(config),
    sections: sectionsResult.sections,
    omit: omitResult.omit,
    warnings: [...sectionsResult.warnings, ...omitResult.warnings],
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
  escapeXml,
  renderSections,
  renderOmit,
  render,
  TAG_RE,
  RESERVED_TAGS,
  OMITTABLE_TAGS,
};
