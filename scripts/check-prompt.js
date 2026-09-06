#!/usr/bin/env node
"use strict";

// Standalone Node CLI; project selection is shared by runtime.projectDir.

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
// [Foreman: 106]
const PLACEHOLDER_FRAGMENTS = [
  "[If step 0's",
  "[If the configuration",
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
  "[What to analyze",
  "[What to implement",
  "[One observable assertion",
  "[Hard limits",
  "[Style or pattern",
  "[exact command",
  "[pass/fail signal",
  "[Repeat the Run:/Expected: pair",
  "[OPTIONAL",
  "[BACKGROUND-AGENT DESTINATION",
  "[Before snippet",
  "[The immediate",
  "[Only if something downstream",
  "[WORKFLOW-STAGE FLAVOR",
];

// Warn on requests to expose internal reasoning; ask for outcomes, evidence,
// and concise decision rationale instead.
const REASONING_ECHO_RE =
  /\b(?:show|explain|reproduce|transcribe|echo)\b[^.\n]{0,60}\b(?:your|its)\s+(?:reasoning|thought process|chain of thought|internal thinking)\b|\bthink(?:ing)? out loud\b/i;

// Phrases that assume the crafting conversation's context — the handed-off
// session has none.
const ASSUMED_CONTEXT_RE =
  /\bas (we|you and i) discussed\b|\bas discussed (earlier|above)\b|\bper our conversation\b|\bfrom (our|the) (earlier|previous) (conversation|discussion)\b|\bas mentioned (earlier|above)\b/i;

const WORKFLOW_STAGE_SENTENCE =
  "Return only JSON matching the accompanying schema. Use tool-enforced structured output when available; otherwise validate the result against that schema before returning it.";

// Sentinel for the delegated subtask's scope and coordinator handback contract.
const AUTONOMY_SENTENCE = "You are operating autonomously.";

// [Foreman: 103]
// Two fixed guardrails that live outside <truth_grounding>, so the verbatim
// block comparison above can't cover them. The no-invention line sits after
// </background> deliberately — inside it, an omitted background would drop
// the rule. The fix ceiling bounds the verification block's retry loop.
const NO_INVENTION_SENTENCE =
  "that is a finding to report, not a gap to fill — never create it to make this prompt true.";
const FIX_CEILING_SENTENCE =
  "after two failed fix attempts, stop and report what is still failing instead of widening the change to make the check pass.";

// [Foreman: 138]
// The two handoff profiles. `reinforced` is today's full-strength shape, for
// stale/conflicting/risky/resumed/highly-constrained work; `standard` is the
// short handoff ordinary fresh work gets. The signals that choose between them
// are mechanical and live in prompt-template.md's "Handoff profiles" section —
// this checker never sees the roadmap, so it validates a shape, never a choice.
const PROFILES = new Set(["standard", "reinforced"]);

// Standard's one-line stand-in for the full <truth_grounding> block. It folds
// the no-invention rule in, so the short profile loses length, not the rule.
const CONCISE_TRUTH_SENTENCE =
  "Treat every claim in this prompt as a hypothesis to verify against the codebase before acting on it; if reality contradicts it, trust reality, say so in one line, and never create a file or symbol just to make this prompt true";

// [Foreman: 274] The trust invariant is the sentence above; the MISSING:
// carve-out that follows it is a clarification, not part of the rule. The gate
// requires the invariant and lets the clarification ride, so a prompt written
// before the carve-out existed still passes and only the wording foreman emits
// has to move.
const CONCISE_TRUTH_CARVE_OUT =
  " — unless `relevant_files` marks that path `MISSING:`, which says the plan named the file before it existed.";
const CONCISE_TRUTH_EMITTED = CONCISE_TRUTH_SENTENCE + CONCISE_TRUTH_CARVE_OUT;

// The trust invariant both profiles carry. In `reinforced` it rides inside the
// fixed closing paragraph (already compared verbatim); `standard` carries the
// sentence on its own. Never weakened for either profile.
const CLOSURE_EVIDENCE_SENTENCE =
  "Closure notes and findings describe only observed work and cite supporting files, commands, commits, or outcomes; never restate planned scope as evidence that it was executed.";

// Which profile a prompt was assembled at, read off the prompt itself so every
// prompt written before profiles existed still validates exactly as it did:
// the full guardrail blocks mean `reinforced`. An explicit --profile wins.
function detectProfile(prompt) {
  return extractBlock(prompt, "truth_grounding") !== null ||
    extractBlock(prompt, "scope_discipline") !== null
    ? "reinforced"
    : "standard";
}

// Retained export for callers inspecting historical artifacts; current Codex
// prompts use installed absolute paths and refresh them if an installation moves.
const PLUGIN_CACHE_PATH_RE =
  /plugins[\\/]cache[\\/][\w.@-]+[\\/][\w.@-]+[\\/]\d+\.\d+\.\d+[\w.-]*/;

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
  const codexRuntime = extractBlock(xml, "codex_runtime");
  const truthGrounding = extractBlock(xml, "truth_grounding");
  const scopeDiscipline = extractBlock(xml, "scope_discipline");
  // [Foreman: 104]
  const plan = extractBlock(xml, "plan");
  const closing = xml
    .split("\n")
    .find((line) => line.startsWith("Complete the requested outcome"));
  if (!codexRuntime || !truthGrounding || !scopeDiscipline || !plan || !closing) {
    throw new Error(`template at ${TEMPLATE_PATH} is missing a canonical block`);
  }
  return { xml, codexRuntime, truthGrounding, scopeDiscipline, plan, closing };
}

// Compare canonical wording. Resolved plugin commands are emitted separately.
function segmentsInOrder(canonical, actual) {
  const segments = [norm(canonical)];
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

// [Foreman: 075] A gate error is a repair instruction, not a complaint. Each
// carries the prose message, the single action that clears it, and - when a
// literal helps more than a sentence - the shape the fixed prompt should have.
// The whole failing JSON is meant to go back to the crafting session verbatim:
// `fix` is what it acts on, `example` is what it copies. `example` is always
// present so a consumer never has to test for the key; it is null when the
// message and the fix already say everything.
function problem(error, fix, example) {
  return { error, fix, example: example === undefined ? null : example };
}

function checkPrompt(prompt, opts) {
  const errors = [];
  const warnings = [];
  const canonical = readCanonical();
  const config = render(opts.root || projectDir());
  const omit = new Set(config.omit);
  // [Foreman: 138] Reinforced requires every fixed block; standard requires
  // only the short ones. A block that IS present is held to the template
  // either way — standard is a smaller floor, never a licence to reword.
  const profile = opts.profile || detectProfile(prompt);
  const reinforced = profile !== "standard";

  // --- guardrail blocks, verbatim ---
  const runtime = extractBlock(prompt, "codex_runtime");
  if (!runtime) {
    // Older saved artifacts can still be inspected; the assembler always
    // supplies this block for newly crafted handoffs.
    warnings.push("legacy handoff has no <codex_runtime> contract — re-craft it to inherit the current Codex mode, instructions, and tools explicitly");
  } else if (norm(runtime) !== norm(canonical.codexRuntime)) {
    errors.push(problem("<codex_runtime> differs from the template", "Restore the current Codex runtime contract from prompt-template.md.", null));
  }
  const truth = extractBlock(prompt, "truth_grounding");
  if (!truth) {
    if (reinforced) errors.push(problem("missing <truth_grounding> — every reinforced handoff carries it, unmodified", "Copy prompt-template.md's <truth_grounding> block in unchanged.", null));
    else if (!norm(prompt).includes(norm(CONCISE_TRUTH_SENTENCE))) {
      errors.push(problem("standard handoff is missing the concise truth-grounding line (\"Treat every claim in this prompt as a hypothesis…\") — the short profile drops the block, never the rule", "Add the concise truth-grounding sentence as its own line - the short profile drops the block, never the rule.", CONCISE_TRUTH_EMITTED));
    }
  } else if (norm(truth) !== norm(canonical.truthGrounding)) {
    errors.push(problem("<truth_grounding> differs from the template — it must be carried verbatim", "Restore prompt-template.md's <truth_grounding> byte for byte; no rewording is allowed.", null));
  }
  const scope = extractBlock(prompt, "scope_discipline");
  if (!scope) {
    if (reinforced) errors.push(problem("missing <scope_discipline> — every reinforced handoff carries it, unmodified", "Copy prompt-template.md's <scope_discipline> block in unchanged.", null));
  } else if (!segmentsInOrder(canonical.scopeDiscipline, scope)) {
    errors.push(problem("<scope_discipline> differs from the template — it must be carried verbatim", "Restore prompt-template.md's <scope_discipline> without rewording.", null));
  }
  if (reinforced && !segmentsInOrder(canonical.closing, prompt)) {
    errors.push(problem("the fixed closing paragraph (\"Complete the requested outcome…\") is missing or altered", "Append the template's fixed closing paragraph, unaltered, as the last thing in the prompt.", null));
  }
  // [Foreman: 138] The one guardrail neither profile may drop.
  if (!norm(prompt).includes(norm(CLOSURE_EVIDENCE_SENTENCE))) {
    errors.push(problem("missing the closure-evidence rule (\"Closure notes and findings describe only observed work…\") — required in both handoff profiles", "Add the closure-evidence sentence; both profiles require it.", CLOSURE_EVIDENCE_SENTENCE));
  }
  // [Foreman: 104]
  const plan = extractBlock(prompt, "plan");
  if (!plan) {
    if (reinforced) errors.push(problem("missing <plan> — every reinforced handoff carries it, unmodified", "Copy prompt-template.md's <plan> block in unchanged.", null));
  } else if (norm(plan) !== norm(canonical.plan)) {
    errors.push(problem("<plan> differs from the template — it must be carried verbatim", "Restore prompt-template.md's <plan> verbatim.", null));
  }
  // [Foreman: 107]
  const unresolvedRoot = prompt.match(/\$\{(?:CLAUDE|CODEX)_PLUGIN_ROOT\}/);
  if (unresolvedRoot) {
    errors.push(problem("unresolved plugin root in the prompt body — Codex does not expand this placeholder", "Replace the placeholder with the installed plugin path resolved by craft-handoff.js; refresh it if the installation moves.", null));
  }
  // [Foreman: 103]
  if (reinforced && !norm(prompt).includes(norm(NO_INVENTION_SENTENCE))) {
    errors.push(problem("missing the no-invention line (\"a finding to report, not a gap to fill\") — it belongs outside <background>, so an omitted background can't drop it", "Add the no-invention line outside <background>, so omitting background cannot drop it.", `If a file, symbol, or fallback path this prompt names does not exist as described, ${NO_INVENTION_SENTENCE}`));
  }

  // --- task_context ---
  const taskContext = extractBlock(prompt, "task_context");
  // [Foreman: 291] The persona rule is about the block's OPENER — the one
  // sentence that either names a persona or frames a domain. The lines under
  // it carry the goal and, since 291, the entry's own why word for word, and a
  // why that quotes a support ticket saying "you are a slow app" is not a
  // persona. Testing the whole block turned that entry into a gate failure the
  // crafter could not fix without rewriting the roadmap.
  const opener = taskContext ? taskContext.split("\n").map((line) => line.trim()).find(Boolean) || "" : "";
  if (!taskContext || !norm(taskContext)) {
    errors.push(problem("missing or empty <task_context>", "Open the prompt with <task_context> naming who the destination is and what done looks like.", "<task_context>\nYou are a senior engineer.\nYour goal is to fix the retry bug so all tests pass.\n</task_context>"));
  } else if (config.usePersona === false && /\byou are an?\b/i.test(opener)) {
    errors.push(problem("task_context opens a persona (\"You are a…\") but the project declares usePersona:false — use domain framing", "Replace the persona opener with domain framing; the project set usePersona:false.", "<task_context>\nDomain: payments reconciliation.\nYour goal is to fix the retry bug so all tests pass.\n</task_context>"));
  } else if (config.usePersona !== false && !/\byou are\b/i.test(opener)) {
    warnings.push("task_context has no \"You are [role]\" sentence — expected with usePersona:true");
  }

  // --- unfilled placeholders ---
  for (const frag of PLACEHOLDER_FRAGMENTS) {
    if (prompt.includes(frag)) {
      errors.push(problem(`template placeholder left in the prompt: "${frag}…"`, "Fill the bracketed placeholder with the real value, or delete the line when the section does not apply.", null));
    }
  }

  // --- task_rules + verification ---
  const taskRules = extractBlock(prompt, "task_rules");
  if (!taskRules || !norm(taskRules)) {
    errors.push(problem("missing or empty <task_rules>", "Add <task_rules> carrying the steps, the constraints, and the verification block.", null));
  } else if (!opts.research) {
    const hasVerification =
      /Verification \(REQUIRED\):/.test(taskRules) &&
      /\bRun:/.test(taskRules) &&
      /\bExpected:/.test(taskRules);
    if (!hasVerification) {
      errors.push(problem("task_rules has no verification block (Run:/Expected:) — required unless the task is pure research (--research)", "Add a Verification (REQUIRED) block with a Run: line and an Expected: line, or pass --research when the task produces nothing runnable.", "Verification (REQUIRED):\nRun: npm test\nExpected: all tests pass"));
    }
    // [Foreman: 103, 231] The ceiling belongs to the verification block, not
    // to a profile: it bounds the retry loop the Run:/Expected: pairs open, and
    // both profiles carry those pairs. craft-handoff.js has always emitted it
    // on both, so this binds what already ships.
    if (!norm(taskRules).includes(norm(FIX_CEILING_SENTENCE))) {
      errors.push(problem("the verification block's fix loop is unbounded — it must end with the fixed ceiling (\"after two failed fix attempts, stop and report…\"), not \"iterate until it passes\"", "Close the verification block with the template's fixed ceiling instead of an open-ended retry instruction.", `Do NOT claim success without running this. If it fails, fix and re-run - but ${FIX_CEILING_SENTENCE}`));
    }
  }

  // --- background / relevant_files ---
  const backgroundOmitted = omit.has("background");
  const relevantFiles = extractBlock(prompt, "relevant_files");
  if (backgroundOmitted) {
    if (extractBlock(prompt, "background") !== null) {
      errors.push(problem("<background> present but the project omits it (omitSections)", "Delete <background>; this project's omitSections excludes it.", null));
    }
  } else if (!relevantFiles || !norm(relevantFiles)) {
    errors.push(problem("missing or empty <relevant_files>", "List the files the task touches inside <relevant_files>, one per line, with the symbols that matter.", "<relevant_files>\nsrc/auth/middleware.ts - refreshToken (42), verifySession (77)\n</relevant_files>"));
  } else if (!/[\w-]+[\\/.][\w./\\-]+/.test(relevantFiles)) {
    warnings.push("relevant_files has no path-like reference — vague references defeat truth_grounding's \"read the cited files\"");
  }
  // [Foreman: 259] The marker in the assembled prompt is the enforceable form
  // of a path problem: resolve-symbols.js flags it, craft-handoff.js prints it,
  // and this is where it costs something.
  // [Foreman: 271] The two markers are not the same kind of problem, so they no
  // longer carry the same verdict. A path outside the project root was never
  // read and can never be the file this task writes, so it stays an error. A
  // path that is simply not on disk is ambiguous by construction: planned_touches
  // is a PLAN, and a task that adds a file names that file before it exists.
  // Nothing in the path, the prose or the entry separates the two, so refusing
  // the prompt refused every create-a-file task — foreman's own schema example
  // among them. It is a warning now, and the marker in the prompt states both
  // branches so the destination is not misled either way.
  if (!backgroundOmitted && relevantFiles) {
    if (relevantFiles.includes("OUTSIDE PROJECT:")) {
      errors.push(problem(
        "relevant_files still carries an OUTSIDE PROJECT: line — the path resolves outside the project root, so it was never read and cannot be the file this task writes",
        "Correct the entry's planned_touches to a path inside the project, or drop it, then re-craft.",
        null
      ));
    }
    if (relevantFiles.includes("MISSING:")) {
      warnings.push(
        "relevant_files carries a MISSING: line — expected if this task creates that file, a stale planned_touches entry if it does not"
      );
    }
  }

  // [Foreman: 105] Deliberately no symbol-less warning here. The template asks
  // for symbols, but foreman:roadmap seeds this block from an entry's `planned_touches`,
  // which is area-level and often a bare directory, and that branch is forbidden
  // from exploring the codebase to upgrade it. A warning would therefore fire on
  // every roadmap handoff for a condition the crafter is not allowed to fix.

  // --- tone (destination-scoped) ---
  const toneBlock = extractBlock(prompt, "tone");
  if (opts.workflowStage) {
    if (toneBlock !== null) errors.push(problem("<tone> present in a Workflow-stage prompt — the flavor drops it unconditionally", "Delete <tone>; the Workflow-stage flavor drops it unconditionally.", null));
  } else if (omit.has("tone") && opts.destination !== "agent") {
    if (toneBlock !== null) errors.push(problem("<tone> present but the project omits it (omitSections) and the destination is not a delegated subagent", "Delete <tone>; the project omits it and this destination already has a voice.", null));
  } else if (toneBlock === null && reinforced) {
    errors.push(problem(
      opts.destination === "agent" && omit.has("tone")
        ? "<tone> missing — an omitted tone STAYS for a delegated-subagent destination (the coordinator needs a reporting contract)"
        : "missing <tone> — include the template default (or the user's custom tone)",
      opts.destination === "agent" && omit.has("tone")
        ? "Add <tone> anyway — an omitted tone still ships to a delegated subagent, because the coordinator needs a reporting contract."
        : "Add <tone> with the template default, or the tone the user asked for.",
      "<tone>\nBe concise and direct. Report useful progress and the final outcome; follow the user's communication instructions.\n</tone>"
    ));
  }

  // --- other omitted tags ---
  for (const tag of ["example", "output_format"]) {
    if (omit.has(tag) && extractBlock(prompt, tag) !== null) {
      errors.push(problem(`<${tag}> present but the project omits it (omitSections)`, "Delete the block; this project's omitSections excludes it.", null));
    }
  }

  // --- output_format ---
  if (opts.workflowStage) {
    if (extractBlock(prompt, "output_format") !== null) {
      errors.push(problem("<output_format> present in a Workflow-stage prompt — the flavor replaces it with the fixed enforcement sentence", "Delete <output_format>; the Workflow-stage flavor replaces it with the fixed enforcement sentence.", null));
    }
    if (!prompt.includes(WORKFLOW_STAGE_SENTENCE)) {
      errors.push(problem("Workflow-stage prompt is missing its fixed enforcement sentence", "Add the Workflow-stage enforcement sentence where <output_format> would go.", WORKFLOW_STAGE_SENTENCE));
    }
  } else if (reinforced && !omit.has("output_format") && extractBlock(prompt, "output_format") === null) {
    errors.push(problem("missing <output_format> — include the template default unless the project omits it", "Add <output_format> with the template default unless the project omits it.", "<output_format>\nGive a concise, human-readable summary: what changed, and the verification result. No XML tags in the visible response.\n</output_format>"));
  }

  // --- roadmap-entry paragraph ---
  if (opts.entry) {
    const marker = `ROADMAP.jsonl entry \`${opts.entry}\``;
    if (!prompt.includes(marker)) {
      errors.push(problem(`missing the entry paragraph naming ${marker} — the destination session can't mark or close the entry without it`, "Add the entry paragraph naming the roadmap id, so the destination can open and close the entry itself.", null));
    } else if (opts.resume) {
      if (!/already marked `in_progress`/.test(prompt)) {
        errors.push(problem("resume handoff must say the entry is already marked `in_progress` (resume variant paragraph)", "Use the resume wording: state that the entry is already marked `in_progress`.", null));
      }
    } else if (!/Mark it `in_progress`/.test(prompt)) {
      errors.push(problem("entry paragraph must instruct the destination to mark the entry `in_progress` first", "Tell the destination to mark the entry `in_progress` before it starts.", null));
    }
    if (!prompt.includes("update-status")) {
      errors.push(problem("entry paragraph must carry the roadmap.js update-status command for opening and closing the entry", "Include the roadmap.js update-status command the destination runs to open and close the entry.", null));
    }
  }

  // --- assumed context ---
  const assumed = prompt.match(ASSUMED_CONTEXT_RE);
  if (assumed) {
    warnings.push(`assumes the crafting conversation's context ("${assumed[0]}") — the handed-off session has none`);
  }

  // --- delegated-subagent autonomy reminder ---
  const hasAutonomy = prompt.includes(AUTONOMY_SENTENCE);
  if (opts.destination === "agent" && !hasAutonomy) {
    errors.push(problem('missing the autonomous-operation paragraph ("You are operating autonomously.") — a delegated subagent has no user to answer questions', "Add the autonomous-operation paragraph; a delegated subagent has nobody to ask.", AUTONOMY_SENTENCE));
  } else if (opts.destination !== "agent" && hasAutonomy) {
    warnings.push("carries the autonomous-operation paragraph but the destination has a user present — drop it for task/clipboard");
  }

  // --- reasoning-echo instructions ---
  const echo = prompt.match(REASONING_ECHO_RE);
  if (echo) {
    warnings.push(`asks the destination to echo its reasoning ("${echo[0]}") — ask for the outcome, evidence, and concise decision rationale instead`);
  }

  return { errors, warnings, configWarnings: config.warnings, profile };
}

const USAGE = `check-prompt.js -- mechanical gate for an assembled handoff prompt.
Prints one JSON line: {"ok":true,"warnings":[...]} or
{"ok":false,"errors":[...],"warnings":[...]} (exit 1).
Each error is {error, fix, example} -- the message, the one action that
clears it, and the shape to copy (null when the fix says everything).
Feed the failing JSON back to the crafting session verbatim; it is a repair
instruction, not a complaint.

  node check-prompt.js <prompt-file> --destination task|agent|clipboard
                       [--profile standard|reinforced]
                       [--entry <id> [--resume]] [--research] [--workflow-stage]

  --profile       which handoff profile the prompt was assembled at
                  (prompt-template.md's "Handoff profiles" section says which
                  signals choose it). Optional: without it the profile is read
                  off the prompt -- the full guardrail blocks mean reinforced.
                  Echoed back as "profile" in the result.
  --destination   required: where the prompt is going (task = Execute here
                  in this session, in any of its execution modes,
                  agent = delegated subagent, clipboard = copy).
                  Decides whether an omitted tone must stay (agent) or go.
  --entry <id>    the ROADMAP.jsonl entry this handoff opens/closes --
                  requires the embedded entry paragraph (roadmap picks).
  --resume        with --entry: expect the resume variant paragraph instead.
  --research      pure-investigation task: no verification block required.
  --workflow-stage  the Workflow-stage flavor: tone dropped, output_format
                  replaced by the fixed enforcement sentence.
`;

function parseArgs(argv) {
  const opts = { file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--destination") opts.destination = argv[++i];
    else if (a === "--profile") opts.profile = argv[++i];
    else if (a === "--entry") opts.entry = argv[++i];
    else if (a === "--resume") opts.resume = true;
    else if (a === "--research") opts.research = true;
    else if (a === "--workflow-stage") opts.workflowStage = true;
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
  if (opts.profile !== undefined && !PROFILES.has(opts.profile)) {
    throw new Error(`--profile must be one of ${[...PROFILES].join("|")}`);
  }
  const prompt = opts.file ? fs.readFileSync(opts.file, "utf-8") : fs.readFileSync(0, "utf-8");
  if (!prompt.trim()) throw new Error("empty prompt");
  const { errors, warnings, configWarnings, profile } = checkPrompt(prompt, opts);
  const allWarnings = [...warnings, ...configWarnings];
  if (errors.length) {
    process.stdout.write(JSON.stringify({ ok: false, profile, errors, warnings: allWarnings }));
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ ok: true, profile, warnings: allWarnings }));
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
  detectProfile,
  norm,
  PLACEHOLDER_FRAGMENTS,
  PROFILES,
  CONCISE_TRUTH_SENTENCE,
  CONCISE_TRUTH_EMITTED,
  CLOSURE_EVIDENCE_SENTENCE,
  WORKFLOW_STAGE_SENTENCE,
  NO_INVENTION_SENTENCE,
  FIX_CEILING_SENTENCE,
  PLUGIN_CACHE_PATH_RE,
  REASONING_ECHO_RE,
  TEMPLATE_PATH,
};
