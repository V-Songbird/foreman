# Codex handoff prompting

A handoff is the self-contained prompt Foreman gives the session that does the
work. Foreman builds every handoff from one template, `prompt-template.md`, on
both hosts. A few fixed blocks follow each vendor's own prompting guidance, so
the template holds a Claude Code variant and a Codex variant of each:
`truth_grounding`, `scope_discipline`, `tone`, the closing paragraph, `plan`
and the autonomy paragraph. Codex handoffs also carry two blocks of their own:
`codex_runtime` and a verification-scope line. This page explains the Codex
variants and the guidance behind them; the Claude Code variants cite their
sources at the top of the template.

Codex handoffs extend the recipient's active Codex instructions with a task
brief: goal, relevant evidence, explicit constraints, and completion criteria.
They retain Foreman's roadmap protocol and project settings. They do not install
an alternative system prompt or select a model.

## Basis checked on 2026-09-06

- [Codex best practices](https://learn.chatgpt.com/guides/best-practices): provide
  concrete task context and a checkable outcome; keep durable repository rules
  in `AGENTS.md`. Foreman carries paths, symbols, observed failures, purpose,
  invariants, and acceptance checks while preserving the recipient's repository
  guidance.
- [Codex prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide):
  preserve autonomy, useful code exploration, and appropriate tool use. This
  guide also contains API harness and model-version-specific instructions;
  Foreman uses the current host's contracts instead of embedding its historical
  starter prompt or tool names.
- [GPT-6 Astra prompting guidance](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md#prompting-best-practices):
  audit skill conflicts, honor existing authorization, calibrate testing, and
  delegate useful independent work. Checked against the instruction template
  shipped in the local Codex model catalog as well. The recipient still inherits
  its actual model, mode, permissions, and communication preferences; this
  reference does not pin Astra or its reasoning effort.
- [Reasoning best practices](https://developers.openai.com/api/docs/guides/reasoning-best-practices#how-to-prompt-reasoning-models-effectively):
  use clear instructions and delimiters, specific goals and constraints, and
  concise evidence rather than requests for private reasoning. XML separates
  the brief's sections; it is not required in the human-facing answer.

## How the adaptation behaves

Every newly generated Codex handoff carries a short `codex_runtime` contract.
It defers execution mechanics to the active host instructions, applicable
`AGENTS.md`, current collaboration mode, and available tools. User directions
take precedence over Foreman workflow defaults. A configured persona describes
task expertise while preserving the host's model identity and established voice.
`omitSections` cannot remove this block.

Investigation handoffs ask for findings, including when they have executable
checks. Decision handoffs ask for a supported choice. Neither gains an implicit
implementation instruction from the assembler's final request or reinforced
plan. From Foreman 3.1.0, Claude Code handoffs follow these two rules as well: a
handoff with a question asks for findings with evidence, carries no fix loop,
and neither its plan nor its roadmap close stages or commits anything; a
decision's failing checks never authorize implementation changes.

The remaining adaptations are Codex only. Implementation approaches are
suggestions unless a constraint or required ordering makes them mandatory. File
forecasts remain visible before work moves outside them; they do not create a
new permission question for work the user already authorized. Explicit file
restrictions still apply.

Verification includes the requested checks and checks justified by the actual
change. Passing checks are repeated only when new evidence warrants it. Native
planning and bounded parallel subagents remain available; the coordinator owns
shared roadmap and Git writes. A research command that fails is evidence to
report, not implicit permission to fix the subject under investigation.

## Foreman policies retained

Both handoff profiles, destination choices, source grounding, historical
evidence labels, `usePersona`, `omitSections`, acceptance holds, ledger options,
and checkpoint preferences remain. The two-failed-fix-attempt ceiling is
Foreman's deliberate bounded-retry policy on both hosts, not an OpenAI model
recommendation. It reports unresolved verification without inventing success or
expanding scope. Explicit user directions can override workflow defaults under
Codex's normal instruction hierarchy.

## Validation limits

Regression tests cover generated briefs across destinations and profiles,
investigations with and without executable checks, explicit requests, project
settings, and preservation of roadmap and config bytes during assembly. The
gate checks structure and required wording; it cannot prove factual grounding,
instruction following, or improved model performance. Missing runtime contracts
in older exported artifacts produce a re-craft warning. Changed canonical
blocks may also require re-crafting with the current installed version.

Two bounded native Codex subagent exercises also ran against disposable
CommonJS projects. The research recipient identified an intentionally failing
boundary test and returned a candidate fix without modifying files. The
implementation recipient changed only the authorized function and passed the
unchanged test. Both verified the live code when a symbol-extraction warning
was incomplete. The first research exercise exposed an inherited fix-loop
instruction; after removing it for investigations, a second run confirmed the
failure remained evidence and the project remained unchanged.

Official guidance and shipped host instructions evolve. Recheck this mapping
when changing the template or updating the supported host baseline. Passing
structural tests and bounded live exercises are not a broad performance benchmark.
