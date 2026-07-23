---
name: craft-prompt
description: Interactive prompt builder. Guides you through assembling a self-contained spawned-session prompt following Foreman's template — asks which optional sections to include, gathers required info via AskUserQuestion, assembles the XML, then runs it here as one or several tracked tasks, hands it to a background Agent, or copies it to the clipboard.
when_to_use: Trigger when the user wants to create a task, spawn a background agent, craft a prompt for a spawned session, or says "craft a prompt", "build a prompt", "foreman prompt", "new task prompt", or invokes /foreman:craft-prompt.
argument-hint: "<brief task description — optional seed>"
allowed-tools: AskUserQuestion, TaskCreate, TaskUpdate, Agent, Read, Write, Bash, PowerShell
---

# foreman:craft-prompt — interactive prompt builder

Assemble a self-contained prompt for a spawned session following Foreman's template. The spawned session has zero memory of this conversation — every field must be filled so it can act cold.

If args were provided, treat them as the task description seed and skip asking for it in Call 1.

---

## Call 1 — task type and optional sections

Ask these two questions together:

**Q1** — "What task should the spawned session perform?"
Options: `Implement a feature`, `Fix a bug`, `Investigate / research`, `Refactor code`, `Write documentation`, `Security audit`

**Q2** — "Which optional sections do you want in the prompt?" (multiSelect: true)
Options:
- `Tone` — override the default (minimal/professional, silent-by-default — see the template; projects opt out entirely via `omitSections: ["tone"]`)
- `Example` — a before/after or input→output snippet (good for fixes and transformations)
- `Constraints` — hard limits on files or interfaces the agent must NOT touch
- `Background context` — architectural decisions, patterns, or environment details
- `Custom output format` — wrap the deliverable in a specific XML tag for a downstream parser (skip this unless something actually parses the output — the default is a plain human-readable summary, no tags)
- `Workflow stage` — prompt plus a JSON Schema the tool layer enforces, for a Workflow `agent(prompt, {schema})` stage (mechanically omits `Tone` and replaces the default output format with a fixed enforcement sentence — see the template; pick this instead of `Custom output format`, not alongside it)

Record which optional sections were selected.

Q2 asks what the user *wants* in the prompt, not what's *true* about the code — no amount of upfront code investigation answers it, so don't skip it even when you've already grounded every fact the prompt will state. Investigation and section selection are orthogonal: being confident about the code is not the same as knowing which sections the user wants included.

---

## Call 2 — required fields (batch all 4)

**Q1** — "What role should the spawned agent play?"
Options: `Senior engineer`, `Security engineer`, `TypeScript developer`, `Python developer`, `Technical writer`, `Code reviewer`

**Q2** — "What does 'done' look like? One sentence. A performance or
coverage goal names the metric and threshold (e.g. 'p95 under 500ms')."
Options: `Bug is fixed and all tests pass`, `Feature is implemented and tested`, `Findings are written to a file in the repo, cited`, `Refactor complete — no behavior change`

**Q3** — "List the relevant files with line ranges where known. If an
analogous implementation exists, name it too as a pattern to imitate."
Options: `I'll list them` (nudge user to use Other and type paths like `src/auth/middleware.ts:42-80 — token refresh logic`, plus `Pattern: src/webhooks/github.ts — build the new code the same way` when one applies)

**Q4** — "Describe the three steps: read/explore, then analyze/check, then implement/produce."
Options: `I'll describe them`

---

## Call 3 — verification (conditional)

Skip this call only if the task type is pure research/investigation with no code changes.

**Q1** — "What command or commands verify success?"
Options: `npm test`, `npm run build`, `pytest`, `cargo test`, `go test ./...`

**Q2** — "What's the expected outcome?"
Options: `All tests pass`, `Build succeeds with exit code 0`, `No lint errors`, `Report file produced`

Several checks, named in the order they should run, are fine and normal —
each becomes its own `Run:`/`Expected:` pair in the prompt. They are also
what Call 5b's task split cuts on, so a task with three real checks is
worth listing all three here.

**Q3** — only when Call 1's task type was `Fix a bug`: "Paste the failing
output — stack trace, error message, or test failure — verbatim."
Options: `None observed`
The answer lands in `<context>` under an `Observed failure:` line, exactly
as pasted — the artifact, not a paraphrase (the spawned session can't ask
what the error actually said).

---

## Call 4-N — optional section details

For each section selected in Call 1 Q2, ask its detail question(s). Batch up to 4 questions per call.

**Tone** (if selected):
- "Describe the tone for this session."
  Options: `Cautious and defensive (security-focused)`, `Fast and pragmatic (prototype)`, `Pedagogical — explain each step`, `Formal technical report style`

**Example** (if selected):
- "Provide a before/after snippet or input → output example."
  Options: `I'll type it`

**Constraints** (if selected, batch together):
- "Which files or interfaces must NOT be modified?"
  Options: `I'll list them`
- "Is there a coding style or pattern to follow? Point to an example file."
  Options: `None`, `I'll describe it`

**Background context** (if selected):
- "Describe the architectural decisions, patterns, or constraints the agent needs to know to act without prior context."
  Options: `I'll describe it`

**Custom output format** (if selected):
- "What XML tag should wrap the final deliverable?"
  Options: `<findings>`, `<report>`, `<diff>`, `<summary>`

**Workflow stage** (if selected):
- "What should come back? Describe the fields the schema should capture."
  Options: `I'll describe them`

---

## Resolve project config (craft-time, once)

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/render-sections.js` now — the one
mechanical call that resolves `usePersona`/`sections`/`omit`/
`targetModel`/`decisionLog`. Every step below (Call 6's default, Assemble
the prompt's elaboration scoping and its `<decision_log>` block, Deliver's
clipboard recommendation) reads this same result. Nothing past this point
calls it again.

---

## Call 5 — destination

Ask this now, before the prompt exists, not after assembly. There is
nothing to preview yet; the destination decides how the prompt gets
delivered, not the other way around.

**Q1** — "How do you want to run this?"
Options:
- `Execute here` — run it in this session
- `Execute with a background Agent` — offload it, get notified on completion — best for orchestration, where this session owns the commits
- `Copy prompt to clipboard` — just get the text, no execution

The `spawn_task` ban applies here — see `prompt-template.md`'s "Delivery
mechanics" section.

---

## Call 5b — execution mode (conditional)

Ask this only when Call 5 Q1's answer was `Execute here`. The other two
destinations skip it and go to Call 6 instead — the two questions are
mutually exclusive.

**Q1** — "How should it run here?"
Options and their free-text rule: `prompt-template.md`'s "Delivery
mechanics" section, verbatim.

---

## Call 6 — executing model (conditional)

Ask this when Call 5 Q1's answer was "Execute with a background Agent"
or "Copy prompt to clipboard" — its default depends on that answer, so
it can't batch into Call 5's own question. Skip it for **`Execute here`**:
that destination runs the task in this session, so no model choice
exists (Call 5b runs instead).

**Q1** — background Agent: "Which model should the background Agent run
on?" Clipboard: "Which model will run the pasted prompt?"
`Haiku`, `Sonnet`, `Opus` always; `Fable` too, but only when the
render-sections result's `fableEnabled` is `true` — three options when
it's `false` (the default), four when it's `true`. Reordered so the
**recommended** model leads, with `(Recommended)` appended to its label —
same convention `foreman:roadmap`'s Q1 uses for its top-ranked candidate.
The recommendation is the resolved `targetModel` when the project pinned
a concrete one; otherwise (`inherit`) judge it from the task the user
described against `prompt-template.md`'s "Model fit" note. A `targetModel:
"fable"` project pin still recommends `Fable` even when `fableEnabled` is
`false` — a direct pin is its own declaration, independent of the
interactive-menu gate.

No fifth "Inherit"/"Unknown" slot — `AskUserQuestion` caps authored
options at four, and the tool's own automatic `Other` already covers
"not sure" / "whatever it inherits" as free text, so a dedicated option
for that would cost one of the four real models a slot for no reason.
Add a one-line why to Q1's context (e.g. "bounded single-file change —
Haiku fits", or "reconciles renamed refs — Sonnet/Opus/Fable, past the
Haiku cliff"), plus this hint so the user knows the escape hatch exists:
"Not sure, or want it to inherit the session's model? Pick Other and
leave it blank or say so."

The user can always override the default. The answer does two jobs:
- **Elaboration**: a concrete model becomes the effective target model
  for the template's elaboration scoping, overriding `targetModel` — the
  model actually running the task wins over the project declaration. An
  `Other` answer that doesn't name a concrete model keeps the resolved
  `targetModel` instead.
- **Dispatch** (background Agent only): a concrete model becomes the
  `Agent` call's literal `model` value (`haiku`/`sonnet`/`opus`/`fable`);
  an `Other` answer that doesn't name a concrete model means leaving
  `model` out of the call.

---

## Assemble the prompt

Follow `${CLAUDE_PLUGIN_ROOT}/prompt-template.md` exactly for its XML
template, verbatim. Its craft-time environment check (`render-sections.js`)
already ran above, before Call 5 — use that same result, don't invoke it
again. Elaboration scoping uses the effective target model: Call 6's
concrete answer when one was gathered, otherwise the result's
`targetModel`. Never re-derive or duplicate the per-model elaboration
guidance itself; if the template changes, this skill picks up the change
automatically by reading it fresh each time. Map this skill's
gathered fields onto the template's placeholders:

- `task_context`: role ← Call 2 Q1, goal ← Call 2 Q2
- `relevant_files` ← Call 2 Q3 (including any `Pattern:` reference line)
- observed failure ← Call 3 Q3, when gathered and not `None observed`:
  into `<context>` under an `Observed failure:` line, verbatim
- `task_rules`: steps ← Call 2 Q4; Constraints ← Call 4's Constraints
  answers, if selected; Verification ← Call 3, if gathered
- review-flavored tasks (the `Security audit` task type, or the
  `Code reviewer` role): add one constraint bullet to `task_rules` —
  "Flag only gaps that affect correctness or security — reporting that
  the work is sound is a valid outcome."
- `tone` ← Call 4's Tone answer, if selected (overrides the template's
  default entirely, same as the template already says); otherwise the
  template's own craft-time gate applies unchanged
- `background`/`context` ← Call 4's Background-context answer, if selected
- `example` ← Call 4's Example answer, if selected
- `output_format` ← Call 4's Custom-output-format answer, if selected;
  otherwise the template's own default applies
- `output_format`/`tone` ← if `Workflow stage` was selected instead: the
  template's Workflow-stage flavor overrides both (fixed sentence,
  mechanical tone omission, schema-authoring and delivery rules all live
  there) — the schema itself derives from Call 4's Workflow-stage answer
- `decision_log` ← include the template's `<decision_log>` block when the
  render-sections result's `decisionLog.enabled` is true, substituting its
  `dir` for `<dir>`; omit it when false (the template's own craft-time gate
  says the same). A craft-prompt task carries no roadmap entry, so name the
  doc after a short kebab slug of the goal in place of `<entry-id>`.

Before moving to the next phase, verify the assembled prompt against
`prompt-template.md`'s own checklist, then run its mechanical gate
(`scripts/check-prompt.js` — the template's "Mechanical gate" section has
the exact call) and fix every error until it passes — don't re-list
either here.

---

## Deliver

Deliver via whatever Calls 5 and 5b picked — no further question. Each
destination's mechanics are `prompt-template.md`'s "Delivery mechanics"
section; the `Execute here` sub-mode is Call 5b's answer. Two additions
this skill layers on top:

- **Background Agent** — pass `model` = Call 6's answer as its literal
  string (`haiku`/`sonnet`/`opus`/`fable`); omit the `model` parameter
  entirely when the answer was an `Other` that didn't name a concrete
  model.
- **Clipboard** — if the effective target model (Call 6's answer, else
  `targetModel`) is concrete, add one more line alongside the file path:
  "Recommended model: [Haiku/Sonnet/Opus/Fable] — this prompt's
  elaboration level was calibrated for it." Skip that line when it
  resolved to `inherit` or no concrete model was named — no fixed target,
  so there's nothing to recommend.
