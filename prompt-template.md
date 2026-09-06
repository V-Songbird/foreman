# Foreman — Codex prompt template

Foreman crafts a concrete outcome, concise context, relevant evidence, scope, and verification for Codex. Use existing project facts before interviewing; ask only for missing information that would change the work. Select delivery before assembly: execute here, subagent, or clipboard. Respect an explicit destination; otherwise use the shared destination question. A fresh recipient needs a self-contained prompt; a subagent may inherit context, but still needs a bounded assignment and file ownership.

This is the canonical source read by scripts/craft-handoff.js and scripts/check-prompt.js. Both skills delegate assembly to the script, including profiles and guardrails. XML is an internal handoff format, not a required human-facing response.

The handoff supplements the recipient's active Codex instructions with the goal,
relevant evidence, constraints, and completion criteria. It does not embed a
replacement system prompt, select a model, or reproduce an older Codex API
starter prompt. See [Codex prompting alignment](CODEX-PROMPTING.md) for the
official sources, retained Foreman policies, and validation limits.

## Craft-time preflight

Run scripts/craft-handoff.js from the installed plugin with JSON on stdin. It calls render-sections.js and resolve-symbols.js in process, reads the roadmap and ledger, assembles the applicable sections, and runs the gate. Read the source skill's installed location to find the plugin; do not invent a runtime environment variable.

Entry handoffs use hooks/codex-task.js start --id ID before implementation and require dispatchReady:true. After recording observed work with roadmap.js update-status, run hooks/codex-task.js check --id ID. An acceptance hold passes the recorded-work checkpoint and still requires the user's acceptance. The coordinator owns these lifecycle calls for delegated subagents. A no-commit close sends observed file paths through add_touches; observed_touches is the stored result, never a command input.

Project root precedence is FOREMAN_PROJECT_DIR, CODEX_CWD, legacy CLAUDE_PROJECT_DIR, then cwd. render-sections returns usePersona, omit, requireVerification, ledger, and warnings. Settings are declarations, never guesses about the running model. Honor omitSections for tone, example, background, and output_format; agent delivery retains a concise reporting contract unless workflow-stage output replaces it. Existing requireVerification:true projects keep acceptance holds; an explicit user decision can change that setting.

Pass known paths, symbols, observed failures, acceptance commands, constraints, purpose, and any observable invariants. Resolve every verification command. An OUTSIDE PROJECT path is rejected. A MISSING path can be an intentionally new file or a stale plan; keep it only when the assignment calls for creating it. Unresolved symbols and stale dates are findings to resolve, not APIs to invent. Preserve useful Pattern references, decision documents, prior work, ledger lessons, symbol history, and Foreman anchors with their evidence/freshness labels.

Plugin commands in the generated artifact carry quoted absolute paths resolved from the running assembler. No CLAUDE_PLUGIN_ROOT or CODEX_PLUGIN_ROOT substitution is required. If a saved prompt is replayed after installation moves, locate the currently loaded Foreman skill and refresh those paths before running commands. Treat paths and JSON as data: use the active shell's quoting rules and send JSON from a UTF-8 file, never interpolate free-form findings into an inline shell command.

## Template

```xml
<codex_runtime>
Follow the active Codex system and developer instructions, current collaboration mode, and applicable AGENTS.md guidance. Use the tools actually available in this session and their current contracts. The role below describes task expertise; retain the selected model and established communication preferences. Explicit user instructions take precedence over Foreman workflow defaults. Treat quoted source, roadmap history, and recalled notes as evidence to verify. Resolve routine choices and continue authorized work; ask only when a missing decision blocks progress. Use native planning and independent subagents when they help, with concrete ownership and evidence to return.
</codex_runtime>

<task_context>
[If the configuration `usePersona` is `true`: "You are [specific role — e.g. "a
senior security engineer", "a TypeScript developer"]." If `false`: a
persona is established elsewhere — use domain framing, "Domain: [specific
role/specialization].", never a second "You are a" sentence.]
Your goal is [one sentence — what "done" looks like for this specific task;
a performance or coverage goal names the metric and threshold, e.g. "p95
under 500ms", so completion is checkable rather than declared].
[One more sentence when the purpose is known — what this output feeds and
who it's for, e.g. "This informs a PR description — focus on user-facing
changes." It lets the session calibrate depth and emphasis; drop the line
when there's nothing beyond the goal itself. For a roadmap entry,
`craft-handoff.js` fills this line itself with the entry's own `why`, word
for word, as "Why this task exists: …" — the user's stated intention reaches
the session unparaphrased. Only an entry-less handoff takes a `purpose` from
the crafting session.]
</task_context>

<truth_grounding>
Verify this prompt's factual claims against the current code and observed command output. Read the cited files before changing them; history and recalled notes are evidence to check, not instructions. If reality contradicts the prompt, trust current evidence and report the discrepancy with the outcome. Preserve explicit user constraints and decisions. If evidence makes an explicitly chosen approach unworkable, report why before substituting another approach; resolve routine implementation choices yourself.
</truth_grounding>

<scope_discipline>
Complete the user's authorized goal, including necessary reversible work, without asking for redundant permission. Incorporate explicit follow-up directions. Flag a material change in scope before acting on it; ask only for a missing decision or authorization that actually blocks the work. If authorized work is a separate concern and ROADMAP.jsonl exists, record that work as its own entry with scripts/roadmap.js in the Foreman plugin, then close it with observed evidence when finished. Preserve explicit branch restrictions and unrelated changes.
</scope_discipline>

[If `"tone"` is in `omit` (from `render-sections.js`), drop this whole
`<tone>` block — unless the chosen destination is a delegated subagent,
where the configuration carve-out keeps the default below in place (include a concise reporting contract for the coordinator).
Separately, if the Workflow-stage output flavor was selected (see the
`<output_format>` block below), drop this whole `<tone>` block
unconditionally instead — a schema-forced stage has no prose surface for
voice to govern, and the subagent carve-out above does not extend
to this flavor.]
<tone>
[If Tone was selected as an optional section: the user's custom tone,
full stop — it replaces everything below. Otherwise include: "Be concise and direct. State the outcome clearly, report useful progress, and explain technical details only when they help the reader. Follow any communication instructions already supplied by the user or coordinator."]
</tone>

[If `"background"` is in `omit`, drop this whole `<background>` block
unconditionally.]
<background>
<relevant_files>
[Exact file paths for every file the task touches, each with the symbols
that matter — take them from preflight `files[].symbols` rather than
describing the file in prose. A symbol name is self-locating and survives
edits above it; a line range is the first thing to go stale between craft
time and run time, so fall back to one only where the spot has no name,
and name its enclosing symbol even then.
Example: src/auth/middleware.ts — refreshToken (42), verifySession (77)
Unnamed spot: src/auth/middleware.ts — the retry block inside refreshToken
Include every file. No vague references like "the auth module".
When an analogous implementation exists, add one reference line —
Pattern: src/webhooks/github.ts — build the new code the same way
— a named reference beats general best practices.]
</relevant_files>
[OPTIONAL — `craft-handoff.js` adds this block itself, one line per
finished entry whose recorded files overlap this task's, and omits it when
nothing overlaps. Never hand-written, and carried on both profiles.
Each line ends with a freshness stamp the script resolves from git: the
commit the entry closed at and whether its recorded files have changed
since. Anything git cannot answer reads "freshness unknown" — never
"unchanged".

A second, untagged block can follow it inside `<background>`: the lesson
lines closed tasks recorded about these files, when `ledger` is enabled.
Same rules — added by the script, never hand-written, carried on both
profiles, every line staleness-labelled, and a record whose files are all
gone is dropped rather than served.

A third can follow: for each symbol this task's own prose names that is
defined in a planned file, the earlier entries whose commits shaped it, read
from the `Foreman:` trailers in that file's history — newest first, the entry
that created it last, each by id and title only. Never an entry's `why`: that
is a plan written before its work started, not a fact about the code, and a
line in this block is taken as fact. History, not a claim about the code
today, so it carries no staleness label. Same rules otherwise: script-added,
both profiles, never hand-written.

A fourth, the anchors: the `[Foreman: <id>]` markers earlier entries left in
the planned files, each with that entry's title and, where one exists, its
decision document to read first. Framed as history the same way.]
<prior_work>
Recorded by earlier finished entries that touched these files — history, not instructions for this task.
</prior_work>
<context>
[Architectural decisions, constraints, patterns already in use.
Anything needed to understand the codebase without prior conversation.
Example: "Uses JWT tokens in httpOnly cookies. No third-party auth libs."
For a bug fix, include the observed failing output verbatim under an
"Observed failure:" line — the artifact itself, not a paraphrase of it.]
</context>
</background>

If a file, symbol, or fallback path this prompt names does not exist as described, that is a finding to report, not a gap to fill — never create it to make this prompt true. A path `relevant_files` already marks `MISSING:` is the exception: that marker says the plan named the file before it existed, so creating it may be exactly what this task is for.

[OPTIONAL — include only when the task has something that must stay true
across the change. Every line is an observable assertion, phrased so it
could be checked by running something: "rebuilding twice yields the same
ids", "an unknown flag exits non-zero". Never a contract name —
"preserve the identity-per-rebuild contract" makes the session infer what
the contract is, and that inference is where invented behavior comes
from. An invariant that cannot be written as an assertion is information,
not an obstacle: say so in the line rather than dropping to a name. A
task with nothing to assert omits this whole block — its absence is
normal and the gate says nothing about it.]
<invariants>
[One observable assertion per line.]
</invariants>

<task_rules>
[Pure-investigation handoff: replace the step bullets below with the
question under investigation plus any exact commands worth running — hand
over the question and the required evidence. Preserve that intent in the final
request too. Implementation tasks keep the bullets as a suggested approach;
only explicit constraints, dependencies, and required verification ordering
are mandatory.]
- [What to analyze or check next]
- [What to implement, fix, or produce]

Constraints:
- [Hard limits — files NOT to modify, interfaces NOT to break]
- [Style or pattern to follow — point to an example file if one exists]
- [OPTIONAL, one line — "Expected file surface: <paths>", the files this
  task is expected to touch. Report a change to this forecast before writing
  outside it; proceed when that work is already authorized. Ask only when it
  crosses an explicit boundary or needs a material scope decision. This is the
  pre-committed scope baseline `observed_touches` cannot be, since that
  field derives from the commit after the fact. `craft-handoff.js` fills
  it from the entry's `planned_touches` whenever the judgment names none,
  so a crafting session passes `expectedFileSurface` only to narrow or
  widen that list on purpose. The line is absent only when the entry
  itself names no file — the one case where the surface genuinely isn't
  known yet.]

Verification (REQUIRED):
Run: [exact command — e.g. "npm test -- --testPathPattern=auth"]
Expected: [pass/fail signal — e.g. "all tests pass", "exit code 0"]
[Repeat the Run:/Expected: pair, in running order, for every check the
task actually has. An `Execute here` task split cuts on these boundaries —
see the splitting section below.]
[Pure-investigation handoff: diagnostic checks report observed outcomes,
including failures. Replace the fix-loop sentences below with a reminder that
failed diagnostics do not authorize implementation changes. Do not combine a
question with testFirst or automated implementation checkpoints.]
[OPTIONAL, for a silent-failure task — one whose breakage passes the
existing tests. State this ordering explicitly, before the Run: pairs:
write the invariant test first, confirm it passes against the unmodified
code, deliberately break the invariant and confirm the test goes red,
then implement. A test written after the change encodes the
implementation instead of the contract and will pass a broken change.
Omit the ordering for a task whose failure is loud.]
Do NOT claim success without running this. If it fails, fix and re-run — but after two failed fix attempts, stop and report what is still failing instead of widening the change to make the check pass.
Complete the required checks and any additional checks justified by the change. Once they pass, repeat or broaden testing only for new changes, failures, or unresolved concerns. Report an unavailable check as a verification limit.
</task_rules>

[OPTIONAL — include only when the task has a clear before/after pattern.
If `"example"` is in `omit`, drop this whole block unconditionally, even
if selected during the interview.]
<example>
[Before snippet or input → After snippet or expected output]
</example>

[The immediate, specific request in one sentence.]

Complete the requested outcome and verify it with the checks above. Share concise progress when useful and report the outcome, evidence, and remaining limits. Explain decisions briefly when they help the user assess the result; do not provide a transcript of internal reasoning. Closure notes and findings describe only observed work and cite supporting files, commands, commits, or outcomes; never restate planned scope as evidence that it was executed.

<plan>
Choose an execution sequence appropriate to the requested outcome, current evidence, and active Codex mode. Preserve explicit dependencies and verification ordering. An investigation or review produces findings; a decision produces a supported choice. Implementation requires authorization in the task itself.
For a tracked task, the responsible coordinator opens the entry before work and records observed evidence after the required checks. A split run closes the entry only after all acceptance rows are complete. A delegated subagent returns its evidence to the coordinator for these roadmap mutations.
</plan>

[BACKGROUND-AGENT DESTINATION — include the paragraph below only for a delegated subagent.]
[BACKGROUND-AGENT DESTINATION
You are operating autonomously. Complete this bounded subtask using the context and permissions supplied by the coordinator. For necessary reversible work, proceed without redundant questions. If a decision, authorization, or input blocks progress, report it to the coordinator using the available collaboration tools. Do not create user-owned tasks, switch branches, stage files, or commit; the coordinator owns integration and roadmap closure. Return the concrete changes, verification evidence, and unresolved findings.]


[If `"output_format"` is in `omit`, drop this whole block unconditionally,
even if the user selected `Custom output format`.]
<output_format>
Give a concise, human-readable summary: what changed, and the verification
result. No XML tags in the visible response — a human reads this directly
in chat by default, and raw `<tag>` markers read as a bug, not structure.
[Only if something downstream actually parses this output — a script, a
following automated step — name a specific XML tag here explicitly and say
who/what consumes it. Otherwise omit this bracket entirely; don't wrap by
default "just in case".]
</output_format>

[WORKFLOW-STAGE FLAVOR — drop tone and output_format and use the fixed sentence from check-prompt.js. Deliver an accompanying JSON Schema as a separate artifact. Use tool-enforced structured output only where the selected tool supports it; otherwise validate JSON explicitly. An ordinary subagent call does not enforce a schema. Keep an object root, explicit required fields, descriptions, and cited evidence fields; validate supported keywords against the actual consumer.]

```

## Handoff profiles

Two profiles, `standard` and `reinforced`. Ordinary fresh work does not need
the same weight as work that is stale, conflicting, risky, resumed, or highly
constrained, so the profile is decided **before** assembling. It is internal
bookkeeping: never name the profile, or which signals fired, in anything the
user reads. They asked for a task, not for Foreman's own scoring.

**The signals — all mechanical, computed from the roadmap/git facts already in
hand at craft time. Never a judgment call.** Any one of them true →
`reinforced`. None true → `standard`.

- **resumed** — the pick came from the `next-candidates` `in_progress` array
  (the finish-first resume path), or the selected entry's `commits` /
  `observed_touches` is non-empty. A coordinator's own
  `planned` → `in_progress` transition immediately before dispatch does not
  count: the entry had no earlier session.
- **conflicting** — the candidate row's `collision` is `true`.
- **stale** — the entry's `updated_at` is more than **30 days** before today,
  or any `files[].lastChanged` from preflight `resolve-symbols.js` call is
  later than that `updated_at` (the code moved after the entry was written).
- **highly constrained** — `depends_on` holds **3 or more** ids, or `notes` is
  longer than **1000 characters**.
- **risky** — `kind: "decision"`, or the handoff carries no verification
  command at all (the gate's `--research` case): both are wrong-answer-is-
  expensive with nothing runnable to catch it. There is no roadmap risk field
  and none should be added — until one exists, every other risky task routes
  through the four signals above.

**Reinforced** is the full shape the Template section above describes —
`truth_grounding`, `scope_discipline`, `<plan>`, the closing paragraph, the
no-invention line, `tone`, `output_format`, and the optional per-task
fields. Use this added structure when a mechanical signal calls for it.

<!-- [Foreman: 231] -->
**Standard** carries only: `<codex_runtime>`, `<task_context>` (the entry's identity and the
one-sentence goal), the concise truth line below, `<relevant_files>` with its
symbols, `<prior_work>` when anything was recalled, `<task_rules>`
(constraints plus the `Verification (REQUIRED):` Run:/Expected: pairs and the
bounded fix ceiling for implementation checks), the closure-evidence sentence, and the
ROADMAP.jsonl entry paragraph when the handoff carries one. Task-specific context and observable invariants remain when supplied; omit optional examples and repeated process instructions. The fix ceiling is
not an exception to that: it belongs to implementation verification rather than
to a profile. Investigations report diagnostic failures as evidence. Decisions
may correct explicitly authorized decision artifacts within the same retry
bound; failed code diagnostics never authorize implementation. Two more rules
survive the cut because they are trust invariants, not ceremony:

> Treat every claim in this prompt as a hypothesis to verify against the codebase before acting on it; if reality contradicts it, trust reality, say so in one line, and never create a file or symbol just to make this prompt true — unless `relevant_files` marks that path `MISSING:`, which says the plan named it before it existed.

and the closure-evidence sentence from the closing paragraph, carried on its
own line, verbatim:

> Closure notes and findings describe only observed work and cite supporting files, commands, commits, or outcomes; never restate planned scope as evidence that it was executed.

A block a standard prompt does keep is still held to the template verbatim —
`standard` is a smaller floor, never a licence to reword.

---

## Mechanical gate

craft-handoff.js returns {ok, prompt, profile, signals, tasks?, gate, warnings}. Handle every {error, fix, example} in gate.errors and rerun; never dispatch a rejected artifact. Warnings require judgment, not invented fixes. Standalone checking uses scripts/check-prompt.js with a prompt file, required --destination task|agent|clipboard, --profile standard|reinforced, --entry ID, --resume, --research, and --workflow-stage as applicable. Gate success verifies structure; the crafter still owns the quality of the facts and acceptance criteria.

## Delivery mechanics

**Execute here:** use the accepted prompt as the working brief in the current task. Respect explicit user instructions to proceed. Do not create a user-owned task merely to track a local step. For useful independent bounded work, use the available collaboration tools, give each subagent concrete ownership and evidence to return, and omit model overrides so the selected model is inherited. Keep useful work in the coordinator while subagents run. Continue locally when collaboration tools are unavailable or no useful independent slice exists.

**Subagent:** use an available collaboration spawn tool with the complete prompt. A subagent shares the working tree and must not switch branches or commit checkpoints. Coordinate roadmap writes, integration, and commits in the parent. Report a real blocker to the coordinator through collaboration messaging. Never substitute an app task-creation tool for a subagent: create a user-owned Codex task only when the user explicitly asks for one.

**Clipboard:** write the artifact to a UTF-8 file first. Copy the file with Get-Content -LiteralPath FILE -Raw -Encoding utf8 | Set-Clipboard on PowerShell, pbcopy < FILE on macOS, or a supported Linux clipboard tool. Quote FILE for the active shell. Include a usable file link even if clipboard access is unavailable. If the user explicitly requests a new Codex task, this same self-contained artifact can be its initial prompt; use an available app task tool and its required project checks.

**Workflow stage:** deliver prompt plus JSON Schema. Drop tone and output_format. Select actual schema enforcement only when the execution tool exposes that capability; otherwise validate the returned JSON with a validator supported by the project. Do not promise schema enforcement from plain task or subagent delivery.

## Splitting on acceptance boundaries

Split only when requested or useful for distinct work slices. Each acceptance row has a goal, owned files, Run and Expected; typecheck, lint, and tests for the same change are checks, not three independent implementations. tasks[].subject and tasks[].description are local execution records. Use an available plan tool or keep a checklist in the current task; finish prerequisites before dependent rows. The full prompt belongs to row 1 and the roadmap closure paragraph to the last row only. Do not close the entry after an intermediate acceptance check.

**Clipboard checkpoint embed:** for implementation with two or more Run:/Expected: pairs, the assembler includes resolved checkpoint settings and acceptance ordering in the prompt itself. An investigation, or a handoff with one check or none, adds no checkpoint protocol. The recipient can use local planning; it must not invent unavailable task tools. Skip checkpointing and just work the tasks if git is unavailable.

## Checkpointing a task-split run

Read the checkpoints block of .foreman/config.json. Defaults are branch:true, onFinish:"ask", baseBranch unset. Resolve an unset base from origin/HEAD, falling back to main. User branch restrictions always win: create or use an authorized working branch before any writes; never write on a protected branch. branch:false cannot override that restriction.

Before the run, inspect git status. Existing changes mean no checkpoint commits for this run; preserve the work and continue without staging around it. When starting on the base branch with branch:true, create foreman/<slug>; otherwise checkpoint on the current authorized branch. Checkpoint commit subjects are task <n>/<total>: <subject>. Where checkpointing is appropriate and authorized, call scripts/safe-commit.js begin before changes, retain baseline.head, and use finish with that baseline plus an explicit expected file list. Do not use git add -A or publish checkpoint commits. There is no checkpoints.push key. The last row with a roadmap entry stages through finish --no-commit, records staged:true at close, and makes one commit ending with Foreman: ID. The coordinator owns these writes when subagents help.

For a branch created by this run, onFinish can be ask, squash, merge, pr, or keep. Apply an already authorized concrete preference; ask only for a missing decision. Prepare the concrete result before requesting permission for an external action. A setting never overrides an explicit ban on modifying a target branch. Retain completed work on the branch when merging would violate that ban. If the user changes the future preference, update only checkpoints.onFinish while preserving other config.

Do trivial authorized work inline. A handoff is useful only when its bounded outcome and evidence make the recipient more effective.
