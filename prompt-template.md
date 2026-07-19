# Foreman — prompt template

<!-- foreman:practices lastmod:2026-07-18
     source-a: https://code.claude.com/docs/en/best-practices.md
     source-b: https://code.claude.com/docs/en/sub-agents.md
     source-c: Anthropic Prompting 101 — Code w/ Claude 2025-05-22
     source-d: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5
     source-e: Claude Code 2.1.214 embedded delegation guidance -->

The handed-off session — whether run via `TaskCreate` in this session, a
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
   [...], "targetModel": "haiku"|"sonnet"|"opus"|"fable"|"inherit", "warnings":
   [...]}`. All of it is project **declaration** — foreman never inspects
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
     main-loop sessions (a pasted interactive session, or `TaskCreate` run
     here), never a background agent's, so the omission's premise fails
     there; the kept default still self-yields if a style does govern. The
     other three tags have no destination dependence.
   - `targetModel` — default `"inherit"` whenever the field is missing,
     unparseable, or not one of the five valid strings (that last case
     also adds a `warnings` entry). Declaration, not detection, same as
     `usePersona` — never a claim about what the target model will
     actually manage, only how much elaboration `relevant_files`/
     `context`/`task_rules` below carry:
     - `haiku` — elaborate fully: name the exact symbol or behavior at
       stake in `context`, not just the file; write the verification
       block's `Expected:` line as the literal output or exit code, not a
       category; one concrete action per `task_rules` bullet, nothing
       compounded. Grounded in Foreman's own handoff benchmark: on Haiku,
       the most-detailed of the structured prompt formats tested posted
       the lowest reads-before-first-edit of the three on every fixture
       measured, at equal-or-better correctness — thoroughness measurably
       cut this model's exploratory overhead, never added to it.
     - `sonnet`, `opus`, `fable`, `inherit` — assemble exactly as already
       described above; do not add elaboration beyond what the gathered
       answers actually supplied. Grounded (for `sonnet`) in the same
       benchmark: correctness saturated at 100% across every prompt format
       tested, while the most-detailed format cost the most of the four in
       every single task for identical correctness — extra elaboration
       bought nothing there. `opus` has no runs in that benchmark; absent
       evidence for a distinct treatment, it gets today's default rather
       than an invented one. `fable` is grounded in the official Fable
       prompting guide (source-d): brief steering beats enumerating each
       behavior, so the default level with nothing added is the
       evidence-matched treatment.
   - `warnings` — surface briefly to the user (skipped entries from a
     malformed config); never blocks assembly.

```xml
<task_context>
[If step 0's `usePersona` is `true`: "You are [specific role — e.g. "a
senior security engineer", "a TypeScript developer"]." If `false`: a
persona is established elsewhere — use domain framing, "Domain: [specific
role/specialization].", never a second "You are a" sentence.]
Your goal is [one sentence — what "done" looks like for this specific task].
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
Include every file. No vague references like "the auth module".]
</relevant_files>
<context>
[Architectural decisions, constraints, patterns already in use.
Anything needed to understand the codebase without prior conversation.
Example: "Uses JWT tokens in httpOnly cookies. No third-party auth libs."]
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
Do NOT claim success without running this. If it fails, iterate until it passes.
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

Reason through the approach and edge cases in your thinking before editing — not in prose between tool calls. The steps and commands above are a working plan, not a narration script: whatever output style governs this session decides what you say aloud, so don't announce step transitions or restate command results in chat. The same style governs the register of your final message. Full evidence and findings belong in their durable home — the roadmap entry, the commit message, or the artifact the task names — with the final message stating the outcome and pointing there.

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
      flag check — drove `<task_context>`; its `targetModel` field drove
      how much elaboration went into `relevant_files`/`context`/
      `task_rules` below
- [ ] `relevant_files` lists every file path with line ranges — no vague
      references (`craft-prompt`: from the user directly; `foreman:roadmap`:
      the entry's `touches` passed through as-is, never upgraded by
      exploring the codebase — `truth_grounding` covers that gap at
      handoff time)
- [ ] `task_rules` has read/analyze/implement steps AND a runnable
      verification command with expected output (a pure-investigation
      handoff carries the question plus exact commands instead of steps,
      and the gate's `--research` flag waives the verification pair)
- [ ] custom sections were rendered by `render-sections.js` and inlined
      verbatim after `task_rules` — never hand-written — and its
      `warnings` were surfaced to the user
- [ ] every tag in `omit` is absent from the assembled prompt, overriding
      a conflicting per-prompt selection (exception: an omitted `tone`
      stays for a background-`Agent` destination — step 0's carve-out);
      guardrail/core blocks are never affected
- [ ] no "as we discussed" / "from earlier" — zero assumed context
- [ ] a verb-first imperative name (under 60 chars) and a 1–2 sentence
      plain-language summary are ready — `TaskCreate` and a background
      `Agent` both need them
- [ ] the destination (`TaskCreate` / background `Agent` / clipboard) was
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

- `--destination` — `task` for TaskCreate, `agent` for a background
  Agent, `clipboard` for copy. This is how the checker knows whether an
  omitted `tone` must stay (agent) or go.
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
applies to what the fields actually say.

## When NOT to hand off — do it inline instead

- Vague observations ("this could be cleaner") — not confirmed, skip it
- Trivial fixes doable inline in seconds — do it now
- Anything needing this conversation's context to understand — stay inline
- Low-confidence hunches — skip
