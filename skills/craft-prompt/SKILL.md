---
name: craft-prompt
description: Advanced surface, separate from Foreman's core roadmap job — a standalone prompt builder for work that has no roadmap entry behind it. Guides you through assembling a self-contained spawned-session prompt following Foreman's template — asks which optional sections to include, gathers required info via AskUserQuestion, assembles the XML, then runs it here as one or several tracked tasks, hands it to a background Agent, or copies it to the clipboard.
when_to_use: Trigger only on an explicit request to build or refine a standalone prompt — "craft a prompt", "build a prompt", "write me a prompt", "refine this prompt", "foreman prompt", or invokes /foreman:craft-prompt. An ordinary work request is not one of those: wanting something built, tracked, or handed to a background agent is roadmap work — it goes to the `foreman` entrance, which picks or adds the entry and builds the handoff itself.
argument-hint: "<brief task description — optional seed>"
allowed-tools: AskUserQuestion, TaskCreate, TaskUpdate, Agent, Read, Write, Bash, PowerShell
---

# foreman:craft-prompt — interactive prompt builder

Advanced tool, separate from Foreman's core job. Ordinary work goes through
the `foreman` entrance, which builds its own handoff out of the roadmap
entry. This skill is for the case with no roadmap entry behind it: a
standalone prompt, asked for explicitly. The spawned session has zero
memory of this conversation — every field must be filled so it can act
cold.

If args were provided, treat them as the task description seed and skip asking for it in Call 1.

---

## Call 1 — task type, optional sections, starting point, and flavor

Ask these four questions together:

**Q1** — "What task should the spawned session perform?"
Options: `Implement a feature`, `Fix a bug`, `Investigate / research`, `Refactor code`

**Q2** — "Which optional sections do you want in the prompt?" (multiSelect: true)
Options:
- `Tone` — override the default (minimal/professional, silent-by-default — see the template; projects opt out entirely via `omitSections: ["tone"]`)
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

**Q4** — "Is this prompt a Workflow `agent(prompt, {schema})` stage?"
Options:
- `No` — an ordinary prompt.
- `Yes` — prompt plus a JSON Schema the tool layer enforces (mechanically
  omits `Tone` and replaces the default output format with a fixed
  enforcement sentence — see the template)

Q4 is a flavor, not an optional section: it changes how every block is
rendered rather than adding one. `Yes` overrides a `Tone` selected in Q2.

Record which optional sections were selected.

Q2 asks what the user *wants* in the prompt, not what's *true* about the code — no amount of upfront code investigation answers it, so don't skip it even when you've already grounded every fact the prompt will state. Investigation and section selection are orthogonal: being confident about the code is not the same as knowing which sections the user wants included.

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
reasoning": the gate warns on a prompt that asks the destination to echo
its reasoning, and the warning is real — it can trigger a refusal on a
Fable-class model.

---

## Ground the file options (one Explore pass, before Call 2)

Call 2's Q3 is the one answer that has to produce a real path, and a
hand-typed path pointing at the wrong file is exactly the failure
`truth_grounding` spends the destination's tokens rescuing. Ground the
question instead of asking it cold: dispatch **one** `Explore` agent now,
before Call 2, and turn what it finds into the options.

Give it Call 1's request verbatim and ask for three things back:

- up to three candidate file lines, each `path — the symbols that matter`
- the project's test command, written the way it would actually be typed
- one file that already does something similar, for the `Pattern:` line

One pass, medium breadth, read-only. Never a second one — a follow-up
Explore is the second interview this whole skill is shaped to avoid.

**What comes back is a proposal, not a finding.** Offer it; never assert
it. The user's `Other` answer always wins, and a candidate they did not
pick is dropped rather than argued for. Nothing Explore returns reaches
`touches` until the user has chosen it.

**When Explore returns nothing usable** — no repository, an empty result,
or candidates naming no file — every question below keeps the free-text
wording it has always had. A grounded option upgrades the question; it is
never a precondition for asking it.

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
Options: `<Explore candidate 1>`, `<Explore candidate 2>`, `<Explore candidate 3>`, `I'll list them` (each candidate is one line the Explore pass proposed, already shaped `src/auth/middleware.ts — refreshToken, verifySession`. Fill the slots you have and drop the rest; with no candidates at all the options are `I'll list them` and `I can only name the area`, as before. Whichever way the user answers, they may add a `Pattern: src/webhooks/github.ts — build the new code the same way` line, and Explore's similar-file answer is what to suggest for it. A line number only when the spot has no name — `resolve-symbols.js` fills the rest in below.)

The candidates are offered one per option so the user can take one and
correct it in `Other` rather than retyping the whole list. Multi-select
this question when Explore returned more than one plausible file: the
picked lines concatenate into `touches` in the order shown.

**Q4** — "Describe the two steps: analyze/check, then implement/produce."
Options: `I'll describe them`, `Implement only, no analysis`
`Implement only, no analysis` yields one `judgment.steps` bullet rather
than two — the analyze half is dropped, never invented.

---

## Call 3 — verification (conditional)

Skip this call only if the task type is pure research/investigation with no code changes.

**Q1** — "What command or commands verify success?"
Options: `<the command Explore detected>`, `npm test`, `pytest`, `cargo test` (Explore's answer leads because it was read off this project rather than guessed; with nothing detected the options are the four generic ones, `npm test`, `pytest`, `cargo test`, `go test ./...`)

A detected command is still only a proposal. `resolve-symbols.js` below
checks it against the project for real, and `verification.resolves: false`
is what settles it — not the fact that Explore suggested it.

**Q2** — "What's the expected outcome?"
Options: `All tests pass`, `Build succeeds with exit code 0`, `No lint errors`, `Report file produced`

Several checks, named in the order they should run, are fine and normal —
each becomes its own `Run:`/`Expected:` pair in the prompt. The count also
decides whether Call 5 offers the split at all, so list every real check
here.

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

For each section selected in Call 1 Q2, ask its detail question(s). Batch up to 4 questions per call.

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

  This flavor mechanically drops `Tone` and replaces the default output
  format with a fixed enforcement sentence — `craft-handoff.js` bakes both
  of those when the call below carries `"workflowStage":true`. What it does
  NOT do is author the schema: assemble a second artifact yourself, a
  fenced `json` JSON Schema built from this answer. Authoring rules: object
  root with a `required` array; a `description` on every property
  (descriptions double as instructions to the StructuredOutput layer);
  enums for verdict-like fields; for evidence-bearing claims use the
  cited-pair shape `{"cite": "file:line or doc URL", "note": string}`; keep
  schemas small — every validation retry costs a full subagent turn.
  Legality rules, separate from the authoring rules above: the schema layer
  takes draft-07 only, and `minimum`/`maximum`, `minLength`/`maxLength`,
  `multipleOf`, recursive or external `$ref`, and `minItems` above 1 are
  unsupported — state any such bound in the property's `description`
  instead. An unsupported keyword fails the run at startup, not at
  validation time.
  Delivery: both artifacts travel together to the chosen destination — a
  clipboard temp file carries the prompt then the schema; a `TaskCreate`
  description carries both. The never-print-into-chat rule in Deliver below
  covers both.

---

## When an answer is "I don't know"

`AskUserQuestion` always appends its own free-text option, so any question
here can come back as a don't-know. Carry it through as a stated unknown —
never as a guess, and never by dropping the field. Call 3 Q4 already says
this for invariants; the same holds for every question in this interview.

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
`node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-symbols.js` now.
`craft-handoff.js` resolves the touched paths again on its own, so this
call exists only for the check below — catching a problem now, before the
interview continues, instead of after assembly.

<!-- [Foreman: 109] -->
Call 3 has already gathered the verification commands by this point, so
pass the first of them as `verify` in the same call and act on all three
fields here rather than assembling around them:
- `verification.resolves: false` — nothing in this project answers to that
  command. Fix it with the user before assembly; a prompt naming a command
  that cannot run wastes the whole session.
- `references` — a file already importing the same helper is the
  `Pattern:` line `relevant_files` asks for in Call 2's Q3. Cite it instead
  of leaving the pattern slot empty.
- `files[].lastChanged` — a touched file that changed recently is where
  this entry's claims are most likely stale. Hand those facts over as
  claims for the destination to check rather than restating them as
  settled.

---

## Call 5 — how to run it

Call 3 already gathered the verification commands, so the count is known
here. Read `${CLAUDE_PLUGIN_ROOT}/skills/roadmap/destination-question.md`
now and do exactly what it says: it carries the question and its options
(the split option appears only when Call 3 gathered two or more checks),
the delivery-path rule, and the render-sections `fableEnabled` resolve
that follows the answer — that resolve gates Call 6 below. The checkpoint
protocol and clipboard mechanics it defers to are Deliver below.

---

## Call 6 — executing model (conditional)

Ask this when Call 5's answer was `Execute with a background Agent` or
`Copy prompt to clipboard`. Skip it for either `Execute here` option —
that session already has a model, and Foreman never changes it.

**Q1** — background Agent: "Which model should the background Agent run
on?" Clipboard: "Which model will run the pasted prompt?"
`Haiku`, `Sonnet`, `Opus` always; `Fable` too, but only when the
render-sections result's `fableEnabled` is `true` — three options when
it's `false` (the default), four when it's `true`. Offer them in plain
order with no `(Recommended)` label and no why-line: the question exists
because a dispatch needs a model named, not because Foreman has an opinion
about which one.

No fifth "Inherit"/"Unknown" slot — `AskUserQuestion` caps authored
options at four, and the tool's own automatic `Other` already covers it as
free text. Add this hint to Q1's context so the user knows: "Not sure, or
want it to inherit the session's model? Pick Other and leave it blank or
say so."

The answer is a dispatch value and nothing more: on the background-Agent
path a concrete model becomes the `Agent` call's literal `model`
(`haiku`/`sonnet`/`opus`/`fable`); an `Other` answer that names no concrete
model means leaving `model` out of the call.

---

## Assemble the handoff — one call to craft-handoff.js

No hand assembly — gather the judgment fields below, entirely from this
interview (no investigation, same rule as every other step here), then make
one call to `node ${CLAUDE_PLUGIN_ROOT}/scripts/craft-handoff.js`,
entry-less: no `"entry"` key, every field given inline instead. It resolves the touched paths,
assembles the XML from the canonical blocks, bakes the checkpoint/split
delivery artifacts, and runs the mechanical gate in-process — nothing left
here to re-derive or re-list. `tone`, `example`, `invariants`, and
`output_format` land only in a full-strength prompt, which most fresh
craft-prompt tasks are not; if the user picked one of those optional
sections and it did not make it in, say so plainly rather than acting as
if it had.

- `title` ← a short verb-first name for the task; `what` ← Call 2 Q4's
  answer (also what `resolve-symbols.js` scanned above for unresolved
  identifiers, so keep it the same text)
- `touches` ← Call 2 Q3's paths, as a plain array
- `request` ← one imperative sentence combining Call 1 Q1's task type and
  Call 2 Q2's done state
- `kind` ← `"decision"` only when the task being crafted is itself a
  decision — its deliverable is a choice between real alternatives, not an
  implementation; omit otherwise. `craft-handoff.js` bakes the
  `<decision_log>` block and the decision `task_rules` bullet from it
  automatically, exactly as `foreman:roadmap`'s pick branch does, when the
  render-sections result's `decisionLog.enabled` is also true. Name the doc
  after a short kebab slug of the goal — this task carries no roadmap entry
  id for `craft-handoff.js` to substitute.
- `destination` ← `"task"` for `Execute here`, `"agent"` for background
  Agent, `"clipboard"` for clipboard
- `split` ← `true` only when Call 5 picked `Execute here, split by check`
- `workflowStage` ← `true` only when Call 1 Q4 answered `Yes`
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
- `judgment.constraints` ← Call 4's Constraints answers, if selected, plus
  one more line for a review-flavored task (the `Code reviewer` role, or a
  task type the user described as a review or audit): "Flag only gaps
  that affect correctness or security — reporting that the work is sound
  is a valid outcome."
- `judgment.expectedFileSurface` ← Call 2 Q3's paths, as given; omit when
  no paths were named
- `judgment.verification` ← Call 3's `Run:`/`Expected:` pairs, in running
  order; a pure-investigation task omits this and carries `judgment.question`
  instead — the question under investigation, not a prescribed sequence
- `judgment.testFirst` ← `true` only for a silent-failure task — one whose
  breakage would pass the verification just gathered (see Call 3 Q4's
  note); omit it for a loud one
- `judgment.invariants` ← Call 3 Q4, when gathered and not
  `Nothing in particular`; omit otherwise
- `judgment.example` ← Call 4's Example answer, if selected, split into
  `{"before": "...", "after": "..."}`

Every plugin path this call's stdin JSON carries — and every path in the
returned `prompt` — is the literal string `${CLAUDE_PLUGIN_ROOT}`. Remember:
the copy of this skill you are reading has
the variable already resolved to a version-pinned cache path, and baking
that in breaks the prompt on the next version bump; the gate errors on it.
Type it back literally.

Returns one JSON line: `{ok, prompt, profile, signals, tasks?, gate,
warnings}`. `profile` and `signals` are internal bookkeeping — never name
either in anything the user reads. Surface any top-level `warnings`
verbatim whenever that array is non-empty — including when `ok` is `true`,
since a stale path or an unanswerable verification command has to be fixed
before delivery. When `ok` is `false`, don't retry blind:
feed the failing JSON back to yourself verbatim and act on it. Each entry
in `gate.errors` is `{error, fix, example}` — `error` names the judgment
field that's too thin, `fix` is the one action that clears it, and `example`
is the shape to copy when a literal helps more than a sentence. Show the
user `gate.errors` (and any `gate.warnings`), gather the named field
properly, and re-call — never resend the same stdin hoping it passes.

---

## Deliver

Deliver via whatever Call 5 picked, using the `prompt` (and `tasks[]` when
present) craft-handoff just returned — never re-derive, re-split, or
re-embed any of it; the checkpoint protocol for a multi-check clipboard
prompt and the task-split rows are already baked in.

- **`Execute here`** — one `TaskCreate` (`subject` a verb-first
  imperative ≤60 chars, `description` = `prompt`, `activeForm` its
  present-continuous form), then work it with `TaskUpdate` marking it
  `in_progress` then `completed`.
- **`Execute here, split by check`** — pass `"split":true` in the call
  above to get `tasks[]` (one row per `Run:`/`Expected:` pair, full prompt
  on row 1, already split); one `TaskCreate` per row, in order, each
  chained to the previous one with `TaskUpdate` `addBlockedBy:
  ["<previous task's id>"]`; work them in order. Follow the checkpoint
  protocol below as each task's check passes — there is no roadmap entry
  here, so nothing hooks into the task lifecycle the way
  `foreman:roadmap` handoffs do.

  **Checkpoint protocol** — the one copy lives in
  `${CLAUDE_PLUGIN_ROOT}/prompt-template.md`, section "Checkpointing a
  task-split run". Read that section now and follow it exactly: it owns
  the config defaults, the `safe-commit.js begin` boundary, the branch
  rule, the per-task commit, and what happens to the branch at the end.
  This is the only moment this skill reads that file.
- **Background Agent** — call `Agent` with `prompt` = the returned
  `prompt`, `description` = a 3-5 word summary, `run_in_background: true`,
  and `model` = Call 6's answer as its literal string
  (`haiku`/`sonnet`/`opus`/`fable`) when concrete; omit the `model`
  parameter entirely when the answer was an `Other` that didn't name a
  concrete model.
- **Clipboard** — `Write` the returned `prompt` to a temp file first, never
  as an inline shell string: a large prompt breaks shell
  quoting and the copy silently fails. Then pipe the file's content into
  the clipboard command: `Get-Content -Raw <file> | Set-Clipboard` on
  Windows, `pbcopy < <file>` on macOS, `xclip -selection clipboard <
  <file>` (or `wl-copy < <file>`) on Linux. Mention the file path too, in
  case the clipboard step fails. If no clipboard tool is available at all,
  show the prompt in a fenced `xml` code block instead — the one exception
  to never printing it into chat. Name Call 6's model in one line, so the
  user pastes it into the right kind of session. Any checkpoint protocol a multi-check prompt
  needs already rides inside `prompt`'s own `task_rules` — craft-handoff
  baked it in; nothing more to do here. A `Workflow stage` task also
  carries the JSON Schema artifact assembled in Call 4 — deliver it
  alongside `prompt` the same way (temp file + clipboard, or the second
  half of a `TaskCreate` description); it is never printed into chat
  either.

**Never paste or print the assembled XML prompt (or a Workflow-stage
schema) into your response text** — they are data for a tool call or a
temp file, not something to show the user, except the one clipboard
fallback above.
