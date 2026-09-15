---
name: craft-prompt
description: "Advanced surface, separate from Foreman's core roadmap job — a standalone prompt builder for work that has no roadmap entry behind it. Use on an explicit prompt-crafting request. Builds or refines a self-contained prompt for a fresh session following Foreman's template: asks which optional sections to include, gathers the missing intent, grounds paths and checks, assembles the XML, then runs it here as one or several tracked tasks, hands it to a background agent, or copies it to the clipboard."
when_to_use: "Trigger only on an explicit request to build or refine a standalone prompt — \"craft a prompt\", \"build a prompt\", \"write me a prompt\", \"refine this prompt\", \"foreman prompt\", or invokes /foreman:craft-prompt. An ordinary work request is not one of those: wanting something built, tracked, or handed to a background Agent is roadmap work — it goes to the `foreman` entrance, which picks or adds the entry and builds the handoff itself."
argument-hint: "<brief task description — optional seed>"
allowed-tools: AskUserQuestion, TaskCreate, TaskUpdate, Agent, Read, Write, Bash, PowerShell
---

# foreman:craft-prompt — interactive prompt builder

Foreman runs in Claude Code and in Codex. Every step applies to both unless it names a host. Read [the shared runtime](../foreman/runtime.md) first: it covers plugin paths, JSON payloads, questions and authorization for both hosts.

Advanced tool, separate from Foreman's core job. An ordinary
implementation request does not call for a prompt-crafting interview: it
goes through [the `foreman` entrance](../foreman/SKILL.md), which builds
its own handoff out of the roadmap entry. This skill is for the case with
no roadmap entry behind it: a standalone prompt, asked for explicitly.
Write for a destination with no memory of this conversation — every field
must be filled so it can act cold.

Ask each call's questions together — `AskUserQuestion` in Claude Code; in
Codex, the picker in [questions.md](../foreman/questions.md), within its
limits. With no usable question tool, ask one self-contained plain-text
question. Ask directly: never say Foreman requires the question or cite a
skill as the reason. Text supplied with the request (in Claude Code, the
skill's args) seeds the task description; skip a question only when the
user's own words already answer it.

---

## Call 1 — task type, optional sections, starting point, and flavor

Ask these four questions together:

**Q1** — "What task should the spawned session perform?"
Options: `Implement a feature`, `Fix a bug`, `Investigate / research`, `Refactor code`

**Q2** — "Which optional sections do you want in the prompt?" (several may be picked; `multiSelect: true` in Claude Code)
Options:
- `Tone` — override the default (minimal/professional, silent-by-default; projects opt out entirely via `omitSections: ["tone"]`)
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
sets it: the Workflow tool layer enforces the schema. In Codex, set it only
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

---

## Ground the file options (one read-only pass, before Call 2)

Call 2's Q3 is the one answer that has to produce a real path, so ground it
instead of asking it cold: run **one** bounded, read-only pass over the
project now, before Call 2, and turn what it finds into the options. In
Claude Code, dispatch **one** `Explore` agent at medium breadth; in Codex,
read the project directly, using a collaboration worker only when useful
independent work can proceed alongside it.

The pass takes Call 1's request verbatim and returns four things:

- up to three candidate file lines, each `path — the symbols that matter`
- the project's test command, written the way it would actually be typed
  (in Codex, when there is none, the available human review of the
  requested result — never an invented command)
- one file that already does something similar, for the `Pattern:` line
- one way this project can be *driven or looked at*, when it has one — a
  project skill (under `.claude/skills/` in Claude Code), a script, a
  fixture harness — so the handoff names a check the destination runs
  instead of handing it back to the user. It has to clear three bars, all
  of them: it runs unattended, it exits on its own, and it does not rewrite
  the thing it checks. Name the command, or return nothing.

The three bars are judgment, not a gate: a dev server, a command that
needs someone at the keyboard, or a test run that regenerates its own
golden files fails them, and returning nothing beats returning a near-miss.
One pass only. Never a second one — a follow-up pass is the second
interview this whole skill is shaped to avoid.

**What comes back is a proposal, not a finding.** Offer it; never assert
it. The user's `Other` answer always wins (in Codex, their free-text
answer), and a candidate they did not pick is dropped rather than argued
for. Nothing the pass returns reaches `touches` until the user has chosen
it.

**When the pass returns nothing usable** — no repository, an empty result,
or candidates naming no file — every question below keeps its free-text
wording. A grounded option upgrades the question; it is never a
precondition for asking it.

---

## Call 2 — required fields (batch all 4)

**Q1** — "What role should the spawned agent play?"
Options: `Senior engineer`, `Security engineer`, `Code reviewer`, `Technical writer`

**Q2** — "What does 'done' look like? One sentence. A performance or
coverage goal names the metric and threshold (e.g. 'p95 under 500ms')."
Options: `Bug is fixed and all tests pass`, `Feature is implemented and tested`, `Findings are written to a file in the repo, cited`, `Refactor complete — no behavior change`

**Q3** — "List the relevant files, naming the functions or classes that
matter in each. If an analogous implementation exists, name it too as a
pattern to imitate."
Options: `<candidate 1>`, `<candidate 2>`, `<candidate 3>`, `I'll list them` (each candidate is one line the grounding pass proposed, already shaped `src/auth/middleware.ts — refreshToken, verifySession`. Fill the slots you have and drop the rest; with no candidates at all the options are `I'll list them` and `I can only name the area`. Whichever way the user answers, they may add a `Pattern: src/webhooks/github.ts — build the new code the same way` line, and the pass's similar-file answer is what to suggest for it. A line number only when the spot has no name — `resolve-symbols.js` fills the rest in below.)

The candidates are offered one per option so the user can take one and
correct it rather than retyping the whole list. Let the user pick several
when the pass returned more than one plausible file (`multiSelect` in
Claude Code): the picked lines concatenate into `touches` in the order
shown.

**Q4** — In Claude Code: "Describe the two steps: analyze/check, then implement/produce."
In Codex, ask for approach notes and keep requirements separate from
suggested implementation steps: prescribe an order only when a dependency,
an explicit user instruction, or the verification method requires it.
Options: `I'll describe them`, `Implement only, no analysis`
`Implement only, no analysis` yields one `judgment.steps` bullet rather
than two — the analyze half is dropped, never invented. For
`Investigate / research`, this answer is the question under investigation
instead.

---

## Call 3 — verification (conditional)

Skip this call only if the task type is pure research/investigation with no code changes.

**Q1** — "What command or commands verify success?"
Options: `<the detected command>`, `<the detected way to drive the project>`, `npm test`, `pytest` (the grounding pass's answers lead because they were read off this project rather than guessed; with nothing detected the options are the four generic ones, `npm test`, `pytest`, `cargo test`, `go test ./...`). The drive command is offered second and only when the pass found one.

A detected command is still only a proposal. `resolve-symbols.js` below
checks it against the project for real, and `verification.resolves: false`
is what settles it — not the fact that the pass suggested it.

**Q2** — "What's the expected outcome?"
Options: `All tests pass`, `Build succeeds with exit code 0`, `No lint errors`, `Report file produced`

Several checks, named in the order they should run, are fine and normal —
each becomes its own `Run:`/`Expected:` pair in the prompt, so list every
real check here. In Claude Code every row is a `{run, expected}` pair; for a
split, name the slice of the work a row verifies with `goal` (and `files` when
known). In
Codex, follow [prepare-increments.md](../roadmap/prepare-increments.md):
gather one row per meaningful result, combining actual commands and human
review (`review:{action, expected}`) when they concern the same work.
Human-only verification does not change the request into an investigation.
Preserve an explicit request to approve each result before the next as
`reviewEachIncrement:true` with `review` on every row; do not enable it for
an ordinary split.

**Q3** — only when Call 1's task type was `Fix a bug`: "Paste the failing
output — stack trace, error message, or test failure — verbatim."
Options: `I'll paste it`, `None observed`
The answer lands in `<context>` under an `Observed failure:` line, exactly
as pasted — the artifact, not a paraphrase (the spawned session can't ask
what the error actually said).

**Q4** — "What must stay true after this change? One observable assertion
per line — something a command could check, not the name of a contract."
Options: `I'll list them`, `Nothing in particular`
The answers fill the template's optional `<invariants>` block. Rephrase a
contract name into the assertion behind it ("preserve the
identity-per-rebuild contract" → "rebuilding twice yields the same ids");
if the user can't name the assertion, say that in the line rather than
passing the name through. `Nothing in particular` omits the block, and is
a normal answer rather than a gap to push back on.

**Don't ask about the file surface or the test-first ordering** — both are
inferable, and a second interview is the thing to avoid. The
`Expected file surface:` constraint line comes from Call 2 Q3's paths as
given. Test-first ordering goes into the verification block only when this
task's breakage would pass the checks Q1 just named.

---

## Call 4-N — optional section details

For each section selected in Call 1 Q2, ask its detail question(s), batched per call (at most 4 questions per `AskUserQuestion` call in Claude Code).

- **Tone** — "Describe the tone for this session."
  Options: `Cautious and defensive (security-focused)`, `Fast and pragmatic (prototype)`, `Pedagogical — explain each step`, `Formal technical report style`
- **Example** — "Provide a before/after snippet or input → output example."
  Options: `I'll type it`, `No example to give`
- **Constraints** (batch both) — "Which files or interfaces must NOT be modified?" Options: `I'll list them`, `Nothing is off limits`; and "Is there a coding style or pattern to follow? Point to an example file." Options: `None`, `I'll describe it`
- **Background context** — "Describe the architectural decisions, patterns, or constraints the agent needs to know to act without prior context."
  Options: `I'll describe it`, `Nothing beyond the files themselves`

A section selected in Q2 whose detail question comes back with the
nothing-to-give answer — `No example to give`, `Nothing is off limits`,
`None`, `Nothing beyond the files themselves` — is dropped from the
assembled prompt, exactly as Call 3 Q4's `Nothing in particular` drops
`<invariants>`. An empty block is worse than an absent one, and changing
their mind about a section is a normal answer rather than a gap to push
back on.

**Workflow stage** (when Call 1 Q4 was `Yes`):
- "What should come back? Describe the fields the schema should capture."
  Options: `I'll describe them`, `Derive them from the done state`

  `Derive them from the done state` does not skip the schema — the stage
  cannot run without one. Author it from Call 2 Q2's done state and Call 1
  Q1's task type instead, then show the fields before delivering.

  `craft-handoff.js` bakes the flavor when the call below carries
  `"workflowStage":true`, but it does NOT author the schema: assemble a
  second artifact yourself, a fenced `json` JSON Schema built from this
  answer. Authoring rules: object root with a `required` array; a
  `description` on every property (descriptions double as instructions to
  the structured-output layer); enums for verdict-like fields; for
  evidence-bearing claims use the cited-pair shape
  `{"cite": "file:line or doc URL", "note": string}`; keep schemas small —
  every validation retry costs a full subagent turn.
  Legality rules, separate from the authoring rules above: in Claude Code,
  `minimum`/`maximum`, `minLength`/`maxLength`, `multipleOf`, recursive or
  external `$ref`, and `minItems` above 1 are unsupported, and
  `additionalProperties` takes no value but `false` — state any such bound
  in the property's `description` instead. An unsupported keyword is
  rejected up front with a 400, not at output-validation time. In Codex,
  verify the runner's supported JSON Schema subset. The schema travels
  with the prompt; see Deliver below.

---

## When an answer is "I don't know"

Any question here can come back as a don't-know in free text (in Claude
Code, `AskUserQuestion` always appends that option). Carry it through as a
stated unknown — never as a guess, and never by dropping the field. Call 3
Q4 already says this for invariants; the same holds for every question in
this interview.

- **Call 2 Q2, the done state** — the one that blocks. A prompt with no
  checkable "done" wastes the whole session. Ask once more for the
  observable signal before assembling.
- **Call 2 Q3, the files** — the one answer that still has to produce a
  path. `relevant_files` is never allowed to be empty: `check-prompt.js`
  hard-errors on an empty block, so a `touches` of `[]` cannot assemble at
  all. On `I can only name the area`, or any free-text answer that names no
  file, put the narrowest directory or subsystem the user *can* name into
  `touches`, and add a `judgment.context` line saying the list is that area
  rather than a survey of it. If they cannot name even a directory, say so
  and ask once for one — it is the single field the handoff cannot be
  assembled without.
- **Anywhere else** — one `judgment.context` line: "Open question the user
  could not answer: <the question>. Resolve it from the code and say what
  you found."

---

## Resolve the named files (craft-time, once)

Once the file paths are known, run
`node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-symbols.js` now with
`{touches, what, verify}` on stdin (user text stays out of shell quotes:
see [the shared runtime](../foreman/runtime.md)). `craft-handoff.js`
resolves the touched paths again on its own, so this call exists only for
the check below — catching a problem now, before the interview continues,
instead of after assembly. A `missing` file is expected when this task
creates it; correct a path that moved. An `outside_project` path is
refused: fix or drop it.

<!-- [Foreman: 109] -->
Call 3 has already gathered the verification commands by this point, so
pass every `run` command as `verify` (an array; never a review action) in
the same call and act on all three fields here rather than assembling
around them:
- `verification.resolves: false` for any command — nothing in this
  project answers to it. Fix it with the user before assembly; a prompt
  naming a command that cannot run wastes the whole session.
- `references` — a file already importing the same helper is the
  `Pattern:` line `relevant_files` asks for in Call 2's Q3. Cite it instead
  of leaving the pattern slot empty.
- `files[].lastChanged` — a touched file that changed recently is where
  this task's claims are most likely stale. Hand those facts over as
  claims for the destination to check rather than restating them as
  settled.

---

## Call 5 — how to run it

Honor a destination the user already stated. Otherwise read
[destination-question.md](../roadmap/destination-question.md)
(`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/destination-question.md`) now and
do exactly what it says. Call 3 already gathered the verification, so the
count is known here — it never removes an option, it decides which one
carries a caution. Foreman never asks which model runs the work and never
sets one: a background agent inherits this session's model, and a pasted
prompt runs wherever the user pastes it.

---

## Assemble the handoff — one call to craft-handoff.js

No hand assembly — gather the judgment fields below, entirely from this
interview (no new investigation, same rule as every other step here), then
make one call to `node ${CLAUDE_PLUGIN_ROOT}/scripts/craft-handoff.js` with
the JSON on stdin (user text stays out of shell quotes, as above),
entry-less: no `"entry"` key, every field given inline instead. It resolves
the touched paths, assembles the XML from the canonical blocks, bakes the
checkpoint/split delivery artifacts, and runs the mechanical gate
in-process — nothing left here to re-derive or re-list. `tone`, `example`,
and `output_format` land only in a full-strength prompt, which most fresh
craft-prompt tasks are not (in Claude Code, `invariants` too), and the
project configuration can omit sections; if the user picked one of those
optional sections and it did not make it in, say so plainly rather than
acting as if it had.

- `host` ← `"claude"` in Claude Code, `"codex"` in Codex
- `title` ← a short verb-first name for the task; `what` ← Call 2 Q4's
  answer (also what `resolve-symbols.js` scanned above for unresolved
  identifiers, so keep it the same text)
- `touches` ← Call 2 Q3's paths, as a plain array
- `request` ← one imperative sentence combining Call 1 Q1's task type and
  Call 2 Q2's done state
- `kind` ← `"decision"` only when the task being crafted is itself a
  decision — its deliverable is a choice between real alternatives, not an
  implementation; omit otherwise. `craft-handoff.js` bakes the decision
  `task_rules` bullet from it automatically, exactly as a roadmap pick
  does.
- `destination` ← `"task"` for `Execute here`, `"agent"` for the
  background agent, `"clipboard"` for clipboard
- `split` ← `true` only when Call 5 picked `Execute here, split by check`
  (in Codex, also for an explicitly requested local run by increments)
- `reviewEachIncrement` ← in Codex only: `true` for the user's explicit
  request to approve each result before the next (Call 3), keeping the
  chosen destination
- `workflowStage` ← `true` only when Call 1 Q4 answered `Yes` (in Codex,
  only when the destination's runner enforces the schema)
- `customTone` ← Call 4's Tone answer, if selected (top-level field,
  outside `judgment`)
- `judgment.role`/`judgment.goal` ← Call 2 Q1/Q2
- `judgment.purpose` ← one sentence for what the finished work feeds or
  who reads it, when the interview already named that (Call 4's
  Background-context answer commonly does); omit it otherwise, which is
  the common case
- `judgment.context` ← Call 4's Background-context answer, if selected,
  plus Call 3 Q3's observed failure, when gathered and not
  `None observed`, under an `Observed failure:` line, verbatim
- `judgment.steps` ← Call 2 Q4's answer, split into implement/fix bullets
- `judgment.question` ← for an investigation or review, the question under
  investigation instead of `judgment.steps` — not a prescribed sequence.
  It defines the question and the expected findings and never turns into
  implementing a fix: its checks are evidence, and a failed check does not
  authorize implementation.
- `judgment.constraints` ← Call 4's Constraints answers, if selected, plus
  one more line for a review-flavored task (the `Code reviewer` role, or a
  task type the user described as a review or audit): "Flag only gaps
  that affect correctness or security — reporting that the work is sound
  is a valid outcome." Encode an explicitly read-only scope here too; a
  file restriction goes here only when the user supplied one.
- `judgment.expectedFileSurface` — usually omit it: the script fills the
  "Expected file surface:" constraint line from `touches` on its own. Pass
  it only to narrow or widen that list on purpose; with no paths named
  there is no line
- `judgment.verification` ← Call 3's rows, in running order; omit it
  rather than invent a command
- `judgment.testFirst` ← `true` only for a silent-failure task — one whose
  breakage would pass the verification just gathered (see Call 3 Q4's
  note); omit it for a loud one, an investigation, or a decision
- `judgment.invariants` ← Call 3 Q4, when gathered and not
  `Nothing in particular`; omit otherwise
- `judgment.example` ← Call 4's Example answer, if selected, split into
  `{"before": "...", "after": "..."}`

In Claude Code, every plugin path this call's stdin JSON carries — and
every path in the returned `prompt` — is the literal string
`${CLAUDE_PLUGIN_ROOT}`. Remember: the copy of this skill you are reading
has the variable already resolved to a version-pinned cache path, and
baking that in breaks the prompt on the next version bump; the gate errors
on it. Type it back literally.

Returns one JSON line: `{ok, prompt, profile, signals, tasks?, gate,
warnings}`. `profile` and `signals` are internal bookkeeping — never name
either in anything the user reads. Surface any top-level `warnings`
verbatim whenever that array is non-empty — including when `ok` is `true`,
since a path not on disk yet, or an unanswerable verification command, has
to be judged before delivery. When `ok` is `false`, read the failing JSON
verbatim: each entry in `gate.errors` is `{error, fix, example}` — `error`
names the judgment field that's too thin, `fix` is the one action that
clears it, and `example` is the shape to copy when a literal helps more
than a sentence. Repair the named field from the user's intent and the
evidence already gathered, then re-call; show the user `gate.errors` (and
any `gate.warnings`) when the repair needs their answer. Never resend the
same stdin, and never deliver an `ok:false` result.

---

## Deliver

Read [delivery.md](../roadmap/delivery.md)
(`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/delivery.md`) and deliver through
the destination chosen above, using the `prompt` (and `tasks[]` when
present) craft-handoff just returned — never re-derive, re-split, or
re-embed any of it. What differs for a standalone prompt:

- There is no roadmap entry: skip every entry step delivery.md names —
  opening or closing it, the dispatch note, the acceptance hold.
  Checkpoints otherwise work exactly as in a roadmap handoff.
- A `Workflow stage` task also carries the JSON Schema assembled in Call 4,
  delivered alongside `prompt` the same way: the clipboard temp file holds
  the prompt then the schema; in Claude Code, a `TaskCreate` description
  carries both.
- **Never print the assembled prompt or a Workflow-stage schema into chat
  unless the user asks to see it** — they are data for a tool call or a
  file; delivery.md's last-resort fallback is the only other exception.
