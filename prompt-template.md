# Foreman — prompt template

<!-- foreman:practices lastmod:2026-08-13
     source-a: https://code.claude.com/docs/en/best-practices.md
     source-b: https://code.claude.com/docs/en/sub-agents.md
     source-c: Anthropic Prompting 101 — Code w/ Claude 2025-05-22
     source-d: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5
     source-e: Claude Code 2.1.214 embedded delegation guidance
     source-f: https://code.claude.com/docs/en/prompt-library.md
     source-g: https://platform.claude.com/docs/en/build-with-claude/structured-outputs.md -->

The handed-off session — whether run here in this session, by a
background `Agent`, or copy-pasted elsewhere — has **zero memory** of this
conversation. Fill every required section. A self-contained prompt is not
optional — it is the only way the handed-off work can act correctly.

This file is the canonical source scripts read at run time:
`check-prompt.js` and `craft-handoff.js` both parse the fixed blocks
below, so there is exactly one copy of every guardrail.
`foreman:roadmap`'s pick branch and `foreman:craft-prompt` call
`craft-handoff.js` and relay what it returns rather than assembling those
blocks themselves. One exception: both flows `Read` the "Checkpointing a
task-split run" section here directly, at their Deliver step, because no
script assembles that protocol.

---

## Template

**Craft-time environment check (do this now, once, while assembling — not
an instruction for the spawned session to act on later):**

0. **One mechanical call covers persona and omissions.** Run `node
   ${CLAUDE_PLUGIN_ROOT}/scripts/render-sections.js`
   — always (it resolves a project root from `$CLAUDE_PROJECT_DIR`/cwd and
   fails soft to defaults when no `.foreman/config.json` exists). One JSON
   object: `{"usePersona": bool, "omit": [...],
   "fableEnabled": bool, "requireVerification": bool,
   "ledger": {"enabled": bool, "dir": string}, "warnings": [...]}`.
   All of it is project **declaration** — foreman never inspects
   which style plugins or model the operator runs.
   - `usePersona` — default `true` when missing/unparseable. Controls only
     the opening of `task_context` below: persona sentence vs domain
     framing.
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
   - `fableEnabled` — boolean declaration (default `false`) that the
     operator can run Fable 5 at all (Max plan or API — other plans
     can't). Written `false` by `foreman:init`, and set by hand in
     `.foreman/config.json` by a project that can. Gates whether `Fable` appears at all as a
     selectable executing model in craft-time menus, and nothing else.
   - `requireVerification` — boolean (default `true` when missing or
     unparseable). Read by `foreman:roadmap`'s embedded entry paragraph
     (its "Acceptance hold" note): with it `true`, a close that earned
     `done` records `awaiting_acceptance` for the user to confirm. The
     template itself does nothing with it.
   - `ledger` — `{enabled, dir}`, the project's declaration of the ledger
     (default `{enabled:false, dir:"docs/foreman"}`). Nothing in this
     template is conditional on it: `craft-handoff.js` reads it directly to
     decide whether to ask for a lesson at close and which directory an
     `[Foreman: <id>]` anchor resolves a document in. Foreman never writes a
     document there.
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
unconditionally.]
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
gone is dropped rather than served.]
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

<task_rules>
[Pure-investigation handoff: replace the three step bullets below with the
question under investigation plus any exact commands worth running — hand
over the question, not a prescribed exploration sequence. Implementation
tasks keep the bullets. There is no read-first bullet here: a reinforced
handoff states that step once in the plan block at the end, and a standard
one carries the concise truth line instead.]
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
official autonomous-operation reminder plus the pause policy source-d
pairs it with; the agent harness carries neither (probe-confirmed), and a
background agent has no user to answer a question. Ship the pair — the
reminder alone bans asking without saying when asking is still right,
which is the one thing `scope_discipline` needs on this destination.
Omit it for the other two destinations — an `Execute here` or pasted
session has a user present.
You are operating autonomously. The user is not watching in real time and
cannot answer questions mid-task, so asking "Want me to…?" or "Shall
I…?" will block the work. For reversible actions that follow from the
original request, proceed without asking. Offering follow-ups after the
task is done is fine; asking permission after already discussing with the
user before doing the work is not.
Pause for the user only when the work genuinely requires them: a
destructive or irreversible action, a real scope change, or input that
only they can provide. If you hit one of these, ask and end the turn,
rather than ending on a promise.
Before ending your turn, check your last paragraph. If it is a plan, an
analysis, a question outside those three pauses, a list of next steps, or
a promise about work you have not done ("I'll…", "let me know when…"), do
that work now with tool calls. End your turn only when the task is
complete, you have paused for one of those three reasons, or you are
blocked on input only the user can provide.]

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
  Legality rules (source-g), separate from the authoring rules above: the
  schema layer takes draft-07 only, and `minimum`/`maximum`,
  `minLength`/`maxLength`, `multipleOf`, recursive or external `$ref`, and
  `minItems` above 1 are unsupported — state any such bound in the
  property's `description` instead. An unsupported keyword fails the run at
  startup, not at validation time.
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
no-invention line, `tone`, `output_format`, and the optional per-task
fields. Nothing about it changes.

<!-- [Foreman: 231] -->
**Standard** carries only: `<task_context>` (the entry's identity and the
one-sentence goal), the concise truth line below, `<relevant_files>` with its
symbols, `<prior_work>` when anything was recalled, `<task_rules>`
(constraints plus the `Verification (REQUIRED):` Run:/Expected: pairs and the
bounded fix ceiling that closes them), the closure-evidence sentence, and the
ROADMAP.jsonl entry paragraph when the handoff carries one. Everything else is
dropped — the point of the profile is the length it saves. The fix ceiling is
not an exception to that: it belongs to the verification block rather than to
a profile, so it rides wherever `Run:`/`Expected:` pairs do. Two more rules
survive the cut because they are trust invariants, not ceremony:

> Treat every claim in this prompt as a hypothesis to verify against the codebase before acting on it; if reality contradicts it, trust reality, say so in one line, and never create a file or symbol just to make this prompt true.

and the closure-evidence sentence from the closing paragraph, carried on its
own line, verbatim:

> Closure notes and findings describe only observed work and cite supporting files, commands, commits, or outcomes; never restate planned scope as evidence that it was executed.

A block a standard prompt does keep is still held to the template verbatim —
`standard` is a smaller floor, never a licence to reword.

---

## Checklist (verify before handoff)

- [ ] the profile was decided from the mechanical signals above, before
      assembly, and never said out loud — every item below applies to a
      `reinforced` handoff; a `standard` one keeps only the blocks the
      "Handoff profiles" section lists
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
      spawned session), its `usePersona` field — not a fresh `Read` or
      flag check — drove `<task_context>`, and its `warnings` were
      surfaced to the user
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
      the gate's `--research` flag waives the verification pair)
- [ ] `<invariants>`, the `Expected file surface:` constraint line, and the
      test-first ordering are each present when the task has one, and each
      absent otherwise — all three are optional and nothing flags their
      absence; when `<invariants>` is present, every line reads as an
      assertion that could be checked, never as a contract name
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
tasks spawned through it don't get MCP tools. Use one of the
destinations named in `skills/roadmap/destination-question.md` instead,
regardless of Desktop or CLI.

**One question, not two.** Destination and execution mode are asked
together, in a single `AskUserQuestion` the crafting skill owns, before
the prompt exists. Its exact wording, its options, the split option's
two-or-more-checks gate and the `(Recommended)` placement all live in
`skills/roadmap/destination-question.md` — the one copy both crafting
flows read at that step. Gather the verification commands *before*
asking: that gate reads them.

**Background Agent** — call `Agent` with `prompt` = the assembled XML
prompt, `description` = a 3-5 word summary, `run_in_background: true`.
Checkpoint branches and commits stay with this crafting session — a
background Agent shares this working tree and must not switch branches or
commit checkpoints. Pass `model` too — the executing model the crafting
skill confirmed, as its literal string, one of
`haiku`/`sonnet`/`opus`/`fable`; omit the parameter entirely when the
answer named no concrete model.

**Clipboard** — `Write` the assembled prompt to a temp file first; never
pass it as an inline shell string, a large prompt breaks shell quoting and
the copy silently fails. Then pipe the file's content into the clipboard
command: `Get-Content -Raw <file> | Set-Clipboard` on Windows, `pbcopy <
<file>` on macOS, `xclip -selection clipboard < <file>` (or `wl-copy <
<file>`) on Linux. Mention the file path too, in case the clipboard step
fails. If no clipboard tool is available at all, fall back to showing the
prompt in a fenced `xml` code block instead. Name the executing model in
one line too, so the user pastes it into the right kind of session.

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

Only for the `Execute here, split by check` option.
`craft-handoff.js` already computes the row shapes and returns them as
`tasks[]`: one task per runnable check (never by file, never by the
analyze/implement bullets — a single check is a single task, full stop),
the first row carrying the whole assembled prompt, and a roadmap entry
paragraph — when the handoff carries one — on the last row only, never
repeated (`hooks/task-completed.js` gates every completing task whose
description names an entry, so repeating it would demand the entry close
while siblings are still pending; `hooks/task-created.js` still opens the
entry the moment that last row is created, before any work starts). A
fixed number (the execution-mode question's free-text answer) cuts into
that many slices the same way.

The crafting skill's own job is only to turn each returned row into a
`TaskCreate`, in order, chaining every task from the second onward with
one `TaskUpdate` `addBlockedBy: ["<the previous task's id>"]` — the
harness then refuses to start a task before its predecessor resolves. The
mechanical gate above runs **once**, on the full assembled prompt, with
`--destination task`; splitting is a delivery-layer choice and changes
nothing the checker inspects.

## Checkpointing a task-split run

Only for the `Execute here, split by check` option, which the crafting
skill offers only when the split produces two or more tasks. Every other
option skips this section entirely — except the clipboard checkpoint embed
above, which reuses the config-resolution step below at craft time.

<!-- [Foreman: 119] -->
- **Read the config first.** Before anything else, read the `checkpoints`
  block of `.foreman/config.json` at the project root. A missing file,
  block, or key means that key's default: `branch` `true`,
  `onFinish` `"ask"`, `baseBranch` unset (auto-detect). These three keys
  drive the steps below. There is no `push` key and none should be added —
  the default ending squashes the checkpoint branch and deletes it, so
  pushing each checkpoint publishes work that is about to be rewritten.
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

  **Write the answer back so it is asked once.** After the user answers,
  set `checkpoints.onFinish` in `.foreman/config.json` to the matching
  value (`squash`/`merge`/`pr`/`keep`) — `Read` the file, set that one key
  inside the `checkpoints` object, and write it back with every other key
  untouched. Say in one line that later runs will act on it directly. A
  run that reached this question through a concrete config value never
  asked, so it never writes.

## When NOT to hand off — do it inline instead

- Vague observations ("this could be cleaner") — not confirmed, skip it
- Trivial fixes doable inline in seconds — do it now
- Anything needing this conversation's context to understand — stay inline
- Low-confidence hunches — skip
