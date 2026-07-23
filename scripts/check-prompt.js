#!/usr/bin/env node
"use strict";

// Mechanical gate for an assembled handoff prompt — the checklist items a
// script can actually verify, verified by a script instead of prose trust.
// Reads the canonical fixed blocks out of prompt-template.md at run time,
// so there is no second copy of them here to drift.

const fs = require("fs");
const path = require("path");
const { render, projectDir } = require("./render-sections.js");

const TEMPLATE_PATH = path.join(__dirname, "..", "prompt-template.md");

// Literal openings of every bracketed placeholder/instruction line in the
// template's XML fence. Any of these surviving into an assembled prompt
// means a placeholder was left unfilled or an instruction line was copied
// instead of acted on. tests pin this list against the template: every
// bracket-opening line there must be covered here.
const PLACEHOLDER_FRAGMENTS = [
  "[If step 0's",
  "[specific role",
  "[one sentence",
  "[One more sentence when the purpose is known",
  "[Pure-investigation handoff:",
  "[If Tone was selected",
  "[If `\"tone\"`",
  "[If `\"background\"`",
  "[If `\"output_format\"`",
  "[Exact file paths",
  "[Architectural decisions",
  "[Step 0's",
  "[What to read",
  "[What to analyze",
  "[What to implement",
  "[Hard limits",
  "[Style or pattern",
  "[exact command",
  "[pass/fail signal",
  "[Repeat the Run:/Expected: pair",
  "[CUSTOM SECTIONS",
  "[ORCHESTRATION",
  "[OPTIONAL",
  "[BACKGROUND-AGENT DESTINATION",
  "[Before snippet",
  "[The immediate",
  "[Only if something downstream",
  "[WORKFLOW-STAGE FLAVOR",
];

// Instructions asking the destination to echo its internal reasoning as
// response text — the official Fable prompting guide (template source-d)
// says these can trigger reasoning_extraction refusals on Fable-class
// models. Warning, not error: other targets tolerate them.
const REASONING_ECHO_RE =
  /\b(?:show|explain|reproduce|transcribe|echo)\b[^.\n]{0,60}\b(?:your|its)\s+(?:reasoning|thought process|chain of thought|internal thinking)\b|\bthink(?:ing)? out loud\b/i;

// Phrases that assume the crafting conversation's context — the handed-off
// session has none.
const ASSUMED_CONTEXT_RE =
  /\bas (we|you and i) discussed\b|\bas discussed (earlier|above)\b|\bper our conversation\b|\bfrom (our|the) (earlier|previous) (conversation|discussion)\b|\bas mentioned (earlier|above)\b/i;

const WORKFLOW_STAGE_SENTENCE =
  "Your return value is enforced by the attached schema; your final text is the return value, not a human-facing message.";

// Sentinel for the official autonomous-operation reminder a background-
// Agent destination must carry (the agent harness doesn't inject it).
const AUTONOMY_SENTENCE = "You are operating autonomously.";

function norm(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function extractBlock(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}

// Canonical fixed blocks, parsed out of the template's ```xml fence.
function readCanonical() {
  const raw = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  const fence = raw.match(/```xml\n([\s\S]*?)```/);
  if (!fence) throw new Error(`no \`\`\`xml fence found in ${TEMPLATE_PATH}`);
  const xml = fence[1];
  const truthGrounding = extractBlock(xml, "truth_grounding");
  const scopeDiscipline = extractBlock(xml, "scope_discipline");
  const orchestration = extractBlock(xml, "orchestration");
  const closing = xml
    .split("\n")
    .find((line) => line.startsWith("Reason through the approach"));
  if (!truthGrounding || !scopeDiscipline || !orchestration || !closing) {
    throw new Error(`template at ${TEMPLATE_PATH} is missing a canonical block`);
  }
  return { xml, truthGrounding, scopeDiscipline, orchestration, closing };
}

// scope_discipline embeds ${CLAUDE_PLUGIN_ROOT} paths the assembler
// substitutes — compare the literal segments around them, in order.
function segmentsInOrder(canonical, actual) {
  const segments = canonical.split("${CLAUDE_PLUGIN_ROOT}").map(norm).filter(Boolean);
  const hay = norm(actual);
  let from = 0;
  for (const seg of segments) {
    const at = hay.indexOf(seg, from);
    if (at === -1) return false;
    from = at + seg.length;
  }
  return true;
}

const DESTINATIONS = new Set(["task", "agent", "clipboard"]);

function checkPrompt(prompt, opts) {
  const errors = [];
  const warnings = [];
  const canonical = readCanonical();
  const config = render(opts.root || projectDir());
  const omit = new Set(config.omit);

  // --- guardrail blocks, verbatim ---
  const truth = extractBlock(prompt, "truth_grounding");
  if (!truth) errors.push("missing <truth_grounding> — every handoff carries it, unmodified");
  else if (norm(truth) !== norm(canonical.truthGrounding)) {
    errors.push("<truth_grounding> differs from the template — it must be carried verbatim");
  }
  const scope = extractBlock(prompt, "scope_discipline");
  if (!scope) errors.push("missing <scope_discipline> — every handoff carries it, unmodified");
  else if (!segmentsInOrder(canonical.scopeDiscipline, scope)) {
    errors.push("<scope_discipline> differs from the template — it must be carried verbatim (only the ${CLAUDE_PLUGIN_ROOT} paths are substituted)");
  }
  if (!segmentsInOrder(canonical.closing, prompt)) {
    errors.push("the fixed closing paragraph (\"Reason through the approach…\") is missing or altered");
  }

  // --- task_context ---
  const taskContext = extractBlock(prompt, "task_context");
  if (!taskContext || !norm(taskContext)) {
    errors.push("missing or empty <task_context>");
  } else if (config.usePersona === false && /\byou are an?\b/i.test(taskContext)) {
    errors.push("task_context opens a persona (\"You are a…\") but the project declares usePersona:false — use domain framing");
  } else if (config.usePersona !== false && !/\byou are\b/i.test(taskContext)) {
    warnings.push("task_context has no \"You are [role]\" sentence — expected with usePersona:true");
  }

  // --- unfilled placeholders ---
  for (const frag of PLACEHOLDER_FRAGMENTS) {
    if (prompt.includes(frag)) {
      errors.push(`template placeholder left in the prompt: "${frag}…"`);
    }
  }

  // --- task_rules + verification ---
  const taskRules = extractBlock(prompt, "task_rules");
  if (!taskRules || !norm(taskRules)) {
    errors.push("missing or empty <task_rules>");
  } else if (!opts.research) {
    const hasVerification =
      /Verification \(REQUIRED\):/.test(taskRules) &&
      /\bRun:/.test(taskRules) &&
      /\bExpected:/.test(taskRules);
    if (!hasVerification) {
      errors.push("task_rules has no verification block (Run:/Expected:) — required unless the task is pure research (--research)");
    }
  }

  // --- background / relevant_files ---
  const backgroundOmitted = omit.has("background");
  const relevantFiles = extractBlock(prompt, "relevant_files");
  if (backgroundOmitted) {
    if (extractBlock(prompt, "background") !== null) {
      errors.push("<background> present but the project omits it (omitSections)");
    }
  } else if (!relevantFiles || !norm(relevantFiles)) {
    errors.push("missing or empty <relevant_files>");
  } else if (!/[\w-]+[\\/.][\w./\\-]+/.test(relevantFiles)) {
    warnings.push("relevant_files has no path-like reference — vague references defeat truth_grounding's \"read the cited files\"");
  }

  // --- tone (destination-scoped) ---
  const toneBlock = extractBlock(prompt, "tone");
  if (opts.workflowStage) {
    if (toneBlock !== null) errors.push("<tone> present in a Workflow-stage prompt — the flavor drops it unconditionally");
  } else if (omit.has("tone") && opts.destination !== "agent") {
    if (toneBlock !== null) errors.push("<tone> present but the project omits it (omitSections) and the destination is not a background Agent");
  } else if (toneBlock === null) {
    errors.push(
      opts.destination === "agent" && omit.has("tone")
        ? "<tone> missing — an omitted tone STAYS for a background-Agent destination (no output style reaches that session)"
        : "missing <tone> — include the template default (or the user's custom tone)"
    );
  }

  // --- other omitted tags ---
  for (const tag of ["example", "output_format"]) {
    if (omit.has(tag) && extractBlock(prompt, tag) !== null) {
      errors.push(`<${tag}> present but the project omits it (omitSections)`);
    }
  }

  // --- output_format ---
  if (opts.workflowStage) {
    if (extractBlock(prompt, "output_format") !== null) {
      errors.push("<output_format> present in a Workflow-stage prompt — the flavor replaces it with the fixed enforcement sentence");
    }
    if (!prompt.includes(WORKFLOW_STAGE_SENTENCE)) {
      errors.push("Workflow-stage prompt is missing its fixed enforcement sentence");
    }
  } else if (!omit.has("output_format") && extractBlock(prompt, "output_format") === null) {
    errors.push("missing <output_format> — include the template default unless the project omits it");
  }

  // --- custom sections, inlined verbatim ---
  for (const section of config.sections) {
    if (!norm(prompt).includes(norm(section.xml))) {
      errors.push(`custom section <${section.tag}> from .foreman/config.json is missing or altered — inline it verbatim`);
    }
  }

  // --- roadmap-entry paragraph ---
  if (opts.entry) {
    const marker = `ROADMAP.jsonl entry \`${opts.entry}\``;
    if (!prompt.includes(marker)) {
      errors.push(`missing the entry paragraph naming ${marker} — the destination session can't mark or close the entry without it`);
    } else if (opts.resume) {
      if (!/already marked `in_progress`/.test(prompt)) {
        errors.push("resume handoff must say the entry is already marked `in_progress` (resume variant paragraph)");
      }
    } else if (!/Mark it `in_progress`/.test(prompt)) {
      errors.push("entry paragraph must instruct the destination to mark the entry `in_progress` first");
    }
    if (!prompt.includes("update-status")) {
      errors.push("entry paragraph must carry the roadmap.js update-status command for opening and closing the entry");
    }
  }

  // --- assumed context ---
  const assumed = prompt.match(ASSUMED_CONTEXT_RE);
  if (assumed) {
    warnings.push(`assumes the crafting conversation's context ("${assumed[0]}") — the handed-off session has none`);
  }

  // --- background-Agent autonomy reminder ---
  const hasAutonomy = prompt.includes(AUTONOMY_SENTENCE);
  if (opts.destination === "agent" && !hasAutonomy) {
    errors.push('missing the autonomous-operation paragraph ("You are operating autonomously.") — a background Agent has no user to answer questions');
  } else if (opts.destination !== "agent" && hasAutonomy) {
    warnings.push("carries the autonomous-operation paragraph but the destination has a user present — drop it for task/clipboard");
  }

  // --- orchestration block (Fable-orchestrator executing model) ---
  const orch = extractBlock(prompt, "orchestration");
  if (opts.orchestration) {
    if (!orch) {
      errors.push("missing <orchestration> — the Fable-orchestrator executing model carries it verbatim");
    } else if (norm(orch) !== norm(canonical.orchestration)) {
      errors.push("<orchestration> differs from the template — it must be carried verbatim");
    }
  } else if (orch !== null) {
    errors.push("<orchestration> present but the executing model is not the Fable-orchestrator option — drop it (or pass --orchestration)");
  }

  // --- reasoning-echo instructions ---
  const echo = prompt.match(REASONING_ECHO_RE);
  if (echo) {
    warnings.push(`asks the destination to echo its reasoning ("${echo[0]}") — this can trigger reasoning_extraction refusals on Fable-class models; ask for the outcome instead`);
  }

  return { errors, warnings, configWarnings: config.warnings };
}

const USAGE = `check-prompt.js -- mechanical gate for an assembled handoff prompt.
Prints one JSON line: {"ok":true,"warnings":[...]} or
{"ok":false,"errors":[...],"warnings":[...]} (exit 1).

  node check-prompt.js <prompt-file> --destination task|agent|clipboard
                       [--entry <id> [--resume]] [--research] [--workflow-stage]

  --destination   required: where the prompt is going (task = Execute here
                  in this session, in any of its execution modes,
                  agent = background Agent, clipboard = copy).
                  Decides whether an omitted tone must stay (agent) or go.
  --entry <id>    the ROADMAP.jsonl entry this handoff opens/closes --
                  requires the embedded entry paragraph (roadmap picks).
  --resume        with --entry: expect the resume variant paragraph instead.
  --research      pure-investigation task: no verification block required.
  --workflow-stage  the Workflow-stage flavor: tone dropped, output_format
                  replaced by the fixed enforcement sentence.
  --orchestration  the Fable-orchestrator executing model: the
                  <orchestration> block must ride verbatim (and is an
                  error without this flag).
`;

function parseArgs(argv) {
  const opts = { file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--destination") opts.destination = argv[++i];
    else if (a === "--entry") opts.entry = argv[++i];
    else if (a === "--resume") opts.resume = true;
    else if (a === "--research") opts.research = true;
    else if (a === "--workflow-stage") opts.workflowStage = true;
    else if (a === "--orchestration") opts.orchestration = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (!a.startsWith("--") && !opts.file) opts.file = a;
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (!opts.destination || !DESTINATIONS.has(opts.destination)) {
    throw new Error(`--destination is required and must be one of ${[...DESTINATIONS].join("|")}`);
  }
  if (opts.entry !== undefined && (!opts.entry || opts.entry.startsWith("--"))) {
    throw new Error("--entry requires an entry id");
  }
  const prompt = opts.file ? fs.readFileSync(opts.file, "utf-8") : fs.readFileSync(0, "utf-8");
  if (!prompt.trim()) throw new Error("empty prompt");
  const { errors, warnings, configWarnings } = checkPrompt(prompt, opts);
  const allWarnings = [...warnings, ...configWarnings];
  if (errors.length) {
    process.stdout.write(JSON.stringify({ ok: false, errors, warnings: allWarnings }));
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ ok: true, warnings: allWarnings }));
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
  checkPrompt,
  readCanonical,
  segmentsInOrder,
  norm,
  PLACEHOLDER_FRAGMENTS,
  WORKFLOW_STAGE_SENTENCE,
  REASONING_ECHO_RE,
  TEMPLATE_PATH,
};
