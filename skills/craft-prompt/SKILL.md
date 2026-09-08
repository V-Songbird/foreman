---
name: craft-prompt
description: Build or refine a self-contained Codex prompt for work without a Foreman roadmap entry. Use on an explicit prompt-crafting request; gathers missing intent, grounds paths and checks, and delivers through Foreman's selected execution or clipboard destination.
---

# Craft a standalone prompt

Read [the shared runtime](../foreman/runtime.md). This is Foreman's advanced
standalone prompt builder, separate from normal roadmap work. An ordinary
implementation request does not itself call for a prompt-crafting interview.

Preserve the requested task, gather what the next session needs to act without
this conversation, and use `scripts/craft-handoff.js` as the assembler and gate.
Write a task brief with a concrete goal, relevant context, actual constraints,
and observable completion evidence. Let the destination's active Codex
instructions govern execution; do not embed a replacement system prompt or
hand-write the assembler's canonical guardrail sections.

## Interview the missing intent

Reuse what the user already supplied. Ask related missing questions together
within the active question tool's limits; plain-text questions work when no
suitable tool is available.

First establish task type (feature, fix, investigation, refactor, or the user's
own description), optional sections, familiarity with this code, and output
consumer. Optional section preferences are the user's choice, not something a
repository scan can prove: offer tone, example, constraints, and background
unless the user already specified them. A request for a particular prompt shape
takes precedence over these defaults.

Starting-point choices change content, not template structure:

- Knows the code: use the stated scope.
- Knows the goal but not the code: state that file and step choices are a
  proposed scope, not an audit.
- New to the area: offer a bounded blind-spot pass before crafting. Its findings
  can inform the files and context. If declined, include a step to identify
  unknowns, relevant prior work, and pitfalls before proceeding conservatively.
  Ask for concise findings and evidence, not private reasoning.

## Ground the file options

Before asking the user to choose files, make one bounded read-only pass over
the project, using a collaboration worker only when useful independent work
can proceed alongside it. Return:

- Up to three candidate file/area lines with relevant symbols.
- The real project verification command, when one exists; otherwise the
  available human review of the requested result, without inventing a command.
- One existing implementation to use as a `Pattern:` reference when available.
- A way to drive or inspect the project unattended, if one exists.

That final command must run unattended, terminate on its own, and leave the
fixtures/artifact it checks unchanged. A dev server, interactive command, or
snapshot-regeneration command does not satisfy those conditions. No useful
candidate is a valid result. Treat every returned item as a proposal; the user's
choice or corrected path wins. Do not run a second broad interview pass merely
because the first found no obvious option.

Gather the remaining required fields: specialization, one observable done
state, relevant files or a bounded area, and useful approach notes or the investigation
question. A numeric goal includes its metric and threshold. Offer grounded file
choices and allow the user to combine or replace them. Do not invent an analysis
phase for an implement-only request.

Keep requirements separate from suggested implementation steps. Prescribe an
order only when a dependency, explicit user instruction, or verification method
requires it. A file forecast guides discovery; put an actual restriction on
which files may change in `judgment.constraints` only when one was supplied.
For an investigation or review, define the question and expected findings;
do not turn the assignment into implementing a fix.

For implementation, follow [prepare-increments.md](../roadmap/prepare-increments.md):
gather one row per meaningful result, combining actual commands and human review
when they concern the same work. Human-only verification does not change the
request into an investigation. Preserve explicit approval-between-results as
`reviewEachIncrement:true` with `review` on every row; do not enable it for an
ordinary split. A bug fix also carries observed failing output verbatim under
`Observed failure:` when available. Ask what must remain true; encode an
invariant as an observable assertion, not the name of a contract. No additional
invariant is a normal answer. Infer the expected file surface from chosen paths.
Use test-first ordering only for a silent-failure task whose current checks
would otherwise stay green.

Unknowns stay explicit. A missing observable done state needs clarification
before delivery. A file list can name the narrowest known directory and state
that it is an area hint; if even that is unknown, ask for the missing scope.
Other unknowns become an attributed open question to resolve from evidence.
Do not conceal missing facts by filling them with confident prose.

Gather details only for the chosen optional sections. A "none" answer drops
that section. User-supplied tone replaces the default; an example includes both
before and after. Background carries only decisions and context the destination
needs. Review tasks focus on consequential correctness/security findings;
finding the work sound is a valid outcome.

## Structured output, when a consumer requires it

Keep Foreman's prompt-plus-schema flavor for a real machine consumer.
Determine its fields, preferably from the user or the declared done state.
Use a small object schema with required fields, property descriptions, enums
for verdicts, and evidence pairs such as `{"cite":"file:line","note":"..."}`.

A schema artifact alone does not enforce output. Set `workflowStage:true` only
when the destination's actual API or runner will enforce the attached schema;
verify that runner's supported JSON Schema subset. Otherwise deliver the schema
as an explicit output contract without claiming native enforcement. Do not
assume another host's `agent(prompt, {schema})` API exists. The schema travels
beside the prompt and its fields are reviewable before delivery.

## Preflight, assemble, deliver

Resolve chosen paths with `scripts/resolve-symbols.js`, supplying the task
description and actual `run` commands only. Human review actions are not
commands and do not go to this resolver. Existing moved files require correction;
a planned new file stays marked missing. Outside-project paths are refused.
An unresolved symbol or non-runnable verification command requires correction,
not a guess. Record the facts and reuse them when assembling.

Read [skills/roadmap/destination-question.md](../roadmap/destination-question.md).
Ask its original four-way question before assembly unless the user already
chose a destination, and follow its answer-collection protocol before proceeding.
Do not ask which model should run the work.

Pass JSON stdin to `node "<plugin-root>/scripts/craft-handoff.js"` with no
`entry` key:

- `title`, `what`, `touches`, and one imperative `request` that preserves the
  task type, such as "Investigate the retry failure and report its cause."
- `destination:"task"|"agent"|"clipboard"`; `split:true` for ordered local rows,
  including an explicitly requested local run by increments.
- Top-level `reviewEachIncrement:true` only for the user's explicit request to
  approve each result; keep the chosen destination and require review on every row.
- `kind:"decision"` when the deliverable is a recorded choice.
- Optional `customTone` and genuinely enforced `workflowStage`.
- `judgment.role`, `goal`, `context`, `steps`/`question`, `constraints`,
  `verification` rows with `goal`, known `files`, and complete `run`/`expected`
  and/or `review.action`/`review.expected` pairs; optional `purpose`, `invariants`,
  `testFirst`, `example:{before,after}`, or `expectedFileSurface`.

Use the user's actual goal. `purpose` describes the output's audience or next
use only when known. Investigation uses `judgment.question`; omit implementation
steps and invented verification commands. Encode an explicitly read-only scope
in `judgment.constraints`. The builder resolves paths, chooses a standard or
reinforced profile, assembles canonical blocks, and runs the mechanical gate.
If an optional selection is omitted by the project configuration or profile,
say so. Do not expose internal profile scoring.

Evaluate returned warnings. An `ok:false` result needs its named field repaired
using `gate.errors`' fix/example, then a new call. A failed gate is never
delivered and the identical payload is not retried blindly. Ask the user only
when the missing field cannot be resolved from their intent or project evidence.

Read [delivery.md](../roadmap/delivery.md). Execute the returned prompt or
ordered `tasks[]`, dispatch through available collaboration, or save and copy
the prompt file as selected. Include the schema artifact when present.
Checkpoint behavior is the same as a roadmap handoff, except no roadmap entry
is opened or closed. Pure investigations use checks as evidence and omit
implementation checkpoints and test-mutation exercises. The next session needs the complete prompt; ordinary chat
shows the effect and artifact location rather than dumping XML.
