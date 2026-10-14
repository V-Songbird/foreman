# Call 1 — task type, optional sections, starting point, and flavor

Ask these four questions together:

**Q1** — "What task should the spawned session perform?"
Options: `Implement a feature`, `Fix a bug`, `Investigate / research`, `Refactor code`

**Q2** — "Which optional sections do you want in the prompt?" (several may be picked; `multiSelect: true` in Claude Code)
Options:
- `Tone` — override the default (minimal, professional conversation; projects opt out entirely via `omitSections: ["tone"]`)
- `Example` — a before/after or input→output snippet (good for fixes and transformations)
- `Constraints` — hard limits on files or interfaces the agent must NOT touch
- `Background context` — architectural decisions, patterns, or environment details

**Q3** — "How well do you know this part of the code?"
Options:
- `I know it well` — I can name what should change and what must not.
- `I know the goal, not the code` — I know what I want; this area's shape
  is new to me.
- `This area is new to me` — I could not yet say what a good answer looks
  like here.

**Q4** — In Claude Code: "Is this prompt a Workflow `agent(prompt, {schema})` stage?"
In Codex, ask whether a machine consumer needs the output as structured data.
Options:
- `No` — an ordinary prompt.
- `Yes` — prompt plus a JSON Schema the consumer reads.

Q4 is a flavor, not an optional section. `"workflowStage":true`
mechanically omits `Tone`, overriding a `Tone` selected in Q2, and replaces
the default output format with a fixed sentence. In Claude Code, `Yes`
sets it: the Workflow tool layer enforces the schema. A Claude Code stage
for the background agent also returns its questions in the structured
report instead of asking, and leaves any roadmap entry to the Workflow that
launched it: the worker commits with the entry's `Foreman: <id>` trailer
and runs no `update-status` or `safe-commit`. Give the schema a field for
those questions, such as `needs_owner`. In Codex, set it only
when the destination's runner enforces the attached schema; otherwise
deliver the schema as an explicit output contract without claiming
enforcement, and never assume another host's `agent(prompt, {schema})` API.

Record which optional sections were selected.

Q2 asks what the user *wants* in the prompt, not what's *true* about the
code — no repository scan answers it, so don't skip it even when you've
already grounded every fact the prompt will state. Skip it only when the
user already named the sections they want.

Q3 is a starting-point line, not a section: it changes what the assembled
prompt says, never which blocks it carries. There is no new judgment field
— every answer below lands in `judgment.context` or `judgment.steps`, which
the assemble step already carries.

- `I know it well` — nothing is added.
- `I know the goal, not the code` — add one `judgment.context` line:
  "Starting point: the user knows the goal but not this area's code, so the
  file list and steps below are a best guess at its shape, not a survey of
  it."
- `This area is new to me` — say in one line that a blind spot pass here is
  cheaper than a wrong prompt, and offer to run one in this session before
  crafting. A cold session cannot teach an absent user, so the pass belongs
  here, not in the prompt. If the user takes it, its answers feed Call 2's
  files and steps and Call 4's background context, and Q3 is re-read as
  `I know the goal, not the code`. If the user declines, add the context
  line above plus one first `judgment.steps` bullet:
  "Before making changes, do a blind spot pass on this area: name the
  unknown unknowns — the questions this task should have answered, what
  good looks like here, prior work already done, and the potholes — and
  report them. Then proceed with the conservative reading."

Word that bullet with **name** and **report**, never "explain your
reasoning": ask for findings and evidence, not private reasoning.
