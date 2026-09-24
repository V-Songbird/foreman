# Deliver a checked handoff

Every host follows this file; a line that names a host applies to that host
only, and a line that names Codex also applies to Antigravity unless an
Antigravity line replaces it. The crafting flow has already settled the destination
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

Each destination beyond `Execute here` has its own file. Read the one the user
picked and follow it together with this file:

- `Execute here, split by check` — [delivery-split.md](delivery-split.md)
- `Execute with a background agent` — [delivery-agent.md](delivery-agent.md),
  which also covers an explicitly requested new Codex task
- `Copy prompt to clipboard`, or a prompt file only —
  [delivery-clipboard.md](delivery-clipboard.md)

## Execute here

- In Claude Code, one `TaskCreate` (`subject` a verb-first imperative ≤60
  chars derived from the entry's `title` or the request, `description` =
  `prompt`, `activeForm` its present-continuous form), then work it in this
  session with `TaskUpdate` marking it `in_progress` then `completed`.
  Foreman's `task-created` hook marks the entry `in_progress` mechanically the
  moment the row carrying the embedded entry paragraph is created — finding it
  already `in_progress` when the embedded instruction runs is expected, and
  re-running that update is a harmless no-op.
- A Claude Code session without `TaskCreate`, such as a desktop session
  started from a task chip, creates no row, so the hook never opens the
  entry. Say once that the task could not be tracked, open the entry yourself
  with the `update-status` `in_progress` call its entry paragraph embeds,
  before any other step, then work the prompt, or each `tasks[]` row, in
  order with every check.
- In Codex, work the prompt directly. A plan tool may track progress, but it
  does not replace the roadmap lifecycle: open a selected entry when work
  starts with `hooks/codex-task.js start` as
  [the runtime](../foreman/runtime-codex.md) describes, verify the result, and record
  its outcome and evidence before reporting completion.

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
