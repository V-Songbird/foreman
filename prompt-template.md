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
   "fableEnabled": bool, "modelSuggestions": bool, "requireVerification": bool,
   "decisionLog": {"enabled": bool, "dir": string}, "warnings": [...]}`.
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
     seeds that answer's recommended default only when `modelSuggestions`
     is `true`: a concrete `targetModel` pin in config when the project set
     one, otherwise a per-task recommendation judged from the task's own fit
     (see "Model fit" below). With `modelSuggestions` `false` — the
     default — the question is asked with no seeded default at all, and the
     resolved `targetModel` alone drives elaboration. A confirmed
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

     <!-- [Foreman: 116] -->
     **All three notes below — Model fit, Effort fit, and Raise the
     session — are gated on `modelSuggestions`, which defaults to
     `false`.** When it is `false`, none of them produce anything: no model
     is recommended, no effort line is said, and the `Execute here`
     question is not asked. The executing-model question still runs on the
     dispatching destinations, because a background `Agent` and a clipboard
     paste both need a model named — it just offers the list with no
     task-derived default. `targetModel` is a separate setting and is
     unaffected either way: a concrete pin still drives elaboration, and
     `inherit` still elaborates at the standard level.

     **Model fit** — how to seed the recommended default when `targetModel`
     is `inherit` and `modelSuggestions` is `true`; a recommendation the
     operator confirms or overrides, never an automatic switch. Judge from
     the task's own `what`/`planned_touches`, recorded fields only:
       - `haiku` for mechanical, well-scoped work — a single file or a
         bounded change with an unambiguous spec. Cheapest, and per the
         elaboration note above a fully-spelled-out Haiku prompt cut its
         own exploration overhead at equal correctness.
       - `sonnet` or `opus` when the task turns on judgment — design
         decisions, ambiguity, a cross-cutting predicted file surface, or logic no spec
         pins down.
       - one caution: a `what` that reconciles stale, renamed, or
         conflicting references hit a proven capability cliff on Haiku in
         every prompt format tested — recommend Sonnet/Opus there whatever
         the scope. Never bake this into the assembled prompt: the target
         model never sees a description of its own expected failure modes.

     <!-- [Foreman: 101] -->
     **Effort fit** — the second half of the same recommendation, seeded
     the same way and confirmed in the same breath. This prompt tells the
     destination to think rather than narrate, which makes reasoning
     budget the only deliberation channel it has left — so effort moves
     the outcome at least as much as the model does. Judge it by what
     happens when the work goes wrong, not by how hard the work looks on
     average:
       - a runnable check already sitting in `task_rules` makes a wrong
         attempt cheap and visible — `low` or `medium`, and escalate on a
         failure rather than pre-paying for one. One caveat on that
         escalation: re-running the same prompt at the same setting mostly
         re-buys the same failure (the samples are correlated), so a retry
         only earns its place when something structural changes between
         attempts — a corrected file path, a sharpened constraint, a
         higher effort.
       - a silent failure mode — breakage the existing checks would pass —
         has no cheap signal to escalate on, so pay up front: `high`.
       - no verification at all (a `--research` handoff, a judgment call
         with nothing runnable behind it) leaves nothing to catch a bad
         first pass: `max`.
     Effort is a per-call parameter, never project config — there is no
     `targetEffort` key and none should be added. It is also always
     advisory: the `Agent` tool takes no effort argument, so a background
     dispatch cannot set it even when the operator names one. Say the
     recommendation out loud at craft time and let the operator act on
     it — same rule as the model, and for the same reason. Never bake the
     effort reasoning into the assembled prompt.

     <!-- [Foreman: 111] -->
     **Match the recommendation** — asked only when `modelSuggestions` is
     `true`, and on the `Execute here` destination only. Both
     halves above are stated together and followed by one question, asked
     once per handoff and before the first task row exists: proceed as-is,
     or take the prompt to a fresh session already set to the
     recommendation. That destination has no dispatch value to carry
     either half, so a line alone is the one thing a reader skims past.
     Foreman never makes the comparison itself and must not try —
     hook input carries no model at all, and effort is readable only
     inside a hook, never by a skill — so the operator's answer IS the
     comparison and the switch is theirs. It never sets a model, never
     blocks, and never records anything. The other two destinations keep
     asking exactly what they ask today.

     **The wording must not assume a direction.** Foreman cannot see what
     the session is running, so it cannot know whether the recommendation
     is a step up, a step down, or already matched — a session on Opus told
     a task suits Sonnet is being asked to go down. Never "raise", "upgrade",
     "bump", or any other word that names a direction; word it as running
     the task where the recommendation points, and let the operator supply
     the comparison.

     Switching this session's model or effort in place is deliberately
     **not** an option. Either change invalidates the prompt cache, so
     every remaining turn re-reads the whole conversation from scratch;
     a fresh session pays that cost once, at the shortest history it will
     ever have. A background `Agent` is not the substitute either — that
     call takes a `model` but no effort argument, so it can only ever
     close half the gap.
   - `modelSuggestions` — boolean (default `false`) turning the per-task
     model and effort recommendation on. See the gating note above the
     "Model fit" bullet for exactly what stops when it is `false`.
   - `fableEnabled` — boolean declaration (default `false`) that the
     operator can run Fable 5 at all (Max plan or API — other plans
     can't). Written `false` by `foreman:init`, and set by hand in
     `.foreman/config.json` by a project that can. Gates whether `Fable` appears at all as a
     selectable executing model in craft-time menus — it never changes
     elaboration by itself, and a `targetModel: "fable"` project pin
     still resolves and elaborates as `fable` regardless of this flag.
   - `requireVerification` — boolean (default `true` when missing or
     unparseable). Read by `foreman:roadmap`'s embedded entry paragraph
     (its "Acceptance hold" note): with it `true`, a close that earned
     `done` records `awaiting_acceptance` for the user to confirm. The
     template itself does nothing with it.
   - `decisionLog` — `{enabled, dir}`, the project's declaration of the
     decision-log feature (default `{enabled:false, dir:"docs/foreman"}`).
     Include the `<decision_log>` block below only when `enabled` is `true`
     **and this task is an explicit decision task** — a `kind: "decision"`
     roadmap entry, or a craft-prompt task whose deliverable is the choice
     itself — substituting `dir` for every `<dir>`. Ordinary implementation
     work never carries the block, whatever `enabled` says: a build decides
     nothing the project asked to record. `dir` is a relative path the
     destination writes ADR docs under.
   - `warnings` — surface briefly to the user (skipped entries from a
     malformed config); never blocks assembly.

0b. **Resolve the touched files into a symbol map and preflight the task.**
   In the same craft-time slot, run `node
   ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-symbols.js --touches
   <comma-separated paths>` (or pipe `{"touches":[...],"what":"...",
   "verify":"..."}` on stdin, which also fills `unresolved` and
   `verification`). One JSON object: `{"ok": true, "files": [{"path",
   "missing"?, "directory"?, "unsupported"?, "outside_project"?,
   "lastChanged"?, "symbols":
   [{"name", "line"}]}], "unresolved": [...], "references": [{"helper",
   "files": [...]}], "verification"?: {"command", "resolves", "via"},
   "warnings": [...]}`. Skip the call only when no file paths are known yet.
   Every field below is a fact replacing an inference the session would
   otherwise make — none of it narrows `truth_grounding`, which still
   governs at run time.
   - `files[].symbols` — feed these into `relevant_files` below: cite the
     symbol names that live in each file, so the handed-off session doesn't
     re-derive them. Extraction is a column-0 regex, not a parser, so it
     narrows the search and never replaces `truth_grounding`.
   - `missing` — the path no longer exists. Fix or drop it before
     delivering; a stale path caught here is one the destination would
     otherwise chase.
   - `outside_project` — the path resolves outside the project root, so it
     was not read. Treat it like `missing`: fix or drop it before
     delivering — a roadmap path pointing outside the repo is never
     followed.
   - `unresolved` — identifier-shaped names in the task's own description
     that match no symbol in any touched file. Treat each as either an
     invented API or an un-caught rename, and resolve it before assembly.
   <!-- [Foreman: 109] -->
   - `verification` — present only when a `verify` command was passed;
     pass the command gathered for the verification block, once it is
     known. `resolves: false` means nothing here answers to that command
     (no such `package.json` script, no `gradlew`, nothing by that name on
     `PATH`), so fix the command before delivering — a prompt naming a
     command that cannot run wastes the whole session. `via` names what it
     resolved through, and a leading `cd <dir> &&` is honored, which is how
     a submodule's suite gets named from the repo root.
   - `references` — other files that already import a helper the touched
     files import. Cite one as `relevant_files`' `Pattern:` line: a named
     analogue in this codebase beats a bullet telling the session to follow
     existing conventions. Empty is normal and means nothing to cite.
   - `files[].lastChanged` — the file's last-changed date from git, absent
     outside a repo. A touched file that moved since the entry was written
     is where this prompt's claims are most likely to have aged, so weigh
     it when deciding how much of the entry's `what` to restate as fact
     versus hand over as a claim to check.
   - `warnings` — surface alongside `render-sections.js`'s own.

<!-- [Foreman: 107] -->
**Paths in the assembled prompt.** Every plugin path the prompt carries —
`scripts/roadmap.js` in `scope_discipline`, the entry paragraph's
`update-status` calls, anything else — travels as the literal, unexpanded
string `${CLAUDE_PLUGIN_ROOT}`. Resolving it at craft time bakes in the
foreman version that happens to be installed today, and the prompt stops
running the moment that version bumps, which kills replay of a closed
entry. This holds **even though the crafting skill's own text shows the
path already resolved**: a skill's markdown is loaded with the variable
substituted by the harness, so what you read there is expanded and what
you write must not be. Type the variable back. `check-prompt.js` errors on
a versioned plugin-cache path in the prompt body.

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
One limit on that: the facts above are hypotheses, but the approach this
prompt prescribes is a decision already taken. If what you find makes that
approach unworkable, stop and report it — never silently substitute an
approach of your own.
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
(observed_touches auto-derives from that commit, same as any other completion). If
no ROADMAP.jsonl exists, flagging it to the user is enough — nothing to
log. This doesn't apply to legitimate refinement of this task's own
scope — only to work that's genuinely a separate concern from
`task_context` above.
</scope_discipline>

[If step 0's `decisionLog.enabled` is true AND this task is an explicit
decision task (`kind: "decision"` on its roadmap entry, or a craft-prompt
task whose deliverable is the choice itself), include the `<decision_log>`
block below verbatim — substitute the resolved `dir` for every `<dir>`,
and this task's roadmap entry id for every `<entry-id>` (a craft-prompt
task with no entry id names the doc after a short kebab slug of the goal
instead). Omit the whole block otherwise — when `enabled` is false (the
default), and on every ordinary implementation task regardless of
`enabled`: a build is not asked to produce a decision record. Anchors
already in the code still surface on their own, through the read hook.]
<decision_log>
Before editing a file, scan it for `[Foreman: <id>]` anchor comments; when present, read the listed docs under `<dir>/` first.
This task's deliverable is the decision: write `<dir>/<entry-id>.md` before closing, in this shape:
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
[Exact file paths for every file the task touches, each with the symbols
that matter — take them from step 0b's `files[].symbols` rather than
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
<context>
[Architectural decisions, constraints, patterns already in use.
Anything needed to understand the codebase without prior conversation.
Example: "Uses JWT tokens in httpOnly cookies. No third-party auth libs."
For a bug fix, include the observed failing output verbatim under an
"Observed failure:" line — the artifact itself, not a paraphrase of it.]
</context>
</background>

If a file, symbol, or fallback path this prompt names does not exist as described, that is a finding to report, not a gap to fill — never create it to make this prompt true.

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

[Step 0's `targetModel` also sets how much elaboration these bullets and
the verification block carry — see its bullet.]
<task_rules>
[Pure-investigation handoff: replace the three step bullets below with the
question under investigation plus any exact commands worth running — hand
over the question, not a prescribed exploration sequence. Implementation
tasks keep the bullets. There is no read-first bullet here: the plan block
at the end says that step once, for every task.]
- [What to analyze or check next]
- [What to implement, fix, or produce]

Constraints:
- [Hard limits — files NOT to modify, interfaces NOT to break]
- [Style or pattern to follow — point to an example file if one exists]
- [OPTIONAL, one line — "Expected file surface: <paths>", the files this
  task is expected to touch, followed by: anything beyond this list gets
  flagged to the user before it is written, not after. This is the
  pre-committed scope baseline `observed_touches` cannot be, since that
  field derives from the commit after the fact. Omit the line when the surface
  genuinely isn't known yet.]

Verification (REQUIRED):
Run: [exact command — e.g. "npm test -- --testPathPattern=auth"]
Expected: [pass/fail signal — e.g. "all tests pass", "exit code 0"]
[Repeat the Run:/Expected: pair, in running order, for every check the
task actually has. An `Execute here` task split cuts on these boundaries —
see the splitting section below.]
[OPTIONAL, for a silent-failure task — one whose breakage passes the
existing tests. State this ordering explicitly, before the Run: pairs:
write the invariant test first, confirm it passes against the unmodified
code, deliberately break the invariant and confirm the test goes red,
then implement. A test written after the change encodes the
implementation instead of the contract and will pass a broken change.
Omit the ordering for a task whose failure is loud.]
Do NOT claim success without running this. If it fails, fix and re-run — but after two failed fix attempts, stop and report what is still failing instead of widening the change to make the check pass.
</task_rules>

[CUSTOM SECTIONS — inline each `sections[].xml` from `render-sections.js` here,
verbatim, in order; omit this whole line if `sections` was empty]

[OPTIONAL — include only when the task has a clear before/after pattern.
If `"example"` is in `omit`, drop this whole block unconditionally, even
if Call 1 selected it.]
<example>
[Before snippet or input → After snippet or expected output]
</example>

[The immediate, specific request in one sentence.]

Reason through the approach and edge cases in your thinking before editing — not in prose between tool calls. The steps and commands above are a working plan, not a narration script: whatever output style governs this session decides what you say aloud, so don't announce step transitions or restate command results in chat. The same style governs the register of your final message. Full evidence and findings belong in their durable home — the roadmap entry, the commit message, or the artifact the task names — with the final message stating the outcome and pointing there. Closure notes and findings describe only observed work and cite supporting files, commands, commits, or outcomes; never restate planned scope as evidence that it was executed.

<plan>
The order of work, stated once so you don't have to assemble it:
1. Read every file `relevant_files` cites, before editing anything.
2. Make the change `task_rules` describes, inside its constraints.
3. Run each `Run:` command and check it against its own `Expected:` line.
A ROADMAP.jsonl entry paragraph, when this prompt carries one, wraps that: its open step runs before step 1 and its close step after step 3. A task-split run puts that paragraph on its last task only, so a row without one starts at step 1 and stops at step 3.
</plan>

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

<!-- [Foreman: 138] -->
## Handoff profiles

Two profiles, `standard` and `reinforced`. Ordinary fresh work does not need
the same weight as work that is stale, conflicting, risky, resumed, or highly
constrained, so decide the profile **before** assembling and say which one and
why in one line of the delivery message.

**The signals — all mechanical, computed from the roadmap/git facts already in
hand at craft time. Never a judgment call.** Any one of them true →
`reinforced`. None true → `standard`.

- **resumed** — the pick came from the `next-candidates` `in_progress` array
  (the finish-first resume path), or the selected entry's `commits` /
  `observed_touches` is non-empty. A sprint coordinator's own
  `planned` → `in_progress` transition immediately before dispatch does not
  count: the entry had no earlier session.
- **conflicting** — the candidate row's `collision` is `true`.
- **stale** — the entry's `updated_at` is more than **30 days** before today,
  or any `files[].lastChanged` from step 0b's `resolve-symbols.js` call is
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
no-invention line, the bounded fix ceiling, `tone`, `output_format`, and the
optional per-task fields. Nothing about it changes.

**Standard** carries only: `<task_context>` (the entry's identity and the
one-sentence goal), the concise truth line below, `<relevant_files>` with its
symbols, `<task_rules>` (constraints plus the `Verification (REQUIRED):`
Run:/Expected: pairs), the closure-evidence sentence, and the ROADMAP.jsonl
entry paragraph when the handoff carries one. Everything else is dropped —
the point of the profile is the length it saves. Two rules survive the cut
because they are trust invariants, not ceremony:

> Treat every claim in this prompt as a hypothesis to verify against the codebase before acting on it; if reality contradicts it, trust reality, say so in one line, and never create a file or symbol just to make this prompt true.

and the closure-evidence sentence from the closing paragraph, carried on its
own line, verbatim:

> Closure notes and findings describe only observed work and cite supporting files, commands, commits, or outcomes; never restate planned scope as evidence that it was executed.

A block a standard prompt does keep is still held to the template verbatim —
`standard` is a smaller floor, never a licence to reword.

---

## Checklist (verify before handoff)

- [ ] the profile was decided from the mechanical signals above, before
      assembly, and stated in one line with the signal that chose it — every
      item below applies to a `reinforced` handoff; a `standard` one keeps
      only the blocks the "Handoff profiles" section lists
- [ ] `task_context` names a specific role (domain framing when
      `usePersona` was `false`) and a concrete one-sentence "done" state
- [ ] `truth_grounding` present, unmodified — every handoff carries it
- [ ] `scope_discipline` present, unmodified — every handoff carries it
- [ ] the no-invention line ("a finding to report, not a gap to fill")
      sits outside `<background>`, so it survives an `omit`ted background,
      and the verification block's bounded fix loop ("after two failed fix
      attempts") replaced the old open-ended "iterate until it passes" —
      both are fixed text, never reworded per task
- [ ] `render-sections.js` ran once at craft time (never deferred to the
      spawned session) and its `usePersona` field — not a fresh `Read` or
      flag check — drove `<task_context>`; its `targetModel` field —
      overridden by a concrete executing-model answer when the crafting
      flow gathered one — drove how much elaboration went into
      `relevant_files`/`context`/`task_rules` below
- [ ] when `modelSuggestions` was `true`, a reasoning effort was recommended
      alongside the model, judged by the "Effort fit" note's
      verification-cost rule and said out loud to the operator — never
      auto-applied, and never written into the prompt. When it was `false`,
      neither half was stated at all
- [ ] `resolve-symbols.js` ran in the same craft-time slot when any file
      paths were known, its `files[].symbols` fed `relevant_files`, and
      every `missing` path and `unresolved` name was resolved before
      delivery — never left for the destination to discover
- [ ] the same call's preflight fields were acted on, not just read: the
      verification command was passed as `verify` and a `resolves: false`
      was fixed before delivery, a `references` hit became the
      `relevant_files` `Pattern:` line, and a stale `lastChanged` shifted
      how much of the entry's `what` went in as claim rather than fact
- [ ] `relevant_files` lists every file path, each carrying the symbol names
      that matter — a line range only where the spot has no name, and then
      with its enclosing symbol named too — and no vague
      references (`craft-prompt`: from the user directly; `foreman:roadmap`:
      the entry's `planned_touches` passed through as-is, never upgraded by
      exploring the codebase — `truth_grounding` covers that gap at
      handoff time)
- [ ] `<plan>` present, unmodified — every handoff carries it, and nothing
      elsewhere in the prompt restates the order it already fixes
- [ ] the fixed closing paragraph's closure-evidence rule is present,
      unmodified — notes and findings cite observed files, commands,
      commits, or outcomes, never planned scope presented as execution
- [ ] `task_rules` has analyze/implement steps AND a runnable
      verification command with expected output (a pure-investigation
      handoff carries the question plus exact commands instead of steps;
      a `sonnet`-, `opus`-, or `fable`-target handoff carries the
      implement step without the run micro-step; the gate's
      `--research` flag waives the verification pair)
- [ ] `<invariants>`, the `Expected file surface:` constraint line, and the
      test-first ordering are each present when the task has one, and each
      absent otherwise — all three are optional and nothing flags their
      absence; when `<invariants>` is present, every line reads as an
      assertion that could be checked, never as a contract name
- [ ] custom sections were rendered by `render-sections.js` and inlined
      verbatim after `task_rules` — never hand-written — and its
      `warnings` were surfaced to the user
- [ ] `<decision_log>` present iff step 0's `decisionLog.enabled` was
      `true` **and** this task is an explicit decision task, with
      `dir`/`<entry-id>` substituted (absent by default, and always absent
      on ordinary implementation work)
- [ ] every tag in `omit` is absent from the assembled prompt, overriding
      a conflicting per-prompt selection (exception: an omitted `tone`
      stays for a background-`Agent` destination — step 0's carve-out);
      guardrail/core blocks are never affected
- [ ] every plugin path in the prompt body is the unexpanded
      `${CLAUDE_PLUGIN_ROOT}` string, never a resolved plugins-cache path
      with a version segment — even where the crafting skill's own text
      showed it already resolved
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
node ${CLAUDE_PLUGIN_ROOT}/scripts/check-prompt.js <file> --destination <task|agent|clipboard> --profile <standard|reinforced>
```

- `--profile` — the profile chosen above. Omitting it makes the checker read
  the profile off the prompt (the full guardrail blocks mean `reinforced`),
  which is what keeps every prompt written before profiles existed valid;
  pass it explicitly so a standard prompt that accidentally kept a guardrail
  block is still checked as standard. The result echoes back `profile`.
- `--destination` — `task` for `Execute here` in any of its execution
  modes, `agent` for a background Agent, `clipboard` for copy. This is how
  the checker knows whether an omitted `tone` must stay (agent) or go.
- `--entry <id>` — add for a `foreman:roadmap` pick, so the embedded
  entry paragraph is verified too; add `--resume` when the pick resumed
  an `in_progress` entry.
- `--research` — add for a pure-investigation task with no verification
  command.
- `--workflow-stage` — add when the Workflow-stage flavor was selected.

`{"ok":true}` is the gate: fix every error and re-run until it passes —
never deliver a prompt the checker rejected. Surface its `warnings`
alongside the delivery message. The checker validates structure (guardrail
blocks verbatim, no unfilled placeholders, omit compliance, verification
present); it can't judge content quality — the checklist above still
applies to what the fields actually say. One of its errors fires on a
resolved plugins-cache path with a version segment — the fix is always to
type `${CLAUDE_PLUGIN_ROOT}` back in place of it, never to strip the
command.

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
- before task 1, stop if `git status --porcelain` is non-empty: say so
  once and make no checkpoint commits at all for the run (the pasted
  session has no Foreman scripts to call, so this is the gate);
- after each task's check passes, stage only the files that task
  changed — `git add -- <those paths>`, never `git add -A` — and commit
  `task <n>/<total>: <task subject>`, and leave it local — checkpoints
  are never pushed;
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
  slice the analyze/implement bullets: a `sonnet`, `opus`, or `fable`
  target doesn't carry them at all, so there is nothing there to cut. Never
  slice by file either — predicted-file-surface groupings are unverified guesses,
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

<!-- [Foreman: 119] -->
- **Read the config first.** Before anything else, read the `checkpoints`
  block of `.foreman/config.json` at the project root. A missing file,
  block, or key means that key's default: `branch` `true`,
  `onFinish` `"ask"`, `baseBranch` unset (auto-detect). These three keys
  drive the steps below. There is no `push` key and none should be added —
  see `docs/foreman/119.md`.
- **Settle the branch before the first task.** When `baseBranch` is set,
  that IS the base branch — skip detection. Otherwise resolve it with
  `git symbolic-ref --short refs/remotes/origin/HEAD` and take the name
  after `origin/`; if the ref is unset, treat `main` as the base. With
  `branch` `true` and currently on the base branch, create and switch to
  `foreman/<slug>` — slug is a kebab-case cut of the goal, 40 chars max.
  On any other branch, or with `branch` `false`, create nothing and
  checkpoint in place on the current branch.
<!-- [Foreman: 121] -->
- **Take the boundary first — before task 1 and before the branch step
  above:** `node ${CLAUDE_PLUGIN_ROOT}/scripts/safe-commit.js begin`. A
  `dirty:true` result means **this run makes no automated commits at
  all** — say so once in a line naming the reason, then work the tasks
  and leave every change in the tree for the user to commit. Never
  offer to absorb the existing changes, and skip the branch step too:
  there is nothing to checkpoint onto. Only a `dirty:false` result
  continues below, and its `baseline.head` is the first checkpoint's
  baseline.
- **One commit per finished task, staged by the primitive.** After a
  task's verification passes and the task is marked completed:
  `echo '{"expected":["<the files this task changed>"],"message_title":"task <n>/<total>: <task subject>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/safe-commit.js finish --baseline <the current baseline>`
  — it stages only what changed since that baseline, refuses on any file
  the `expected` list doesn't cover (`unexpected_files` names them: show
  them and ask the user, then re-run with `--allow-unexpected` if they
  approve), commits, and attests the result. Its `commit` is the next
  task's baseline. Never `git add -A` — the primitive owns staging.
  Checkpoints always stay local, no comment — never push them.
  `onFinish` is the only step that reaches a remote, and only through
  its `Open a PR` option.
- **A roadmap-entry close lands inside the last checkpoint commit** (when
  the handoff carries one): stage the task's own files with
  `safe-commit.js finish --no-commit`, close the entry with `staged:true`
  (observed_touches derives from the index, and the script stages ROADMAP.jsonl
  alongside), then commit with `Foreman: <id>` as the message's final
  line — entry and commit link through that trailer, so no sha gets
  recorded and the roadmap never trails uncommitted. Then mark the final
  task completed. The entry-paragraph and gate rules above are
  unchanged.
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
