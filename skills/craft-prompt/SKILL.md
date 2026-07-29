---
name: craft-prompt
description: Advanced surface, separate from Foreman's core roadmap job — a standalone prompt builder for work that has no roadmap entry behind it. Guides you through assembling a self-contained spawned-session prompt following Foreman's template — asks which optional sections to include, gathers required info via AskUserQuestion, assembles the XML, then runs it here as one or several tracked tasks, hands it to a background Agent, or copies it to the clipboard.
when_to_use: Trigger only on an explicit request to build or refine a standalone prompt — "craft a prompt", "build a prompt", "write me a prompt", "refine this prompt", "foreman prompt", or invokes /foreman:craft-prompt. An ordinary work request is not one of those: wanting something built, tracked, or handed to a background agent is roadmap work — it goes to the `foreman` entrance, which picks or adds the entry and builds the handoff itself.
argument-hint: "<brief task description — optional seed>"
allowed-tools: AskUserQuestion, TaskCreate, TaskUpdate, Agent, Read, Write, Bash, PowerShell
---

# foreman:craft-prompt — interactive prompt builder

Advanced tool, separate from Foreman's core job of keeping a project's
roadmap honest and handing off the next task from it. Ordinary work goes
through the `foreman` entrance, which builds its own handoff out of the
roadmap entry — nobody has to come here for that. This skill is for the
case with no roadmap entry behind it: a standalone prompt, asked for
explicitly.

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

**Q3** — "List the relevant files, naming the functions or classes that
matter in each. If an analogous implementation exists, name it too as a
pattern to imitate."
Options: `I'll list them` (nudge user to use Other and type paths like `src/auth/middleware.ts — refreshToken, verifySession`, plus `Pattern: src/webhooks/github.ts — build the new code the same way` when one applies. A line number only when the spot has no name — `resolve-symbols.js` fills the rest in below.)

**Q4** — "Describe the two steps: analyze/check, then implement/produce."
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

**Q4** — "What must stay true after this change? One observable assertion
per line — something a command could check, not the name of a contract."
Options: `Nothing in particular`
The answers fill the template's optional `<invariants>` block. Rephrase a
contract name into the assertion behind it before it goes in ("preserve
the identity-per-rebuild contract" → "rebuilding twice yields the same
ids"); if the user can't name the assertion, say that in the line rather
than passing the name through. `Nothing in particular` omits the block —
that is a normal answer, not a gap to push back on.

**Don't ask about the file surface or the test-first ordering** — both are
inferable and a second interview is the thing to avoid. The
`Expected file surface:` constraint line comes from Call 2 Q3's paths as
given. The test-first ordering goes into the verification block only when
this task's breakage would pass the checks Q1 just named — a silent
failure; a loud one leaves it out.

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
  Delivery: both artifacts travel together to the chosen destination — a
  clipboard temp file carries the prompt then the schema; a `TaskCreate`
  description carries both. The never-print-into-chat rule in Deliver below
  covers both.

---

## Resolve project config (craft-time, once)

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/render-sections.js` now — the one
mechanical call that resolves `usePersona`/`sections`/`omit`/`targetModel`/
`modelSuggestions`/`fableEnabled`/`decisionLog`. Its `modelSuggestions` and
`fableEnabled` fields are what gate Call 5c and Call 6 below. `craft-handoff.js`
resolves this same config again internally when it assembles, so this call
is only for those craft-time gating decisions, never for reuse in assembly.
Surface its `warnings` now, if any.

Once the file paths are known, run
`node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-symbols.js` in the same slot —
for the same reason: `craft-handoff.js` resolves the touched paths again on
its own when it assembles (from the `touches` field in the call below), so
this call exists only for the preflight next — catching a problem now,
before the interview continues, instead of discovering it after assembly.

<!-- [Foreman: 109] -->
Call 3 has already gathered the verification commands by this point, so
pass the first of them as `verify` in the same call and act on all three
preflight fields here rather than assembling around them:
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

## Call 5 — destination

Ask this now, before the prompt exists, not after assembly. There is
nothing to preview yet; the destination decides how the prompt gets
delivered, not the other way around.

**Q1** — "How do you want to run this?"
Options:
- `Execute here (Recommended)` — run it in this session
- `Execute with a background Agent` — offload it, get notified on completion — best for orchestration, where this session owns the commits
- `Copy prompt to clipboard` — just get the text, no execution

Never call `mcp__ccd_session__spawn_task` for any of these — it has a
known bug where tasks spawned through it don't get MCP tools. `TaskCreate`,
`Agent`, and the clipboard mechanics in Deliver below are the only three
delivery paths, regardless of Desktop or CLI.

---

## Call 5b — execution mode (conditional)

Ask this only when Call 5 Q1's answer was `Execute here`. The other two
destinations skip it and go to Call 6 instead — the two questions are
mutually exclusive.

**Q1** — "How should it run here?"
Options, in this order:
- `Tasks from the checks (Recommended)` — one tracked task per
  verification command, each finished task checkpointed as a commit on a
  dedicated branch
- `One task, then work it` — a single tracked task carrying the whole
  prompt
- `Run now, no tracking` — start immediately, no task rows

`AskUserQuestion` appends its own free-text option; never author one — a
user's free text naming the pieces, or a fixed number of tasks, both mean
"Tasks from the checks" cuts into that many slices at whatever verification
boundaries exist instead of one-per-check. Don't add a confirmation
question for either — the created rows are the preview, and a wrong one is
removed with `TaskUpdate` `status: "deleted"`.

---

<!-- [Foreman: 111] -->
## Call 5c — match the recommendation (conditional)

<!-- [Foreman: 116] -->
**Skip this call entirely unless the render-sections result's
`modelSuggestions` is `true`.** It defaults to `false`, and when it is
`false` no model or effort recommendation is made anywhere in this skill —
Call 6 still asks which model to dispatch on, just with no recommended
default and no `(Recommended)` label, and the Effort paragraph below states
nothing.

Ask this only when Call 5 Q1's answer was `Execute here`, once per handoff
and never once per task row, after Call 5b and **before the first task row
is created**. The other two destinations skip it — there the model is a
dispatch value Call 6 already asks for.

When this call does fire, read `${CLAUDE_PLUGIN_ROOT}/model-fit.md` once —
its "Model fit" and "Effort fit" notes are what both halves below judge
from. State BOTH halves of the recommendation in the question's context, in
one line each: the model per its "Model fit" note, and the effort per its
"Effort fit" note, each with the reason it follows from. This is the only
place the model half is ever said on this destination.

**Q1** — "This task suggests <model> at <effort>. Run it there instead?"

Never word this as raising, upgrading, or bumping the session. Foreman
cannot see what this session is running, so it cannot know whether the
recommendation is a step up, a step down, or already matched — a session
on Opus told a task suits Sonnet is being asked to go *down*. The question
names where the task fits and nothing about the distance to it.

Options:
- `Proceed as-is (Recommended)` — run at whatever this session already has
- `Start it in a fresh session` — the prompt goes to the clipboard, you open
  a session already set to <model> at <effort> and paste it there

Changing this session's model or effort in place is deliberately not on the
list: either change invalidates the prompt cache, so every remaining turn
re-reads the whole conversation. A fresh session pays that once, at the
shortest history it will ever have. A background `Agent` is not the
substitute either — that call takes a `model` but no effort argument.

When the user picks `Start it in a fresh session`, deliver exactly as the
`Copy prompt to clipboard` destination does and stop there; nothing runs in
this session and no task row is created.

Foreman cannot compare the two itself and must not try: hook input carries
no model at all, and reasoning effort is readable only inside a hook, never
by a skill. The user's answer IS the comparison, and the switch is theirs
to make — this never sets a model, never blocks, and never records
anything. Neither recommendation is written into the assembled prompt.

---

## Call 6 — executing model (conditional)

Ask this when Call 5 Q1's answer was "Execute with a background Agent"
or "Copy prompt to clipboard" — its default depends on that answer, so
it can't batch into Call 5's own question. Skip it for **`Execute here`**:
that destination runs the task in this session, so there is no dispatch
value to set (Call 5b and Call 5c run instead) — Call 5c is where both
halves of the recommendation get said and acted on there, when
`modelSuggestions` is `true`.

**Q1** — background Agent: "Which model should the background Agent run
on?" Clipboard: "Which model will run the pasted prompt?"
`Haiku`, `Sonnet`, `Opus` always; `Fable` too, but only when the
render-sections result's `fableEnabled` is `true` — three options when
it's `false` (the default), four when it's `true`.

When `modelSuggestions` is `false` — the default — the options are offered
in their plain order with no `(Recommended)` label and no why-line: the
question still has to be asked because a dispatch needs a model named, but
Foreman is not in the business of suggesting one for this project.

The rest of this call applies only when `modelSuggestions` is `true`.
Reordered so the
**recommended** model leads, with `(Recommended)` appended to its label —
same convention `foreman:roadmap`'s Q1 uses for its top-ranked candidate.
Read `${CLAUDE_PLUGIN_ROOT}/model-fit.md` once here (skip the read when
`modelSuggestions` is `false` — there is nothing in it for that case). The
recommendation is the resolved `targetModel` when the project pinned
a concrete one; otherwise (`inherit`) judge it from the task the user
described against its "Model fit" note. A `targetModel:
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
- **Confirmation**: this is the model actually running the task, on record
  for the delivery message even when it differs from the project's
  declared `targetModel` — `craft-handoff.js` still assembles at the level
  the resolved `targetModel` implies (full default shape when `inherit`);
  it does not yet retune elaboration to a confirmed dispatch model.
- **Dispatch** (background Agent only): a concrete model becomes the
  `Agent` call's literal `model` value (`haiku`/`sonnet`/`opus`/`fable`);
  an `Other` answer that doesn't name a concrete model means leaving
  `model` out of the call.

**Effort** — stated only when `modelSuggestions` is `true`; say nothing
about effort at all when it is `false`. Recommended, never asked and never
dispatched. Judge it from
`${CLAUDE_PLUGIN_ROOT}/model-fit.md`'s "Effort fit" note — the verification commands
gathered above are the input, so this is decided after them, not before —
and state it in one line of the delivery message: the setting and the
verification-cost reason it follows from ("two runnable checks — medium,
escalate if one fails"). No question, because there is nothing to wire the
answer to: the `Agent` tool takes no effort argument, and effort is a
per-call parameter rather than project config. Say it on every
destination, `Execute here` included — this session's own effort is the
one it applies to there, and Call 5c is where it gets said and answered.

---

## Assemble the handoff — one call to craft-handoff.js

No hand assembly and no reading `prompt-template.md` — gather the judgment
fields below, entirely from this interview (no investigation, same rule as
every other step here), then call
`${CLAUDE_PLUGIN_ROOT}/scripts/craft-handoff.js` entry-less: no `"entry"`
key, every field given inline instead. `craft-handoff.js` resolves the
touched paths, computes the handoff profile from the same five mechanical
signals `foreman:roadmap` uses, assembles the XML from the canonical
blocks, bakes the checkpoint/split delivery artifacts, and runs the
mechanical gate in-process — nothing left here to re-derive or re-list.
`tone`, `example`, `invariants`, and the default `output_format` are
included only when the returned `profile` comes back `reinforced` (a
decision-kind or no-verification task always qualifies; most fresh
craft-prompt tasks don't) — say so if the user picked one of those
optional sections and the returned `profile` is `standard`, rather than
acting as if it made it into the prompt.

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
- `split` ← `true` only when Call 5b picked `Tasks from the checks`
- `workflowStage` ← `true` only when Call 1 Q2 selected `Workflow stage`
- `customTone` ← Call 4's Tone answer, if selected (top-level field,
  outside `judgment`)
- `judgment.role`/`judgment.goal` ← Call 2 Q1/Q2
- `judgment.context` ← Call 4's Background-context answer, if selected,
  plus Call 3 Q3's observed failure, when gathered and not
  `None observed`, under an `Observed failure:` line, verbatim
- `judgment.steps` ← Call 2 Q4's answer, split into implement/fix bullets
- `judgment.constraints` ← Call 4's Constraints answers, if selected, plus
  one more line for a review-flavored task (the `Security audit` task
  type, or the `Code reviewer` role): "Flag only gaps that affect
  correctness or security — reporting that the work is sound is a valid
  outcome."
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
- `output_format` ← no field on this call carries a custom XML tag; the
  returned prompt uses the default (present only when `profile` comes back
  `reinforced`) regardless of Call 4's Custom-output-format answer — say so
  to the user rather than silently substituting the default. `Workflow
  stage` is different: `workflowStage` above is wired all the way through.

Every plugin path this call's stdin JSON carries — and every path in the
returned `prompt` — is the literal string `${CLAUDE_PLUGIN_ROOT}`. Remember:
the copy of this skill you are reading has
the variable already resolved to a version-pinned cache path, and baking
that in breaks the prompt on the next version bump; the gate errors on it.
Type it back literally.

Returns one JSON line: `{ok, prompt, profile, signals, tasks?, gate,
warnings}`. When `ok` is `false`, don't retry blind: show `gate.errors`
(and any `gate.warnings`) to the user — each names the judgment field
that's too thin — gather that field properly and re-call, rather than
resending the same stdin hoping it passes. `craft-handoff.js` bakes the
fixed closing paragraph's closure-evidence rule automatically — closure
notes and findings describe only observed work and cite supporting files,
commands, commits, or outcomes; planned scope is never evidence that it
was executed.

---

## Deliver

Deliver via whatever Calls 5 and 5b picked, using the `prompt` (and
`tasks[]` when present) craft-handoff just returned — never re-derive,
re-split, or re-embed any of it; the checkpoint protocol for a multi-check
clipboard prompt and the task-split rows are already baked in.

- **`Execute here`**:
  - `Run now, no tracking` — work `prompt` directly in this session; no
    task rows.
  - `One task, then work it` — one `TaskCreate` (`subject` a verb-first
    imperative ≤60 chars, `description` = `prompt`, `activeForm` its
    present-continuous form), then work it with `TaskUpdate` marking it
    `in_progress` then `completed`.
  - `Tasks from the checks` — pass `"split":true` in the call above to get
    `tasks[]` (one row per `Run:`/`Expected:` pair, full prompt on row 1,
    already split); one `TaskCreate` per row, in order, each chained to the
    previous one with `TaskUpdate` `addBlockedBy: ["<previous task's id>"]`;
    work them in order. Follow the checkpoint protocol below as each task's
    check passes — there is no roadmap entry here, so nothing hooks into
    the task lifecycle the way `foreman:roadmap` handoffs do.

    **Checkpoint protocol — two or more tasks only.** Read the
    `checkpoints` block of `.foreman/config.json` first (`branch` `true`,
    `onFinish` `"ask"`, `baseBranch` unset are the defaults for a missing
    file/block/key). Before task 1:
    `node ${CLAUDE_PLUGIN_ROOT}/scripts/safe-commit.js begin` — a
    `dirty:true` result means this run makes no automated commits at all:
    say so once, work the tasks, and leave every change in the tree for
    the user. Otherwise settle the branch (create `foreman/<slug>` only
    when `branch` is `true` and currently on the base branch — `baseBranch`
    when set, or detect it with
    `git symbolic-ref --short refs/remotes/origin/HEAD`, name after
    `origin/`, fallback `main`); then, after each task's check passes:
    `echo '{"expected":["<files that task changed>"],"message_title":"task <n>/<total>: <task subject>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/safe-commit.js finish --baseline <the current baseline>`
    — never `git add -A`, the primitive owns staging, and its `commit` is
    the next task's baseline. After the last task, and only if this run
    created the branch, `onFinish` decides its fate: `"ask"` (the default)
    asks `Squash merge (Recommended)` / `Merge` / `Open a PR` / `Keep the
    branch`; a concrete value acts directly, no question. Skip
    checkpointing and just work the tasks if git is unavailable.
- **Background Agent** — call `Agent` with `prompt` = the returned
  `prompt`, `description` = a 3-5 word summary, `run_in_background: true`,
  and `model` = Call 6's answer as its literal string
  (`haiku`/`sonnet`/`opus`/`fable`) when concrete; omit the `model`
  parameter entirely when the answer was an `Other` that didn't name a
  concrete model.
- **Clipboard** — `Write` the returned `prompt` to a temp file first —
  never pass it as an inline shell string, a large prompt breaks shell
  quoting and the copy silently fails. Then pipe the file's content into
  the clipboard command: `Get-Content -Raw <file> | Set-Clipboard` on
  Windows, `pbcopy < <file>` on macOS, `xclip -selection clipboard <
  <file>` (or `wl-copy < <file>`) on Linux. Mention the file path too, in
  case the clipboard step fails. If no clipboard tool is available at all,
  show the prompt in a fenced `xml` code block instead — the one exception
  to never printing it into chat. If the effective target model (Call 6's
  answer, else `targetModel`) is concrete, add one more line: "Recommended
  model: [Haiku/Sonnet/Opus/Fable] — this prompt's elaboration level was
  calibrated for it." Skip that line when it resolved to `inherit` or no
  concrete model was named. Any checkpoint protocol a multi-check prompt
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
