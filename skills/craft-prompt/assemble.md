# Assemble the handoff — one call to craft-handoff.js

No hand assembly — gather the judgment fields below, entirely from this
interview (no new investigation, same rule as every other step here), then
make one call to `node ${CLAUDE_PLUGIN_ROOT}/scripts/craft-handoff.js` with
the JSON on stdin (user text stays out of shell quotes, as above),
entry-less: no `"entry"` key, every field given inline instead. It resolves
the touched paths, assembles the XML from the canonical blocks, bakes the
checkpoint/split delivery artifacts, and runs the mechanical gate
in-process — nothing left here to re-derive or re-list. `tone`, `example`,
and `output_format` land only in a full-strength prompt, which most fresh
craft-prompt tasks are not, and the
project configuration can omit sections; if the user picked one of those
optional sections and it did not make it in, say so plainly rather than
acting as if it had.

- `host` ← `"claude"` in Claude Code, `"codex"` in Codex, `"antigravity"`
  in Antigravity, which the builder gives the Codex form of the prompt
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
- `judgment.context` ← Call 4's Background-context answer, if selected
- `judgment.observed` ← Call 3 Q3's observed failure, verbatim, when
  gathered and not `None observed`; never copy it into `judgment.context`,
  where it would lose the evidence wrapper
- `judgment.steps` ← Call 2 Q4's answer, split into implement/fix bullets
- `judgment.question` ← for an investigation or review, the question under
  investigation instead of `judgment.steps` — not a prescribed sequence.
  It defines the question and the expected findings and never turns into
  implementing a fix: its checks are evidence, and a failed check does not
  authorize implementation.
- `judgment.constraints` ← Call 4's Constraints answers, if selected, plus
  one more line for a review-flavored task (the `Code reviewer` role, or a
  task type the user described as a review or audit): "Report every
  finding you identify, including uncertain or low-severity ones, each
  with its location, a confidence level and an estimated severity, so
  filtering happens afterwards; reporting that the work is sound is a
  valid outcome. If a bar is given, apply it." Do not add a severity or
  importance filter of your own; a bar the user stated narrows the
  report. Encode an explicitly read-only scope here too; a
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
`${CLAUDE_PLUGIN_ROOT}`. The one exception is a clipboard `prompt`: it
names the root `craft-handoff.js` runs from, because a pasted prompt
reaches no shell that defines the variable; deliver it as returned.
Remember: the copy of this skill you are reading
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
