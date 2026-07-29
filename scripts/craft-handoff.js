#!/usr/bin/env node
"use strict";

// Craft-time assembler: everything mechanical between "a roadmap entry (or
// entry-less judgment)" and "a gate-checked handoff prompt", in one call.
// Sibling to render-sections.js / resolve-symbols.js / check-prompt.js — it
// runs all three in-process (never as a child process) and adds nothing
// those three don't already know: it loads the entry, runs render-sections
// and resolve-symbols, computes the handoff profile from the five mechanical
// signals prompt-template.md defines, assembles the XML from the same
// canonical blocks check-prompt.js validates against, bakes the entry
// paragraph and the checkpoint/split delivery artifacts, and runs
// check-prompt.js's gate in-process as the last step.
//
// Both crafting flows route here now (wave2-design-2026-07-28.md, entries
// 3-4 of 6): skills/roadmap/pick.md calls it with an `entry` id, and
// skills/craft-prompt/SKILL.md calls it entry-less, with the same
// title/why/what/judgment fields given inline on stdin instead.
//
// stdin JSON in, one JSON line out: {ok, prompt, profile, signals, tasks?,
// gate, warnings} — same house style as every sibling script.
// `workflowStage: true` drops <tone>, replaces <output_format> with the
// fixed enforcement sentence, and is passed through to check-prompt.js's
// gate as --workflow-stage would be on the CLI (entry 204).

const fs = require("fs");
const { render, projectDir, readConfig } = require("./render-sections.js");
const { resolve: resolveSymbols } = require("./resolve-symbols.js");
const { readEntries, cmdList, touchesOverlap, today } = require("./roadmap.js");
const {
  checkPrompt,
  readCanonical,
  norm,
  CONCISE_TRUTH_SENTENCE,
  CLOSURE_EVIDENCE_SENTENCE,
  NO_INVENTION_SENTENCE,
  FIX_CEILING_SENTENCE,
  WORKFLOW_STAGE_SENTENCE,
} = require("./check-prompt.js");

const DESTINATIONS = new Set(["task", "agent", "clipboard"]);
const PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}"; // literal, never expanded — [Foreman: 107]
const AUTONOMY_MARKER = "You are operating autonomously.";

// ---- template-derived defaults, read out of prompt-template.md's own XML
// fence at run time (readCanonical's `xml`) so there is still exactly one
// copy of every guardrail/default text. Never hardcode these bodies.

function fullLineContaining(xml, needle) {
  const line = xml.split("\n").find((l) => l.includes(needle));
  if (!line) throw new Error(`prompt-template.md is missing an expected line containing: ${needle}`);
  return line.trim();
}

// Strips `[...]` instructional spans — iterated so a span containing its own
// inner `[...]` (e.g. relevant_files' "files[].symbols" mention) still fully
// clears, innermost pairs first — what's left is the block's literal
// default text.
function stripBracketed(text) {
  let out = String(text);
  let prev;
  do {
    prev = out;
    out = out.replace(/\[[^[\]]*\]/g, "");
  } while (out !== prev);
  return out;
}

// The template's own prose repeatedly *mentions* a tag name in backticks
// before the real tag shows up ("...the `<output_format>` block below..."
// inside the tone instruction; "...include the `<decision_log>` block
// below verbatim..." inside decision_log's own gating instruction) — a
// naive first-`<tag>`-to-next-`</tag>` regex (check-prompt.js's
// extractBlock, built for scanning an *assembled prompt*, never the
// template's own instructional prose) locks onto that inline mention and
// swallows everything up to the real closing tag. Real template tags are
// always alone on their own line, so anchor on that instead.
function extractTemplateBlock(xml, tag) {
  const re = new RegExp(`^<${tag}>\\n([\\s\\S]*?)^<\\/${tag}>$`, "m");
  const m = xml.match(re);
  return m ? m[1] : null;
}

function templateDefaults() {
  const canonical = readCanonical();
  const xml = canonical.xml;
  const toneInner = extractTemplateBlock(xml, "tone") || "";
  const toneQuote = toneInner.match(/"([\s\S]*)"/);
  const defaultTone = toneQuote
    ? norm(toneQuote[1])
    : "Minimal, professional conversation — silent by default, say only what the user actually needs to know.";
  const outputFormatInner = extractTemplateBlock(xml, "output_format") || "";
  const defaultOutputFormat = norm(stripBracketed(outputFormatInner));
  const decisionLogInner = extractTemplateBlock(xml, "decision_log");
  const noInventionLine = fullLineContaining(xml, NO_INVENTION_SENTENCE);
  const fixCeilingLine = fullLineContaining(xml, FIX_CEILING_SENTENCE);
  const autonomyAt = xml.indexOf(AUTONOMY_MARKER);
  const autonomyEnd = autonomyAt === -1 ? -1 : xml.indexOf("]", autonomyAt);
  const autonomyParagraph =
    autonomyAt === -1 || autonomyEnd === -1 ? null : norm(xml.slice(autonomyAt, autonomyEnd));
  return {
    canonical,
    defaultTone,
    defaultOutputFormat,
    decisionLogInner,
    noInventionLine,
    fixCeilingLine,
    autonomyParagraph,
  };
}

// ---- local-date helpers — never toISOString() date math

function parseLocalDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function daysSince(dateStr) {
  const then = parseLocalDate(dateStr);
  if (!then) return null;
  const now = parseLocalDate(today());
  return Math.round((now - then) / 86400000);
}

// ---- loading the record: an entry from ROADMAP.jsonl, or the entry-less
// fields given directly on stdin (craft-prompt's future mode).

function loadRecord(root, input) {
  if (input.entry) {
    const { entries } = cmdList(root, { ids: String(input.entry) });
    if (entries.length !== 1) {
      throw new Error(`entry "${input.entry}" not found in ROADMAP.jsonl`);
    }
    return { ...entries[0] };
  }
  return {
    id: null,
    title: input.title || "",
    why: input.why || "",
    what: input.what || "",
    notes: input.notes || "",
    planned_touches: input.planned_touches || input.touches || [],
    depends_on: input.depends_on || [],
    kind: input.kind,
    updated_at: input.updated_at,
    commits: input.commits || [],
    observed_touches: input.observed_touches || [],
    depends_on_docs: input.depends_on_docs || [],
  };
}

// ---- the five mechanical signals, prompt-template.md's "Handoff profiles"
// section, verbatim. Never a judgment call — every input here is a fact
// already in hand.

function computeSignals(root, record, input, symbolFiles, hasVerification) {
  const resumed = Boolean(input.resume) || (record.commits || []).length > 0 || (record.observed_touches || []).length > 0;

  // Conflicting — recomputed here, never trusted from the caller: any
  // OTHER in_progress entry's planned_touches, folder-aware, same rule
  // next-candidates uses. [Foreman: 125]
  const entries = readEntries(root);
  const inProgressTouches = [];
  for (const e of entries) {
    if (e.status !== "in_progress") continue;
    if (record.id && e.id === record.id) continue;
    for (const t of e.planned_touches || []) inProgressTouches.push(t);
  }
  const conflicting = (record.planned_touches || []).some((t) =>
    inProgressTouches.some((busy) => touchesOverlap(t, busy))
  );

  const ageDays = record.updated_at ? daysSince(record.updated_at) : null;
  const staleByAge = ageDays !== null && ageDays > 30;
  const staleByDrift = (symbolFiles || []).some(
    (f) => f.lastChanged && record.updated_at && f.lastChanged > record.updated_at
  );
  const stale = staleByAge || staleByDrift;

  const highlyConstrained = (record.depends_on || []).length >= 3 || (record.notes || "").length > 1000;

  const risky = record.kind === "decision" || !hasVerification;

  return { resumed, conflicting, stale, highlyConstrained, risky };
}

// ---- <relevant_files> — resolve-symbols.js's output, cited by symbol
// name, never a line range; missing/outside/unresolved paths ride along as
// stated discrepancies, exactly as skills/roadmap/SKILL.md's step 3 does.

function relevantFilesText(files, references, unresolved) {
  const lines = [];
  for (const f of files || []) {
    if (f.missing) {
      lines.push(`${f.path} — MISSING: this path no longer exists, a stale prediction to fix or drop`);
    } else if (f.outside_project) {
      lines.push(`${f.path} — OUTSIDE PROJECT: resolves outside the project root, not read`);
    } else if (f.directory || f.unsupported || f.unreadable) {
      lines.push(f.path);
    } else if (f.symbols && f.symbols.length) {
      lines.push(`${f.path} — ${f.symbols.map((s) => `${s.name} (${s.line})`).join(", ")}`);
    } else {
      lines.push(f.path);
    }
  }
  for (const ref of references || []) {
    if (ref.files && ref.files.length) {
      lines.push(`Pattern: ${ref.files[0]} — build the new code the same way`);
    }
  }
  if (unresolved && unresolved.length) {
    lines.push(`Unresolved in the entry's own description (not found in any touched file): ${unresolved.join(", ")} — an invented API or an un-caught rename, resolve before trusting it.`);
  }
  return lines.join("\n");
}

function contextText(judgmentContext, dependsOnDocs) {
  let text = judgmentContext || "";
  if (dependsOnDocs && dependsOnDocs.length) {
    text += `${text ? "\n" : ""}Decision docs to read first, so a settled question isn't re-decided: ${dependsOnDocs.join(", ")}`;
  }
  return text;
}

// ---- <task_context>

function taskContextText(usePersona, judgment) {
  const role = judgment.role || "a senior engineer";
  const opener = usePersona ? `You are ${role}.` : `Domain: ${role}.`;
  let goal = String(judgment.goal || "complete the task").trim();
  if (!/[.!?]$/.test(goal)) goal += ".";
  const purpose = judgment.purpose ? `\n${judgment.purpose}` : "";
  return `<task_context>\n${opener}\nYour goal is ${goal}${purpose}\n</task_context>`;
}

// ---- <task_rules> — steps/constraints/verification are judgment; the
// decision-entry bullet, the fix-ceiling line, and the checkpoint embed are
// mechanical additions this script bakes on top.

function taskRulesText(record, judgment, hasVerification, fixCeilingLine, checkpointEmbed) {
  const lines = [];
  if (record.kind === "decision") {
    lines.push(
      "This is a decision, not a build: resolve the open question — state the choice and the reason it wins over the alternatives — and do not write implementation code for it. The deliverable is the decision."
    );
  }
  for (const step of judgment.steps || []) lines.push(`- ${step}`);
  let body = lines.join("\n");

  const constraintLines = (judgment.constraints || []).map((c) => `- ${c}`);
  if (judgment.expectedFileSurface) {
    constraintLines.push(
      `Expected file surface: ${judgment.expectedFileSurface}. Anything beyond this list gets flagged to the user before it is written, not after.`
    );
  }
  if (constraintLines.length) {
    body += `${body ? "\n\n" : ""}Constraints:\n${constraintLines.join("\n")}`;
  }

  if (hasVerification) {
    let verifyBlock = "Verification (REQUIRED):\n";
    if (judgment.testFirst) {
      verifyBlock +=
        "Write the invariant test first, confirm it passes against the unmodified code, deliberately break the invariant and confirm the test goes red, then implement.\n";
    }
    for (const pair of judgment.verification) {
      verifyBlock += `Run: ${pair.run}\nExpected: ${pair.expected}\n`;
    }
    verifyBlock += fixCeilingLine;
    body += `${body ? "\n\n" : ""}${verifyBlock}`;
  } else if (judgment.question) {
    body += `${body ? "\n\n" : ""}Question: ${judgment.question}`;
  }

  if (checkpointEmbed) {
    body += `\n\n${checkpointEmbed}`;
  }

  return `<task_rules>\n${body}\n</task_rules>`;
}

// ---- checkpoints config (.foreman/config.json's `checkpoints` group) —
// same three keys, same defaults, as prompt-template.md's "Checkpointing a
// task-split run" section: branch true, onFinish "ask", baseBranch unset.
// No `push` key, and none should be added. [Foreman: 119]
const ON_FINISH_VALUES = new Set(["ask", "squash", "merge", "pr", "keep"]);

function checkpointsConfig(root) {
  const { config } = readConfig(root);
  const c = (config && config.checkpoints) || {};
  return {
    baseBranch: typeof c.baseBranch === "string" && c.baseBranch ? c.baseBranch : null,
    branch: c.branch !== false,
    onFinish: ON_FINISH_VALUES.has(c.onFinish) ? c.onFinish : "ask",
  };
}

// The clipboard checkpoint embed — resolved config values baked into a
// compact block appended to task_rules, per prompt-template.md's "Clipboard
// checkpoint embed" section. Only when the destination is clipboard and the
// prompt carries two or more Run:/Expected: pairs.
function checkpointEmbedText(cfg, checkCount) {
  const branchLine = cfg.baseBranch
    ? `the base branch is \`${cfg.baseBranch}\``
    : "detect the base branch with `git symbolic-ref --short refs/remotes/origin/HEAD` (name after `origin/`, fallback `main`)";
  const branchAction = cfg.branch
    ? "create `foreman/<slug>` only when starting on the base branch, otherwise checkpoint in place"
    : "checkpoint in place (branch creation is off)";
  const onFinishLine =
    cfg.onFinish === "ask"
      ? "ask the user squash/merge/PR/keep the branch"
      : `apply \`${cfg.onFinish}\` directly, no question`;
  return [
    "Checkpoint protocol for this multi-task run (the pasted session has no Foreman scripts to call, so this rides in the prompt itself):",
    `- create one tracked task per Run:/Expected: pair (${checkCount} total) and chain each to the previous one`,
    `- settle the branch first: ${branchLine}; with branch creation on, ${branchAction}`,
    "- before task 1, stop if `git status --porcelain` is non-empty: say so once and make no checkpoint commits at all for this run",
    "- after each task's check passes, stage only the files that task changed (`git add -- <those paths>`, never `git add -A`) and commit `task <n>/<total>: <task subject>`; leave it local, never push",
    `- after the last task (only if this run created the branch): ${onFinishLine}`,
    "- skip checkpointing and just work the tasks if git is unavailable",
  ].join("\n");
}

// ---- the entry paragraph — id substitution, requireVerification
// acceptance hold, decision-doc close field, executing model when given,
// ${CLAUDE_PLUGIN_ROOT} as the literal string. Mirrors
// skills/roadmap/SKILL.md's step-3 baked paragraph, collapsed to the one
// concrete variant that applies (the skill's prose shows several
// illustrative close-call shapes for a human reader; this bakes the single
// one this handoff actually needs).

function entryParagraphText({ id, resume, requireVerification, decisionLogEnabled, isDecision, destination, model }) {
  const opening = resume
    ? `This task is ROADMAP.jsonl entry \`${id}\`, already marked \`in_progress\` by an earlier session — don't re-mark it; earlier findings may sit in its \`notes\` (included above), read them before re-deriving anything.`
    : `This task is ROADMAP.jsonl entry \`${id}\`. Mark it \`in_progress\` before doing anything else — Foreman's picking flow deliberately leaves it \`planned\` until you do:\n\`echo '{"id":"${id}","status":"in_progress"}' | node ${PLUGIN_ROOT}/scripts/roadmap.js update-status\``;

  const beginStep = `Then take the commit boundary before touching any file:\n\`node ${PLUGIN_ROOT}/scripts/safe-commit.js begin\`\nKeep its \`baseline.head\`. A \`dirty:true\` result means the tree already carries someone else's changes: tell the user in one line, then do the work and make NO commit at all — leave everything in the tree for them. Never stage around it.`;

  const holdSentence = requireVerification
    ? ` When that earned status is \`done\`, write \`awaiting_acceptance\` instead — this project holds finished work for the user's acceptance, and their confirmation makes it \`done\`; \`dropped\` and \`rejected\` close as themselves.`
    : "";
  const closeIntro = `When the work concludes, close the entry the same way — the status it actually earned (\`done\`, \`dropped\`, \`rejected\`) and your full findings in \`notes\`.${holdSentence}`;

  const stageStep = `Stage the task's own files with the safe-commit primitive — never \`git add -A\`:\n\`echo '{"id":"${id}","expected":["<the files this task owns>"]}' | node ${PLUGIN_ROOT}/scripts/safe-commit.js finish --baseline <baseline.head> --no-commit\`\nThen close with \`staged:true\` (the script folds the staged files into \`observed_touches\` and stages ROADMAP.jsonl alongside), then commit once with \`Foreman: ${id}\` as the final line of the message.`;

  const fields = ['"status":"<status>"', '"staged":true', '"notes":"<findings>"'];
  if (decisionLogEnabled && isDecision) fields.push('"doc":"<path or none>"');
  if (destination === "agent" && model) fields.push(`"model":"${model}"`);
  const closeCall = `\`echo '{"id":"${id}",${fields.join(",")}}' | node ${PLUGIN_ROOT}/scripts/roadmap.js update-status\``;

  return [opening, beginStep, closeIntro, stageStep, closeCall].join("\n");
}

function decisionLogText(decisionLogInner, dir, entryId) {
  const substituted = decisionLogInner.split("<dir>").join(dir).split("<entry-id>").join(entryId);
  return `<decision_log>\n${substituted}\n</decision_log>`;
}

function slugify(text, maxLen = 40) {
  const slug = String(text || "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
  return slug || "task";
}

// ---- the task split — one row per Run:/Expected: pair, the full prompt on
// row 1, the entry paragraph on the last row only. [load-bearing placement]

function buildTaskRows(verification, basePrompt, entryParagraph, titleBase) {
  return verification.map((pair, i) => {
    const isFirst = i === 0;
    const isLast = i === verification.length - 1;
    const subject = (pair.subject || `${titleBase} — check ${i + 1}/${verification.length}`).slice(0, 60);
    let description;
    if (isFirst) {
      description = basePrompt;
    } else {
      const filesLine = pair.files && pair.files.length ? `Files: ${pair.files.join(", ")}\n` : "";
      description = `${pair.goal || subject}\n${filesLine}Run: ${pair.run}\nExpected: ${pair.expected}`;
    }
    if (isLast && entryParagraph) description += `\n\n${entryParagraph}`;
    return { subject, description };
  });
}

// ---- assembly

function assemble(root, input) {
  if (!input || typeof input !== "object") throw new Error("stdin must be a JSON object");
  const destination = input.destination;
  if (!destination || !DESTINATIONS.has(destination)) {
    throw new Error(`destination is required and must be one of ${[...DESTINATIONS].join("|")}`);
  }
  const judgment = input.judgment || {};
  const record = loadRecord(root, input);
  const isEntry = Boolean(record.id);
  // [Foreman: 204] Workflow-stage flavor: no <tone>, <output_format> replaced
  // by the fixed enforcement sentence, wired through to check-prompt.js's own
  // --workflow-stage-equivalent gate option below so a mismatch is caught
  // rather than silently assembled wrong.
  const workflowStage = Boolean(input.workflowStage);

  const hasVerification = Array.isArray(judgment.verification) && judgment.verification.length > 0;
  const verifyCmd = hasVerification ? judgment.verification[0].run : input.verify;
  const symbolResult = resolveSymbols(root, record.planned_touches, record.what, verifyCmd);

  const config = render(root);
  const signals = computeSignals(root, record, input, symbolResult.files, hasVerification);
  const reinforced = Object.values(signals).some(Boolean);
  const profile = reinforced ? "reinforced" : "standard";

  const { canonical, defaultTone, defaultOutputFormat, decisionLogInner, noInventionLine, fixCeilingLine, autonomyParagraph } =
    templateDefaults();

  const omit = new Set(config.omit);
  const isDecision = record.kind === "decision";
  const decisionLogEnabled = Boolean(config.decisionLog && config.decisionLog.enabled);

  const entryId = record.id;
  const decisionLogSlug = entryId || slugify(judgment.goal || record.title || input.title);

  const checkCount = hasVerification ? judgment.verification.length : 0;
  const wantsClipboardEmbed = destination === "clipboard" && checkCount >= 2;
  const checkpointEmbed = wantsClipboardEmbed
    ? checkpointEmbedText(checkpointsConfig(root), checkCount)
    : null;

  const entryParagraph = isEntry
    ? entryParagraphText({
        id: entryId,
        // The resume *variant* is about the delivery path (this pick came
        // from the finish-first in_progress array), never the `resumed`
        // mechanical signal — that also fires on plain non-empty
        // commits/observed_touches, which is not the same claim.
        resume: Boolean(input.resume),
        requireVerification: config.requireVerification,
        decisionLogEnabled,
        isDecision,
        destination,
        model: input.model,
      })
    : "";

  const taskContextBlock = taskContextText(config.usePersona, judgment);
  const backgroundInner = relevantFilesText(symbolResult.files, symbolResult.references, symbolResult.unresolved);
  const ctxText = contextText(judgment.context, record.depends_on_docs);
  const includeTone = !workflowStage && reinforced && (destination === "agent" || !omit.has("tone"));
  const includeBackground = !omit.has("background");
  const includeOutputFormat = !workflowStage && reinforced && !omit.has("output_format");
  const rulesBlock = taskRulesText(record, judgment, hasVerification, fixCeilingLine, checkpointEmbed);
  const customSectionsText = config.sections.map((s) => s.xml).join("\n\n");
  const requestSentence = input.request || `Implement: ${record.title || judgment.goal || "the task described above"}.`;
  const invariantsText =
    reinforced && judgment.invariants && judgment.invariants.length
      ? `<invariants>\n${judgment.invariants.join("\n")}\n</invariants>`
      : "";
  const exampleText =
    reinforced && !omit.has("example") && judgment.example
      ? `<example>\n${judgment.example.before} → ${judgment.example.after}\n</example>`
      : "";

  function buildParts(includeEntry) {
    const parts = [];
    parts.push(taskContextBlock);
    if (reinforced) {
      parts.push(`<truth_grounding>\n${canonical.truthGrounding}\n</truth_grounding>`);
      parts.push(`<scope_discipline>\n${canonical.scopeDiscipline}\n</scope_discipline>`);
    } else {
      parts.push(CONCISE_TRUTH_SENTENCE);
    }
    if (includeEntry && entryParagraph) parts.push(entryParagraph);
    if (reinforced && isDecision && decisionLogEnabled) {
      parts.push(decisionLogText(decisionLogInner, config.decisionLog.dir, decisionLogSlug));
    }
    if (includeTone) {
      parts.push(`<tone>\n${input.customTone || defaultTone}\n</tone>`);
    }
    if (includeBackground) {
      const ctxBlock = reinforced && ctxText ? `<context>\n${ctxText}\n</context>\n` : "";
      parts.push(`<background>\n<relevant_files>\n${backgroundInner}\n</relevant_files>\n${ctxBlock}</background>`);
    }
    if (reinforced) parts.push(noInventionLine);
    if (invariantsText) parts.push(invariantsText);
    parts.push(rulesBlock);
    if (customSectionsText) parts.push(customSectionsText);
    if (exampleText) parts.push(exampleText);
    parts.push(requestSentence);
    if (destination === "agent" && autonomyParagraph) parts.push(autonomyParagraph);
    if (reinforced) parts.push(canonical.closing);
    else parts.push(CLOSURE_EVIDENCE_SENTENCE);
    if (reinforced) parts.push(`<plan>\n${canonical.plan}\n</plan>`);
    if (workflowStage) parts.push(WORKFLOW_STAGE_SENTENCE);
    else if (includeOutputFormat) parts.push(`<output_format>\n${defaultOutputFormat}\n</output_format>`);
    return parts.filter(Boolean).join("\n\n") + "\n";
  }

  const basePrompt = buildParts(false);
  const prompt = buildParts(true);

  const gateOpts = {
    root,
    profile,
    destination,
    research: !hasVerification,
    ...(workflowStage ? { workflowStage: true } : {}),
    ...(isEntry ? { entry: entryId, resume: Boolean(input.resume) } : {}),
  };
  const gateResult = checkPrompt(prompt, gateOpts);
  const gate = { ok: gateResult.errors.length === 0, profile: gateResult.profile, errors: gateResult.errors, warnings: gateResult.warnings };

  let tasks;
  if (destination === "task" && input.split && checkCount >= 1) {
    const titleBase = record.title || input.title || "Task";
    tasks = buildTaskRows(judgment.verification, basePrompt, entryParagraph, titleBase);
  }

  const warnings = [...config.warnings, ...symbolResult.warnings, ...gateResult.warnings];

  return {
    ok: gate.ok,
    prompt,
    profile,
    signals,
    ...(tasks ? { tasks } : {}),
    gate,
    warnings,
  };
}

function readStdin() {
  const raw = fs.readFileSync(0, "utf-8").trim();
  return raw ? JSON.parse(raw) : {};
}

function main() {
  const input = readStdin();
  const result = assemble(projectDir(), input);
  process.stdout.write(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}

module.exports = {
  assemble,
  loadRecord,
  computeSignals,
  relevantFilesText,
  taskContextText,
  taskRulesText,
  entryParagraphText,
  checkpointsConfig,
  checkpointEmbedText,
  buildTaskRows,
  decisionLogText,
  slugify,
  templateDefaults,
  daysSince,
  parseLocalDate,
};
