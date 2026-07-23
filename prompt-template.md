# Foreman — prompt template

<!-- foreman:practices lastmod:2026-07-23
     source-a: https://code.claude.com/docs/en/best-practices.md
     source-b: https://code.claude.com/docs/en/sub-agents.md
     source-c: Anthropic Prompting 101 — Code w/ Claude 2025-05-22
     source-d: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5
     source-e: Claude Code 2.1.214 embedded delegation guidance
     source-f: https://code.claude.com/docs/en/prompt-library.md -->

The handed-off session — whether run here in this session, by a
background `Agent`, or copy-pasted elsewhere — has **zero memory** of this
conversation. Fill every required section. A self-contained prompt is not
optional — it is the only way the handed-off work can act correctly.

---

## Template

**Craft-time environment check (do this now, once, while assembling — not
an instruction for the spawned session to act on later):**

0. **One mechanical call covers persona/custom-sections/omissions/model-
   scoping.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/render-sections.js`
   — always (it resolves a project root from `$CLAUDE_PROJECT_DIR`/cwd and
   fails soft to defaults when no `.foreman/config.json` exists). One JSON
   object: `{"usePersona": bool, "sections": [{"tag", "xml"}], "omit":
   [...], "targetModel": "haiku"|"sonnet"|"opus"|"fable"|"inherit",
   "fableEnabled": bool, "decisionLog": {"enabled": bool, "dir": string},
   "warnings": [...]}`.
   All of it is project **declaration** — foreman never inspects
   which style plugins or model the operator runs.
   - `usePersona` — default `true` when missing/unparseable. Controls only
     the opening of `task_context` below: persona sentence vs domain
     framing.
   - `sections` — the config's validated `customSections`. Inline every
     `sections[].xml` value verbatim, in order, at the `[CUSTOM SECTIONS]`
     placeholder below — never invent, edit, or reorder; remove the
     placeholder line if empty.
   - `omit` — the config's validated `omitSections` (only `tone`/
     `example`/`background`/`output_format` are ever valid; guardrail tags
     can't appear). Drop each listed block from the assembled prompt — a
     project-level omit beats a per-prompt selection. One
     destination-scoped exception: an omitted `tone` STAYS when the chosen
     destination is a background `Agent` — output styles govern only
     main-loop sessions (a pasted interactive session, or an `Execute here`
     run), never a background agent's, so the omission's premise fails
     there; the kept default still self-yields if a style does govern. The
     other three tags have no destination dependence.
   - `targetModel` — default `"inherit"` whenever the field is missing,
     unparseable, or not one of the five valid strings (that last case
     also adds a `warnings` entry). It sets only how much elaboration
     `relevant_files`/`context`/`task_rules` below carry, never a claim
     about what the target model will actually manage. The effective model
     is always the executing-model answer confirmed at craft time
     (`craft-prompt`'s Call 6, `foreman:roadmap`'s dispatch step). Foreman
     seeds that answer's recommended default: a concrete `targetModel` pin
     in config when the project set one, otherwise a per-task recommendation
     judged from the task's own fit (see "Model fit" below). A confirmed
     concrete answer tunes elaboration to that model; an inherit/unknown
     answer keeps the full default shape:
     - `haiku` — elaborate fully: name the exact symbol or behavior at
       stake in `context`, not just the file; write the verification
       block's `Expected:` line as the literal output or exit code, not a
       category; one concrete action per `task_rules` bullet, nothing
       compounded. Grounded in Foreman's own handoff benchmark: on Haiku,
       the most-detailed of the structured prompt formats tested posted
       the lowest reads-before-first-edit of the three on every fixture
       measured, at equal-or-better correctness — thoroughness measurably
       cut this model's exploratory overhead, never added to it.
     - `inherit` — assemble exactly as already described above; do not
       add elaboration beyond what the gathered answers actually
       supplied. No declared target to tune for, so the full default
       shape stays.
     - `sonnet`, `opus`, `fable` — assemble at the default level, and
       leave the read-first/run-first micro-step bullets out of
       `task_rules`: state what to change, the constraints, and the
       verification block — the model sequences its own exploration.
       Grounded for `fable` in the official Fable prompting guide
       (source-d, brief steering beats enumerating) plus Foreman's own
       probe, and for `sonnet` and `opus` in first-party probes across
       all three trap fixtures: equal correctness and trap compliance,
       lower cost in every cell, turns never higher.

     **Model fit** — how to seed the recommended default when `targetModel`
     is `inherit`; a recommendation the operator confirms or overrides,
     never an automatic switch. Judge from the task's own `what`/`touches`,
     recorded fields only:
       - `haiku` for mechanical, well-scoped work — a single file or a
         bounded change with an unambiguous spec. Cheapest, and per the
         elaboration note above a fully-spelled-out Haiku prompt cut its
         own exploration overhead at equal correctness.
       - `sonnet` or `opus` when the task turns on judgment — design
         decisions, ambiguity, cross-cutting `touches`, or logic no spec
         pins down.
       - one caution: a `what` that reconciles stale, renamed, or
         conflicting references hit a proven capability cliff on Haiku in
         every prompt format tested — recommend Sonnet/Opus there whatever
         the scope. Never bake this into the assembled prompt: the target
         model never sees a description of its own expected failure modes.
       - `fable` as orchestrator, only when step 0's `fableEnabled` is
         `true` AND the task carries two or more `Run:`/`Expected:` pairs
         (the same boundary the task split and the clipboard checkpoint
         embed cut on): offer `Fable — orchestrates workers per slice` in
         Haiku's slot — a multi-check task is past Haiku's fit anyway.
         Picking it includes the `<orchestration>` block below. Grounded
         in Foreman's own probe: on single-slice tasks orchestration
         matched direct Fable on correctness and cost at double the wall
         clock — delegation only pays where independent slices exist, so
         the option never appears without them.
   - `fableEnabled` — boolean declaration (default `false`) that the
     operator can run Fable 5 at all (Max plan or API — other plans
     can't). Declaration, not detection, same as `targetModel` — a
     hand-set `.foreman/config.json` key, no init question. It only
     widens the executing-model question per the Model-fit bullet above;
     it never changes elaboration by itself. A `targetModel: "fable"` pin
     still means direct Fable (Opus's slot, no orchestration) — when both
     rules apply, the orchestrator option wins the offer and Opus keeps
     its slot.
   - `decisionLog` — `{enabled, dir}`, the project's declaration of the
     decision-log feature (default `{enabled:false, dir:"docs/foreman"}`).
     When `enabled` is `true`, include the `<decision_log>` block below,
     substituting `dir` for every `<dir>`; when `false`, omit that block
     entirely. `dir` is a relative path the destination writes ADR docs
     under.
   - `warnings` — surface briefly to the user (skipped entries from a
     malformed config); never blocks assembly.

```xml
<task_context>
[If step 0's `usePersona` is `true`: "You are [specific role — e.g. "a
senior security engineer", "a TypeScript developer"]." If `false`: a
persona is established elsewhere — use domain framing, "Domain: [specific
role/specialization].", never a second "You are a" sentence.]
Your goal is [one sentence — what "done" looks like for this specific task;
a performance or coverage goal names the metric and threshold, e.g. "p95
under 500ms", so completion is checkable rather than declared].
[One more sentence when the purpose is known — what this output feeds and
who it's for, e.g. "This informs a PR description — focus on user-facing
changes." It lets the session calibrate depth and emphasis; drop the line
when there's nothing beyond the goal itself.]
</task_context>

<truth_grounding>
Before acting on anything in this prompt, verify it against the current state
of the codebase — read the cited files, run the cited commands. This prompt
may have been written earlier and executed later (queued via TaskCreate, run
by a background Agent, or pasted into a fresh session); treat every claim
below as a hypothesis to confirm at the start of this session, never as a
fact to assume. If reality contradicts this prompt, trust reality and
proceed from what you actually find — and treat the mismatch itself as part
of the outcome: state it in one line of your final message (and in the
roadmap entry's notes, if this task closes one). A minimal register trims
narration, never a found discrepancy.
</truth_grounding>

<scope_discipline>
If a request mid-session asks for something beyond this task's stated goal
above, don't fold it in silently — flag it to the user first. Once it's
actually done, check whether ROADMAP.jsonl exists at the project root: if
it does, log the extra work as its own entry instead of stretching this
task's story to cover it — it already happened, so create it and close it
out in the same breath rather than leaving it "planned":
echo '{"title":"...","why":"...","what":"...","source":"claude-suggested","status":"planned"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js add
then, using the id just returned:
echo '{"id":"<new-id>","status":"done","commit":"<sha>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status
(touches auto-derives from that commit, same as any other completion). If
no ROADMAP.jsonl exists, flagging it to the user is enough — nothing to
log. This doesn't apply to legitimate refinement of this task's own
scope — only to work that's genuinely a separate concern from
`task_context` above.
</scope_discipline>

[If step 0's `decisionLog.enabled` is true, include the `<decision_log>`
block below verbatim — substitute the resolved `dir` for every `<dir>`,
and this task's roadmap entry id for every `<entry-id>` (a craft-prompt
task with no entry id names the doc after a short kebab slug of the goal
instead). When `enabled` is false (the default), omit the whole block.]
<decision_log>
Before editing a file, scan it for `[Foreman: <id>]` anchor comments; when present, read the listed docs under `<dir>/` first.
When this task decides between real alternatives, write `<dir>/<entry-id>.md` before closing, in this shape:
  ---
  id: <entry-id>
  title: <imperative title>
  date: <YYYY-MM-DD>
  supersedes: [<id>, ...]   # optional whole-doc key; omit when nothing is superseded
  ---
  ## Decision — the choice, named, in one paragraph
  ## Context — the constraint that forced it
  ## Alternatives rejected — one line each: the option and the single reason it lost
  ## Consequences — what future work is committed to, plus any never-touch warning
  ## Findings — optional; drop when empty
Cite functions by name, never file:line. Never edit an existing decision doc backward — a reversal is a new doc that cites the old one in `supersedes`.
Mark each code site the decision governs with an ID-only `[Foreman: <entry-id>]` anchor comment in the file's own comment syntax; append your id to any anchor already there — `[Foreman: 019, 034]`.
When closing the entry, pass `doc` in update-status: the doc path, or `"none"` when nothing was decided.
</decision_log>

[If `"tone"` is in `omit` (from `render-sections.js`), drop this whole
`<tone>` block — unless the chosen destination is a background `Agent`,
where step 0's carve-out keeps the default below in place (no output style
reaches that session, so the opt-out's premise doesn't hold there).
Separately, if the Workflow-stage output flavor was selected (see the
`<output_format>` block below), drop this whole `<tone>` block
unconditionally instead — a schema-forced stage has no prose surface for
voice to govern, and the background-Agent carve-out above does not extend
to this flavor.]
<tone>
[If Tone was selected as an optional section: the user's custom tone,
full stop — it replaces everything below. Otherwise include: "Minimal,
professional conversation — silent by default, say only what the user
actually needs to know, simplify technical explanations, avoid unnecessary
jargon. If an output style already governs this session's voice, defer to
it — this tone applies only in its absence."]
</tone>

[If `"background"` is in `omit`, drop this whole `<background>` block
unconditionally. Otherwise, step 0's `targetModel` sets how much
elaboration `relevant_files` and `context` below carry — see its bullet.]
<background>
<relevant_files>
[Exact file paths with line ranges for every file the task touches.
Example: src/auth/middleware.ts:42-80 — token refresh logic
Include every file. No vague references like "the auth module".
When an analogous implementation exists, add one reference line —
Pattern: src/webhooks/github.ts — build the new code the same way
— a named reference beats general best practices.]
</relevant_files>
<context>
[Architectural decisions, constraints, patterns already in use.
Anything needed to understand the codebase without prior conversation.
Example: "Uses JWT tokens in httpOnly cookies. No third-party auth libs."
For a bug fix, include the observed failing output verbatim under an
"Observed failure:" line — the artifact itself, not a paraphrase of it.]
</context>
</background>

[Step 0's `targetModel` also sets how much elaboration these bullets and
the verification block carry — see its bullet.]
<task_rules>
[Pure-investigation handoff: replace the three step bullets below with the
question under investigation plus any exact commands worth running — hand
over the question, not a prescribed exploration sequence. Implementation
tasks keep the bullets.]
- [What to read or explore first]
- [What to analyze or check next]
- [What to implement, fix, or produce]

Constraints:
- [Hard limits — files NOT to modify, interfaces NOT to break]
- [Style or pattern to follow — point to an example file if one exists]

Verification (REQUIRED):
Run: [exact command — e.g. "npm test -- --testPathPattern=auth"]
Expected: [pass/fail signal — e.g. "all tests pass", "exit code 0"]
[Repeat the Run:/Expected: pair, in running order, for every check the
task actually has. An `Execute here` task split cuts on these boundaries —
see the splitting section below.]
Do NOT claim success without running this. If it fails, iterate until it passes.
</task_rules>

[ORCHESTRATION — include the block below verbatim only when the confirmed
executing model is the Fable-orchestrator option (step 0's `fableEnabled`
bullet: `fableEnabled` true, two or more `Run:`/`Expected:` pairs, and the
operator picked it). Omit it entirely for every other model answer,
including a direct-Fable `targetModel` pin.]
<orchestration>
You orchestrate this task — you never write code yourself. Do not call Edit
or Write on any file. For each Run:/Expected: slice above, dispatch one
implementer subagent (the Agent tool, model "sonnet" — "opus" for a slice
that turns on judgment) with a self-contained brief: the files to change,
the exact change, the constraints above, and that slice's verification
command. When it returns, review the work yourself — read the changed
files — and run the slice's check before accepting; if it falls short,
dispatch a corrected follow-up naming the specific gap it missed instead
of fixing it by hand. Workers share
this working tree: dispatch slices one at a time, in their stated order,
unless two slices touch disjoint files. Reading files and running commands
yourself is fine — writing code is the one thing you always delegate.
</orchestration>

[CUSTOM SECTIONS — inline each `sections[].xml` from `render-sections.js` here,
verbatim, in order; omit this whole line if `sections` was empty]

[OPTIONAL — include only when the task has a clear before/after pattern.
If `"example"` is in `omit`, drop this whole block unconditionally, even
if Call 1 selected it.]
<example>
[Before snippet or input → After snippet or expected output]
</example>

[The immediate, specific request in one sentence.]

Reason through the approach and edge cases in your thinking before editing — not in prose between tool calls. The steps and commands above are a working plan, not a narration script: whatever output style governs this session decides what you say aloud, so don't announce step transitions or restate command results in chat. The same style governs the register of your final message. Full evidence and findings belong in their durable home — the roadmap entry, the commit message, or the artifact the task names — with the final message stating the outcome and pointing there.

[BACKGROUND-AGENT DESTINATION — if the chosen destination is a background
`Agent`, include the following paragraph verbatim right here. It is the
official autonomous-operation reminder (source-d); the agent harness does
not carry it (probe-confirmed), and a background agent has no user to
answer a question. Omit it for the other two destinations — an
`Execute here` or pasted session has a user present.
You are operating autonomously. The user is not watching in real time and
cannot answer questions mid-task, so asking "Want me to…?" or "Shall
I…?" will block the work. For reversible actions that follow from the
original request, proceed without asking. Offering follow-ups after the
task is done is fine; asking permission before doing the work is not.
Before ending your turn, check your last paragraph. If it is a plan, an
analysis, a question, a list of next steps, or a promise about work you
have not done ("I'll…", "let me know when…"), do that work now with tool
calls. End your turn only when the task is complete or you are blocked on
input only the user can provide.]

[If `"output_format"` is in `omit`, drop this whole block unconditionally,
even if Call 1 selected `Custom output format`.]
<output_format>
Give a concise, human-readable summary: what changed, and the verification
result. No XML tags in the visible response — a human reads this directly
in chat by default, and raw `<tag>` markers read as a bug, not structure.
[Only if something downstream actually parses this output — a script, a
following automated step — name a specific XML tag here explicitly and say
who/what consumes it. Otherwise omit this bracket entirely; don't wrap by
default "just in case".]
</output_format>

[WORKFLOW-STAGE FLAVOR — if the output-format selection was "Workflow
stage" (prompt plus a JSON Schema the tool layer enforces, for a Workflow
`agent(prompt, {schema})` stage), it overrides both blocks above instead of
using them:
- Drop the `<tone>` block unconditionally (see the note above) — a
  schema-forced stage has no prose surface for voice to govern.
- Replace the whole `<output_format>` block above with this single fixed
  sentence, no XML tags:
  Your return value is enforced by the attached schema; your final text is
  the return value, not a human-facing message.
- Assemble a second artifact alongside the prompt: a fenced `json` JSON
  Schema derived from the user's answer to "what should come back".
  Authoring rules: object root with a `required` array; a `description` on
  every property (descriptions double as instructions to the
  StructuredOutput layer); enums for verdict-like fields; for
  evidence-bearing claims use the cited-pair shape `{"cite": "file:line or
  doc URL", "note": string}`; keep schemas small — every validation retry
  costs a full subagent turn.
- Delivery: both artifacts travel together to the chosen destination — a
  clipboard temp file carries the prompt then the schema; a `TaskCreate`
  description carries both. The never-print-into-chat rule covers both
  artifacts.]
```

---

## Checklist (verify before handoff)

- [ ] `task_context` names a specific role (domain framing when
      `usePersona` was `false`) and a concrete one-sentence "done" state
- [ ] `truth_grounding` present, unmodified — every handoff carries it
- [ ] `scope_discipline` present, unmodified — every handoff carries it
- [ ] `render-sections.js` ran once at craft time (never deferred to the
      spawned session) and its `usePersona` field — not a fresh `Read` or
      flag check — drove `<task_context>`; its `targetModel` field —
      overridden by a concrete executing-model answer when the crafting
      flow gathered one — drove how much elaboration went into
      `relevant_files`/`context`/`task_rules` below
- [ ] `relevant_files` lists every file path with line ranges — no vague
      references (`craft-prompt`: from the user directly; `foreman:roadmap`:
      the entry's `touches` passed through as-is, never upgraded by
      exploring the codebase — `truth_grounding` covers that gap at
      handoff time)
- [ ] `task_rules` has read/analyze/implement steps AND a runnable
      verification command with expected output (a pure-investigation
      handoff carries the question plus exact commands instead of steps;
      a `sonnet`-, `opus`-, or `fable`-target handoff carries the
      implement step without the read/run micro-steps; the gate's
      `--research` flag waives the verification pair)
- [ ] custom sections were rendered by `render-sections.js` and inlined
      verbatim after `task_rules` — never hand-written — and its
      `warnings` were surfaced to the user
- [ ] `<decision_log>` present iff step 0's `decisionLog.enabled` was
      `true`, with `dir`/`<entry-id>` substituted (absent by default)
- [ ] `<orchestration>` present, verbatim, iff the confirmed executing
      model was the Fable-orchestrator option (absent by default)
- [ ] every tag in `omit` is absent from the assembled prompt, overriding
      a conflicting per-prompt selection (exception: an omitted `tone`
      stays for a background-`Agent` destination — step 0's carve-out);
      guardrail/core blocks are never affected
- [ ] no "as we discussed" / "from earlier" — zero assumed context
- [ ] a verb-first imperative name (under 60 chars) and a 1–2 sentence
      plain-language summary are ready — `TaskCreate` and a background
      `Agent` both need them
- [ ] the destination (`Execute here` / background `Agent` / clipboard) was
      decided *before* assembly, and the raw XML never appears in the chat
      response (clipboard's no-tool fallback is the only exception)
- [ ] Workflow-stage flavor (if selected): `<tone>` was dropped
      unconditionally, `<output_format>` was replaced by the fixed
      enforcement sentence, and a JSON Schema artifact was assembled and
      travels with the prompt to the destination

## Mechanical gate (REQUIRED, after the checklist)

The checklist items a script can verify, verified by a script. `Write` the
assembled prompt to a temp file (the clipboard delivery path needs that
file anyway), then run:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/check-prompt.js <file> --destination <task|agent|clipboard>
```

- `--destination` — `task` for `Execute here` in any of its execution
  modes, `agent` for a background Agent, `clipboard` for copy. This is how
  the checker knows whether an omitted `tone` must stay (agent) or go.
- `--entry <id>` — add for a `foreman:roadmap` pick, so the embedded
  entry paragraph is verified too; add `--resume` when the pick resumed
  an `in_progress` entry.
- `--research` — add for a pure-investigation task with no verification
  command.
- `--workflow-stage` — add when the Workflow-stage flavor was selected.
- `--orchestration` — add when the confirmed executing model was the
  Fable-orchestrator option, so the `<orchestration>` block is verified
  verbatim (and flagged if it rides along uninvited).

`{"ok":true}` is the gate: fix every error and re-run until it passes —
never deliver a prompt the checker rejected. Surface its `warnings`
alongside the delivery message. The checker validates structure (guardrail
blocks verbatim, no unfilled placeholders, omit compliance, verification
present); it can't judge content quality — the checklist above still
applies to what the fields actually say.

## Delivery mechanics

Shared by every skill that assembles this template. The skill decides
*which* destination applies and in what order it offers them; this section
says what each one does once picked.

**Never call `mcp__ccd_session__spawn_task`** — it has a known bug where
tasks spawned through it don't get MCP tools. Use one of the three
destinations below instead, regardless of Desktop or CLI.

**Execution-mode options** — asked only when the destination is `Execute
here`, and asked separately: it decides how the work is tracked, not what
the prompt says, so it can't batch into the destination question. The other
two destinations skip it entirely.
- `Tasks from the checks (Recommended)` — one tracked task per
  verification command, each finished task checkpointed as a commit on a
  dedicated branch
- `One task, then work it` — a single tracked task carrying the whole
  prompt
- `Run now, no tracking` — start immediately, no task rows

`AskUserQuestion` appends its own free-text option; never author one. That
free text is where a user names the pieces, or gives a fixed number of
tasks — the splitting section below says what to do with a bare number.

**`Execute here`** — the execution-mode answer picks which of these runs.
- `Run now, no tracking` — no task rows at all. Work the assembled prompt
  in this session directly.
- `One task, then work it` — call `TaskCreate` with `subject` = a verb-first
  imperative ≤60 chars, `description` = the assembled XML prompt,
  `activeForm` = its present-continuous form. Then work the task in this
  session, using `TaskUpdate` to mark it `in_progress` then `completed`.
- `Tasks from the checks` — the same `TaskCreate` shape per row, split and
  chained exactly as the splitting section below describes. Then work them
  in order, `TaskUpdate` per row as you go, committing each finished task
  as the checkpointing section below describes.

**Background Agent** — call `Agent` with `prompt` = the assembled XML
prompt, `description` = a 3-5 word summary, `run_in_background: true`.
Checkpoint branches and commits stay with this crafting session — a
background Agent shares this working tree and must not switch branches or
commit checkpoints.

**Clipboard** — `Write` the assembled prompt to a temp file first; never
pass it as an inline shell string, a large prompt breaks shell quoting and
the copy silently fails. Then pipe the file's content into the clipboard
command: `Get-Content -Raw <file> | Set-Clipboard` on Windows, `pbcopy <
<file>` on macOS, `xclip -selection clipboard < <file>` (or `wl-copy <
<file>`) on Linux. Mention the file path too, in case the clipboard step
fails. If no clipboard tool is available at all, fall back to showing the
prompt in a fenced `xml` code block instead.

**Clipboard checkpoint embed** — only when the assembled prompt carries
two or more `Run:`/`Expected:` pairs; with one or none, embed nothing.
The pasted session never reads this file, so the protocol must ride
inside the prompt itself: at craft time, resolve the `checkpoints` block
of `.foreman/config.json` exactly as the checkpointing section below
describes (same keys, same defaults), then append a compact block to the
end of `task_rules` with the resolved values baked in — never the
resolution rules themselves. Keep it to a dozen imperative lines,
instructing the pasted session to:
- create one tracked task per `Run:`/`Expected:` pair and chain each to
  the previous one;
- settle the branch first — name the baked base branch, or bake the
  detection line (`git symbolic-ref --short refs/remotes/origin/HEAD`,
  name after `origin/`, fallback `main`) when `baseBranch` was unset;
  with `branch` `true`, create `foreman/<slug>` only when on the base
  branch, otherwise checkpoint in place (with `branch` `false`, always
  in place);
- after each task's check passes, `git add -A` and commit
  `task <n>/<total>: <task subject>`; push per the baked `push` value;
- after the last task, apply the baked `onFinish` — `"ask"` asks the
  user squash/merge/PR/keep, a concrete value acts directly — only when
  the run created the branch;
- skip checkpointing and just work the tasks if git is unavailable.

**Never paste or print the assembled XML prompt into your response text** —
it is data for `TaskCreate`'s `description`, `Agent`'s `prompt`, or a temp
file piped to clipboard, not something to show the user. The one exception
is the clipboard fallback block above, used only when no clipboard tool
exists.

## Splitting an `Execute here` handoff into several tasks

Only for the `Execute here` destination, and only when its execution-mode
question asked for several tasks. Every other destination, and the
single-task mode, skips this section entirely.

- **Slice at verification boundaries** — one task per runnable check. Never
  slice the read/analyze/implement bullets: a `sonnet`, `opus`, or `fable`
  target doesn't carry them at all, so there is nothing there to cut. Never
  slice by file either — `touches`-style groupings are unverified guesses,
  not a schedule. One check means one task; say so and move on rather than
  inventing slices to reach a number.
- **The first task carries the whole assembled prompt** in its
  `description`. Every later task's `description` is short: its own goal,
  the files it touches, and its own verification command with the expected
  result. They run in this same session and share its context —
  `truth_grounding` guards a cold start, which a sibling task is not.
- **Chain them.** Once the rows exist, one `TaskUpdate` per task from the
  second onward with `addBlockedBy: ["<the previous task's id>"]`. The
  harness then refuses to start a task before its predecessor resolves,
  which is what makes "the last task" mean anything.
- **A roadmap entry paragraph goes on the last task only**
  (`foreman:roadmap` handoffs — `craft-prompt` assembles no such
  paragraph). `hooks/task-completed.js` gates every completing task whose
  description names an entry, so repeating that paragraph on each row would
  demand the entry be closed `done` while its siblings are still pending.
  Hold it out of the first task's description and put it verbatim in the
  last one's — `hooks/task-created.js` still opens the entry the moment
  that last row is created, which is before any of the work starts.
- **A fixed number** (the execution-mode question's free-text answer) cuts
  into that many slices at whatever verification boundaries exist. Don't add
  a confirmation question — the created rows are the preview, and a wrong
  one is removed with `TaskUpdate` `status: "deleted"`.
- The mechanical gate above runs **once**, on the assembled prompt, with
  `--destination task`. Splitting is a delivery-layer choice and changes
  nothing the checker inspects.

## Checkpointing a task-split run

Only for the `Tasks from the checks` execution mode, and only when the
split produced two or more tasks. Single-task mode, `Run now`, and the
other destinations skip this section entirely — except the clipboard
checkpoint embed above, which reuses the config-resolution step below at
craft time.

- **Read the config first.** Before anything else, read the `checkpoints`
  block of `.foreman/config.json` at the project root. A missing file,
  block, or key means that key's default: `branch` `true`, `push` `false`,
  `onFinish` `"ask"`, `baseBranch` unset (auto-detect). These four keys
  drive the steps below.
- **Settle the branch before the first task.** When `baseBranch` is set,
  that IS the base branch — skip detection. Otherwise resolve it with
  `git symbolic-ref --short refs/remotes/origin/HEAD` and take the name
  after `origin/`; if the ref is unset, treat `main` as the base. With
  `branch` `true` and currently on the base branch, create and switch to
  `foreman/<slug>` — slug is a kebab-case cut of the goal, 40 chars max.
  On any other branch, or with `branch` `false`, create nothing and
  checkpoint in place on the current branch.
- **Still before task 1:** if `git status --porcelain` is non-empty, tell
  the user in one line that pre-existing changes will ride along in the
  checkpoints, then proceed.
- **One commit per finished task.** After a task's verification passes and
  the task is marked completed: `git add -A`, then commit with the message
  `task <n>/<total>: <task subject>`. With `push` `true` and a remote
  present, push after each commit — the first push sets the upstream. With
  `push` `false` (the default) or no remote, the commit stays local, no
  comment.
- **A roadmap-entry close lands inside the last checkpoint commit** (when
  the handoff carries one): stage everything, close the entry with
  `staged:true` (touches derive from the index, and the script stages
  ROADMAP.jsonl alongside), then commit with `Foreman: <id>` as the
  message's final line — entry and commit link through that trailer, so
  no sha gets recorded and the roadmap never trails uncommitted. Then
  mark the final task completed. The entry-paragraph and gate rules above
  are unchanged.
- **After the last task, `onFinish` decides the branch's fate** — only if
  this run created the branch. When the run checkpointed on a pre-existing
  branch, or `branch` is `false`, skip this step entirely. `"ask"` (the
  default) asks with the `AskUserQuestion` below; `"squash"`, `"merge"`,
  `"pr"`, or `"keep"` performs the matching option directly, no question:
  - `Squash merge (Recommended)` — squash onto the base branch, commit
    with a real message summarizing the whole change, delete the
    checkpoint branch
  - `Merge` — true merge, keep the branch
  - `Open a PR` — push and `gh pr create` against the base branch; if
    `gh` is unavailable, say so and keep the branch
  - `Keep the branch` — do nothing

## When NOT to hand off — do it inline instead

- Vague observations ("this could be cleaner") — not confirmed, skip it
- Trivial fixes doable inline in seconds — do it now
- Anything needing this conversation's context to understand — stay inline
- Low-confidence hunches — skip
