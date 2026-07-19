---
name: craft-prompt
description: Interactive prompt builder. Guides you through assembling a self-contained spawned-session prompt following Foreman's template — asks which optional sections to include, gathers required info via AskUserQuestion, assembles the XML, then hands it off via TaskCreate, a background Agent, or copies it to the clipboard.
when_to_use: Trigger when the user wants to create a task, spawn a background agent, craft a prompt for a spawned session, or says "craft a prompt", "build a prompt", "foreman prompt", "new task prompt", or invokes /foreman:craft-prompt.
argument-hint: "<brief task description — optional seed>"
allowed-tools: AskUserQuestion, TaskCreate, Agent, Read, Write, Bash, PowerShell
---

# foreman:craft-prompt — interactive prompt builder

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

**Q2** — "What does 'done' look like? One sentence."
Options: `Bug is fixed and all tests pass`, `Feature is implemented and tested`, `Findings are written to a file in the repo, cited`, `Refactor complete — no behavior change`

**Q3** — "List the relevant files with line ranges where known."
Options: `I'll list them` (nudge user to use Other and type paths like `src/auth/middleware.ts:42-80 — token refresh logic`)

**Q4** — "Describe the three steps: read/explore, then analyze/check, then implement/produce."
Options: `I'll describe them`

---

## Call 3 — verification (conditional)

Skip this call only if the task type is pure research/investigation with no code changes.

**Q1** — "What command verifies success?"
Options: `npm test`, `npm run build`, `pytest`, `cargo test`, `go test ./...`

**Q2** — "What's the expected outcome?"
Options: `All tests pass`, `Build succeeds with exit code 0`, `No lint errors`, `Report file produced`

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

---

## Resolve project config (craft-time, once)

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/render-sections.js` now — the one
mechanical call that resolves `usePersona`/`sections`/`omit`/
`targetModel`. Every step below (Call 6's default, Assemble the prompt's
elaboration scoping, Deliver's clipboard recommendation) reads this same
result. Nothing past this point calls it again.

---

## Call 5 — destination

Ask this now, before the prompt exists, not after assembly. There is
nothing to preview yet; the destination decides how the prompt gets
delivered, not the other way around.

**Q1** — "How do you want to run this?"
Options:
- `Execute with TaskCreate` — track it and work it in this session
- `Execute with a background Agent` — offload it, get notified on completion
- `Copy prompt to clipboard` — just get the text, no execution

**Never call `mcp__ccd_session__spawn_task`** — it has a known bug where
tasks spawned through it don't get MCP tools. Use one of the three options
above instead, regardless of Desktop or CLI.

---

## Call 6 — executing model (conditional)

Ask this only when Call 5 Q1's answer was "Execute with a background
Agent" — its default depends on that answer, so it can't batch into Call
5's own question. Skip it for the other two destinations:
- **TaskCreate** runs the task in this session — no model choice exists.
- **Clipboard** has nothing to execute yet; see Deliver's clipboard branch
  below for a recommendation instead of a question.

**Q1** — "Which model should the background Agent run on?"
Always four options, reordered so the one matching `targetModel`
(resolved above) leads, with `(Recommended)` appended to its label — same
convention `foreman:roadmap`'s Q1 uses for its top-ranked candidate:
- `Haiku` — the background Agent runs on Haiku.
- `Sonnet` — the background Agent runs on Sonnet.
- `Opus` — the background Agent runs on Opus. When `targetModel` resolved
  to `fable`, a `Fable` option takes this slot instead (the Agent tool
  accepts `fable` as a model value).
- `Inherit the session's model` — omits the `Agent` call's `model`
  parameter entirely, running on whatever model launched this session;
  leads when `targetModel` resolved to `inherit`.

The user can always override the default. Record the answer for Deliver's
background-Agent branch below: a concrete model becomes that literal
`model` value (`haiku`/`sonnet`/`opus`/`fable`); `Inherit the session's model`
means leaving `model` out of the call.

---

## Assemble the prompt

Follow `${CLAUDE_PLUGIN_ROOT}/prompt-template.md` exactly for its XML
template, verbatim. Its craft-time environment check (`render-sections.js`)
already ran above, before Call 5 — use that same result, don't invoke it
again. Never re-derive or duplicate the per-model elaboration guidance
`targetModel` drives either; if the template changes, this skill picks up
the change automatically by reading it fresh each time. Map this skill's
gathered fields onto the template's placeholders:

- `task_context`: role ← Call 2 Q1, goal ← Call 2 Q2
- `relevant_files` ← Call 2 Q3
- `task_rules`: steps ← Call 2 Q4; Constraints ← Call 4's Constraints
  answers, if selected; Verification ← Call 3, if gathered
- `tone` ← Call 4's Tone answer, if selected (overrides the template's
  default entirely, same as the template already says); otherwise the
  template's own craft-time gate applies unchanged
- `background`/`context` ← Call 4's Background-context answer, if selected
- `example` ← Call 4's Example answer, if selected
- `output_format` ← Call 4's Custom-output-format answer, if selected;
  otherwise the template's own default applies
- `output_format`/`tone` ← if `Workflow stage` was selected instead: the
  template's Workflow-stage flavor overrides both (fixed sentence,
  mechanical tone omission, schema-authoring and delivery rules all live
  there) — the schema itself derives from Call 4's Workflow-stage answer

**Never paste or print the assembled prompt into your response text** — it
is data for `TaskCreate`'s `description`, `Agent`'s `prompt`, or a temp
file piped to clipboard, not something to show the user. The one
exception is the clipboard-fallback fenced block in "Deliver" below, used
only when no clipboard tool exists.

Before moving to the next phase, verify the assembled prompt against
`prompt-template.md`'s own checklist, then run its mechanical gate
(`scripts/check-prompt.js` — the template's "Mechanical gate" section has
the exact call) and fix every error until it passes — don't re-list
either here.

---

## Deliver

Deliver via whatever Call 5 picked — no further question.

**If TaskCreate:** call `TaskCreate` with `subject` = a verb-first
imperative ≤60 chars derived from the task description, `description` = the
assembled XML prompt, `activeForm` = its present-continuous form. Then work
the task in this session, using `TaskUpdate` to mark it `in_progress` then
`completed` as you go.

**If background Agent:** call `Agent` with `prompt` = the assembled XML
prompt, `description` = a 3-5 word summary, `run_in_background: true`, and
`model` = Call 6's answer — a concrete choice as its literal string
(`haiku`/`sonnet`/`opus`/`fable`); omit the `model` parameter entirely when
the answer was "Inherit the session's model".

**If clipboard:** `Write` the assembled prompt to a temp file first — never
pass it as an inline shell string, a large prompt breaks shell quoting and
the copy silently fails. Then pipe the file's content into the clipboard
command: `Get-Content -Raw <file> | Set-Clipboard` on Windows, `pbcopy <
<file>` on macOS, `xclip -selection clipboard < <file>` (or `wl-copy <
<file>`) on Linux. Mention the file path too, in case the clipboard step
fails. If no clipboard tool is available at all, fall back to showing the
prompt in a fenced `xml` code block instead. If `targetModel` resolved to
a concrete model, add one more line alongside the file path: "Recommended
model: [Haiku/Sonnet/Opus/Fable] — this prompt's elaboration level was
calibrated for it." Skip that line when `targetModel` resolved to
`inherit` — the project declared no fixed target, so there's nothing to
recommend.
