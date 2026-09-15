# Deliver a checked handoff

Both hosts follow this file; a line that names a host applies to that host
only. The crafting flow has already settled the destination
([destination-question.md](destination-question.md)) and called
`craft-handoff.js`.

Deliver via whatever the user picked, using the `prompt` (and `tasks[]` when
present) that `craft-handoff.js` just returned — never re-derive, re-split, or
re-embed any of it. Open every delivery message with a brief: one or two
sentences in everyday words on what is about to change and why it matters,
drawn from the entry's `why` and `what` (or, with no entry, the user's
request), restated for a teammate who has never seen this codebase — never the
fields pasted verbatim. The brief is chat-only; `prompt`/`tasks[]` stay dense
and untranslated, and neither is pasted or printed into the chat response
unless the user asks to see it — they are data for a tool call. In Codex,
preserve a requested `reviewEachIncrement` choice and each row's attached
checks; one mixed row is one increment.

A roadmap entry stays `planned` while its prompt is crafted, delivered, or
copied; only the session that actually starts the work opens it.

## Execute here

- In Claude Code, one `TaskCreate` (`subject` a verb-first imperative ≤60
  chars derived from the entry's `title` or the request, `description` =
  `prompt`, `activeForm` its present-continuous form), then work it in this
  session with `TaskUpdate` marking it `in_progress` then `completed`.
  Foreman's `task-created` hook marks the entry `in_progress` mechanically the
  moment the row carrying the embedded entry paragraph is created — finding it
  already `in_progress` when the embedded instruction runs is expected, and
  re-running that update is a harmless no-op.
- In Codex, work the prompt directly. A plan tool may track progress, but it
  does not replace the roadmap lifecycle: open a selected entry when work
  starts with `hooks/codex-task.js start` as
  [the runtime](../foreman/runtime.md) describes, verify the result, and record
  its outcome and evidence before reporting completion.

### Execute here, split by check

The craft call passed `"split":true`, so `tasks[]` holds the rows: the full
prompt on row 1, the entry paragraph on the last row only — already baked,
never re-split by hand. Work them in order; each row's check verifies that
row's own work.

- In Claude Code, one `TaskCreate` per row, in order (each row's own
  `subject`/`description`, plus its own present-continuous `activeForm`), each
  chained to the previous one with `TaskUpdate` `addBlockedBy: ["<previous
  task's id>"]`; `TaskUpdate` per row as you go.
- In Codex, keep that order with a supported plan tool or an explicit local
  sequence; there is no assumed native task-dependency API. When
  `reviewEachIncrement:true` is present, follow the
  [increment review protocol](increment-review.md) after every result — the
  same protocol is embedded in the generated prompt, including for one
  reviewed row. Keep the current result pending until a real answer arrives; a
  passing check or a submitted question does not permit the next row or the
  parent close. When resuming, follow
  [resume-increments.md](resume-increments.md) before dependent work.

**Checkpoint protocol.** The one copy lives in
[prompt-template.md](../../prompt-template.md)
(`${CLAUDE_PLUGIN_ROOT}/prompt-template.md`), section "Checkpointing a
task-split run". Read that section before an implementation split run, or a
run producing explicitly authorized decision artifacts, and follow it exactly:
it owns the config defaults, the `safe-commit.js begin` boundary, the branch
rule, the per-task commit — including the `unexpected_files` refusal, which is
shown to the user and re-run with `--allow-unexpected` only on their approval
(an explicit earlier authorization of those files counts) — the rule that
checkpoints stay local and are never pushed, the roadmap-entry close, and what
happens to the branch at the end. A branch restriction the user gave overrides
every configured finish policy. Two things that section does not say and this
flow does: a roadmap handoff always carries an entry, so its entry close
always applies — stage with `safe-commit.js finish --no-commit`, close with
`staged:true`, then commit with `Foreman: <id>` as the message's final line;
and skip checkpointing and just work the tasks if git is unavailable.

An investigation (`judgment.question`) uses split rows to collect diagnostic
evidence: skip checkpointing, branch creation, staging, and commits; a failed
check remains evidence, never a reason to implement. For a decision,
checkpoint only explicitly authorized decision artifacts.

## Background agent

When the user chose it, dispatch it. The agent shares this working tree: it
never switches branches or commits checkpoints, and it inherits this session's
model — never pass one.

- In Claude Code, call `Agent` with `prompt` = the returned `prompt`,
  `description` = a 3-5 word summary, and `run_in_background: true`. The tool
  result trails with the dispatched agent's id (`agentId: a<16 hex>`). For a
  roadmap entry, capture it immediately with one annotate call, so a later
  session can resume this exact agent instead of re-crafting a prompt from its
  notes:
  `` echo '{"id":"<id>","notes":"dispatched to background agent `<agent-id>`"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js annotate ``
  (the script date-stamps each appended note itself — don't write one in). The
  phrase "background agent" followed by the backticked id is the exact marker
  grammar the resume flow parses — the id's own charset (`a` + lowercase hex)
  never needs escaping. The agent's own handoff opens and closes its entry.
- In Codex, use the available collaboration tools for a bounded task, passing
  the returned prompt and the shared-tree ownership restriction. If delegation
  is unavailable, keep the handoff ready and explain that constraint; never
  silently replace a requested background run with a new app task. For a
  roadmap entry, append the returned agent id with `roadmap.js annotate` as
  `dispatched to Codex subagent <id>`, plus a session identifier when the host
  supplies one, so a later resume knows whether the handle can still be live.
  Wait for the agent, inspect its verification, and perform the coordinator
  bookkeeping; its completion notification is its actual return, not a
  scheduled automation. Do not imply that a shared-tree subagent survives the
  host session.

## Clipboard or prompt file

Write the returned `prompt` to a UTF-8 temp file first — never pass it as an
inline shell string: a large prompt breaks shell quoting and the copy silently
fails. When the user chose the clipboard, pipe the file's content into the
clipboard command: `Get-Content -LiteralPath <file> -Raw -Encoding utf8 | Set-Clipboard`
on Windows, `pbcopy < <file>` on macOS, `xclip -selection clipboard < <file>`
(or `wl-copy < <file>`) on Linux. A prompt-file-only request skips the
clipboard. Mention the file path too, and claim "copied" only after the copy
succeeded. If no clipboard command works, deliver the file path; a fenced
`xml` block in chat is the last fallback, only when no usable file can be
delivered. Include the schema artifact too for a structured-output handoff.

Any checkpoint protocol a multi-row prompt needs already rides inside
`prompt`'s own `task_rules` — craft-handoff baked it in; nothing more to do
here. A prompt carries its crafting host's plugin paths: to run it in the
other host, craft it again there. In Codex, follow the builder's relocation
line when the installed plugin has moved, and keep an explicitly reviewed run's embedded
`increment_review` block intact even for one row; without a human or
coordinator channel the pasted worker leaves the result pending and stops.

## Explicit new Codex task

In Codex, when the user explicitly chooses a new app task, use the available
app task creation tools, their real project inventory, and their documented
worktree default. Pass the complete checked prompt and preserve the user's
branch restrictions. Report the created task through the app's returned
reference. If those tools are absent, supply a prompt file for the user to
paste. This is an explicitly requested extension, not a replacement for
background agents.

## Close and acceptance

Record observed files, commands, commits, outcomes, and any `unverified:`
checks in entry notes. If the ledger is enabled, a useful lesson is one
factual sentence anchored to the task's actual files, within the writer's
length limit; never fabricate one to fill a field.

With `requireVerification:true`, completed implementation becomes
`awaiting_acceptance`; summarize the evidence and ask the user to accept or
review. When checks remain unverified after that evidence comparison, offer
testing those checks first and keep the entry awaiting. An explicit acceptance
closes it; feedback that the work is not ready returns it to `in_progress`
with the feedback recorded. A background worker leaves acceptance to its
coordinator. No new task starts while a required acceptance decision is
pending unless the user explicitly chooses separate work.

In Codex, an explicitly reviewed run records intermediate decisions with
`annotate` and keeps the parent open: do not apply this whole-task close while
a row is awaiting review or correction ([increment review](increment-review.md)),
and use [close-increments.md](close-increments.md) to reconcile omitted checks
with later evidence and to tell last-row acceptance from acceptance of the
integrated task.
