# Foreman — prompt template

<!-- foreman:practices lastmod:2026-07-04
     source-a: https://code.claude.com/docs/en/best-practices.md
     source-b: https://code.claude.com/docs/en/sub-agents.md
     source-c: Anthropic Prompting 101 — Code w/ Claude 2025-05-22
     source-d: https://code.claude.com/docs/en/about-claude/models/prompting-fable5 -->

The handed-off session — whether run via `TaskCreate` in this session, a
background `Agent`, or copy-pasted elsewhere — has **zero memory** of this
conversation. Fill every required section. A self-contained prompt is not
optional — it is the only way the handed-off work can act correctly.

---

## Template

**Craft-time environment check (do this now, once, while assembling — not
an instruction for the spawned session to act on later):**

0. **One mechanical call covers persona/custom-sections/omissions.** Run
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/render-sections.js` — always, whether
   or not a project root is in scope (it resolves one from
   `$CLAUDE_PROJECT_DIR`/cwd regardless, and fails soft to defaults if no
   `.foreman/config.json` exists there). It prints one JSON object:
   `{"usePersona": bool, "sections": [{"tag", "xml"}], "omit": [...],
   "warnings": [...]}`. All of it is project **declaration**, never
   detection — foreman does not inspect which style plugins (hush, or any
   third-party one) the operator runs; a project that wants crafted
   prompts to coexist with one simply declares the shape it wants here:
   - `usePersona` — `.foreman/config.json`'s flag (default `true` if the
     file or field is missing/unparseable; standalone use with no config in
     scope also reads as `true`). Controls only the opening of
     `task_context` below: persona sentence vs domain framing.
   - `sections` / `omit` / `warnings` — `.foreman/config.json`'s optional
     `customSections` array (`[{"tag": "...", "content": "..."}]`) and
     optional `omitSections` array (`["tone", "example", "background",
     "output_format"]` — only these four are ever valid, they're the
     template's already-conditional tags; a guardrail like
     `scope_discipline` or `truth_grounding` can never appear here), both
     validated mechanically. Inline every `sections[].xml` value, in order,
     verbatim, at the `[CUSTOM SECTIONS]` placeholder below — never invent,
     edit, or reorder its content, that defeats the point of it being
     project-defined. If `sections` is empty, remove the placeholder line
     entirely. For every tag name in `omit`, drop that whole block from the
     assembled prompt regardless of what Call 1's optional-section
     selection or the entry's own fields would otherwise include — a
     project-level `omitSections` always wins over a per-prompt selection,
     since it's the more specific, more recently-stated intent. Surface any
     `warnings` briefly to the user (a skipped entry — bad tag,
     reserved/non-omittable tag, duplicate, empty content) so a malformed
     `config.json` doesn't fail silently; a warning here never blocks the
     rest of the assembly.

```xml
<task_context>
[If step 0's `usePersona` is `true`: "You are [specific role — e.g. "a
senior security engineer", "a TypeScript developer"]." If `false`: the
project has declared that a persona is established elsewhere (e.g. a style
plugin sets one in whatever session runs this) — a second
"You are a [role]" sentence would read as a competing identity claim, not a
layered one. Use domain framing instead: "Domain: [specific
role/specialization]."]
Your goal is [one sentence — what "done" looks like for this specific task].
</task_context>

<truth_grounding>
Before acting on anything in this prompt, verify it against the current state
of the codebase — read the cited files, run the cited commands. This prompt
may have been written earlier and executed later (queued via TaskCreate, run
by a background Agent, or pasted into a fresh session); treat every claim
below as a hypothesis to confirm at the start of this session, never as a
fact to assume. If reality contradicts this prompt, trust reality, name the
discrepancy in your final report, and proceed from what you actually find.
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
`<tone>` block unconditionally — a project-level opt-out beats everything
below.]
<tone>
[If Tone was selected as an optional section: the user's custom tone,
full stop — it replaces everything below. Otherwise include: "Minimal,
professional conversation — silent by default, say only what the user
actually needs to know, simplify technical explanations, avoid unnecessary
jargon." Projects where a style plugin (hush, or any third-party one) already governs
tone in the destination session opt out via `omitSections: ["tone"]` —
that's the `omit` check above, there is no plugin detection here.]
</tone>

[If `"background"` is in `omit`, drop this whole `<background>` block
unconditionally.]
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

<task_rules>
- [What to read or explore first]
- [What to analyze or check next]
- [What to implement, fix, or produce]

Constraints:
- [Hard limits — files NOT to modify, interfaces NOT to break]
- [Style or pattern to follow — point to an example file if one exists]

Verification (REQUIRED):
Run: [exact command — e.g. "npm test -- --testPathPattern=auth"]
Expected: [pass/fail signal — e.g. "all tests pass", "exit code 0"]
Do NOT report success without running this. If it fails, iterate until it passes.
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

Reason through the approach and edge cases in your thinking before editing — not in prose between tool calls. The steps and commands above are a working plan, not a narration script: whatever output style governs this session decides what you say aloud, so don't announce step transitions or restate command results in chat.

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
```

---

## Checklist (verify before handoff)

- [ ] `task_context` names a specific role (or, if step 0's `usePersona`
      came back `false`, domain framing instead of a "You are a" sentence)
      and a concrete one-sentence "done" state
- [ ] `truth_grounding` block is present, unmodified — every handoff must carry it
- [ ] `scope_discipline` block is present, unmodified — every handoff must carry it
- [ ] `render-sections.js` was run once at craft time (not deferred to the
      spawned session) and its `usePersona` field — not a fresh `Read` or
      any plugin-flag check — drove `<task_context>` above
- [ ] `relevant_files` lists every file path with line ranges — no vague
      references (for `craft-prompt`, get this from the user directly; for
      `foreman:roadmap`, pass the entry's `touches` through as-is — do NOT
      explore the codebase to upgrade area-level hints into exact
      file:line ranges, `truth_grounding` covers that gap at handoff time)
- [ ] `task_rules` has read/analyze/implement steps AND a runnable verification command with expected output
- [ ] custom sections (if `.foreman/config.json` had a `customSections`
      array) were rendered via `render-sections.js` and inlined verbatim
      after `task_rules` — never hand-written or invented here — and any
      `warnings` it returned were surfaced to the user
- [ ] every tag in `render-sections.js`'s `omit` array (only ever
      `tone`/`example`/`background`/`output_format`) is actually absent
      from the assembled prompt, overriding Call 1's selection if the two
      conflict — `task_context`/`truth_grounding`/`scope_discipline`/
      `task_rules` are never affected, `omitSections` can't touch them
- [ ] prompt contains no phrases like "as we discussed" or "from earlier" — zero assumed context
- [ ] a short verb-first imperative name (under 60 chars) and a 1–2 sentence
      plain-language summary are ready — `TaskCreate`'s `subject`/`description`
      and a background `Agent`'s `description` both need this
- [ ] the destination (`TaskCreate` / background `Agent` / clipboard) was
      asked and decided *before* assembling this prompt, and the raw XML is
      never pasted into the chat response — it goes straight to whichever
      destination was picked (clipboard's no-tool fallback is the only
      exception)

## When NOT to hand off — do it inline instead

- Vague observations ("this could be cleaner") — not confirmed, skip it
- Trivial fixes doable inline in seconds — do it now
- Anything needing this conversation's context to understand — stay inline
- Low-confidence hunches — skip
