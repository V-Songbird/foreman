# How to run it — the shared destination question

The one copy of the destination question both prompt-crafting flows ask
(roadmap pick's Q2, craft-prompt's Call 5) — a fix here reaches both.
`prompt-template.md`'s delivery-mechanics section names the same step for
script authors and points here; the exact wording lives here. There is no
follow-up question about which model runs the work: Foreman never asks and
never sets one, so a background agent inherits the calling session's model
and a pasted prompt runs wherever the user pastes it.

**"How do you want to run this?"** — destination and execution mode in one
question, asked before the prompt exists. There is nothing to preview
yet; the answer decides how the prompt gets built and delivered, not the
other way around. When the user already named a destination, use it and skip
the question. Assemble and deliver only after the choice, and never ask for it
a second time.

**All four options are always offered, in this order.** None of them is
ever withheld, whatever the session looks like — the user knows things
Foreman does not, and a hidden option is a decision taken away from them
rather than a decision made for them. Foreman's whole say in the matter is
the two labels described under "Which option leads" and "Which options
carry a caution" below.

- `Execute here` — work the whole prompt in this session. The common case,
  and it changes nothing about your branches.
- `Execute here, split by check` — ordered rows, one per verification row,
  each finished row committed on a `foreman/<slug>` branch (the template's
  checkpoint protocol, applied through [delivery-split.md](delivery-split.md)).
- `Execute with a background agent` — offload it, get notified on completion — best for orchestration, where this session owns the commits
- `Copy prompt to clipboard` — just get the text, no execution

Ask it directly, without a permission preamble or an explanation that the
skill requires it:

- In Claude Code, one `AskUserQuestion` with the four options.
  `AskUserQuestion` appends its own free-text option; never author one.
- In Codex, use [the shared picker protocol](../foreman/questions.md), which
  also says how the four options fit the picker.
- In Antigravity, one `ask_question` with the four options, each description
  and any current caution in its own option text; the tool supplies the
  free-text answer itself.

A free-text answer naming the destination is honored, and so is a fixed number
of tasks, which [delivery-split.md](delivery-split.md) meets by merging
neighbouring rows.

## Probe the tree before asking

Always, before the question: run
`node ${CLAUDE_PLUGIN_ROOT}/scripts/safe-commit.js begin` once. It reads
`git status` and writes nothing, so taking it early costs a command and
changes no state; the delivery step takes its own boundary later
regardless. Two of the rules below need the answer, and one of them can
fire on a single check, so there is no cheaper moment and no condition
worth guarding it with.

Only a `dirty:false` result means this run can commit. Read the `dirty`
field and nothing else: a routine pick leaves Foreman's own bookkeeping in
the tree — the entry's `in_progress` flip on ROADMAP.jsonl, the sha a
previous close recorded there, a lesson written to `.foreman/notes.jsonl`
— and the probe already discounts all of it, returning `dirty:false` with
those paths named in `ledger_dirty`. A populated `ledger_dirty` is not a
dirty tree and never earns a caution — otherwise the split could never
lead on a tracked roadmap, because a pick always leaves one behind.

On **anything else** — `dirty:true`, a git failure, no repository at all — the split
still runs its tasks in order but commits nothing and creates no branch,
because `prompt-template.md`'s "Take the boundary first" rule turns both
off for the whole run. That is not a footnote to discover afterwards: it
is what the split's caution says, below.

A dirty tree is a caution on the background agent for a different reason:
it gets no checkout of its own, so it edits **this** working tree, alongside
whatever you have not committed yet.

## Which option leads

Exactly one option carries `(Recommended)`, and it is not always the same
one. Take the **first** rule below that holds and append the tag to that
option's label — never to two:

1. **A context reading arrived this turn** saying this session is at or
   above Foreman's line. Only a current, reliable reading counts: in Claude
   Code, Foreman's own `PostToolUse` hook emits it before this question when a
   compaction window is configured; Codex and Antigravity supply none today. No reading at
   all means this rule does not hold, not that it fails — unknown context is
   unknown, so never infer a percentage from transcript length, model name, or
   another host's configuration. Recommend `Copy prompt to clipboard`. A
   nearly-full session is the worst place to start fresh work: the handoff is
   self-contained by construction, so pasting it into an empty session
   loses nothing and buys back the whole window. The background agent is
   **not** the answer here — it reports back into this same session, so it
   spends the room it looks like it saves.
2. **Other work is already running and this task steers clear of it** —
   the menu's `in_progress` array holds at least one entry that is *not*
   the one just selected (a resume pick is that entry, so it never counts
   as other work), the selected row's `collision` is explicitly `false`,
   the probe said `dirty:false`, and the gathered `verification` holds at
   least one runnable check — an actual `run` command, not merely a non-empty
   array. A resume row carries no `collision` flag at all, and unknown is not
   false, so this rule cannot hold for one. The host must also be able to
   delegate, and in Codex an explicitly reviewed run also needs a coordinator
   that can relay each result to the user. Recommend
   `Execute with a background agent`. That combination is the one moment
   Foreman can see parallelism paying: something else is genuinely in
   flight, the two tasks share no planned file, the tree is clean enough
   that they will not tread on each other, and the agent has a runnable
   check to know it succeeded by. Missing any one of them, the option
   stays offered and simply does not lead. In `craft-prompt` there is no
   menu, so this rule never holds — that is correct, not a gap.
3. **At least two verification rows, each row after the first carrying its
   own slice of the work, and a `dirty:false` probe.** Recommend
   `Execute here, split by check`. Work that verifies in stages is work
   worth checkpointing in stages, and here it actually can.
4. **Otherwise.** Recommend `Execute here`.

**Never recommend the background agent outside rule 2.** It cannot ask
you a question, so an entry with nothing runnable has no way to tell
whether it got there, and it shares your working tree, so a collision or a
dirty tree makes an unattended run the riskiest option on the list rather
than the most convenient. It is still offered every time — it just never
leads on Foreman's own say-so.

Say the reason in the recommended option's own description, in the user's
terms and without the machinery: "this session is filling up, a fresh one
will do better" rather than a token count or a hook name. Quote the
percentage only if they ask for it.

## Which options carry a caution

An option the user can pick but that has a **named, currently-true reason
against it** carries `(Caution)` appended to its label, and says the
reason in its own description. Nothing else earns the tag: an option with
no live objection carries no label at all.

The word matters. Never write "(Not recommended)" or any other label
containing "recommend" — a user scanning labels reads the word, not the
negation in front of it, and two options both carrying "recommend" is
worse than no signal at all. `(Caution)` shares no word with
`(Recommended)`, which is the whole point of it.

The conditions, each one checked independently:

| Option | Carries `(Caution)` when | Say in the description |
| --- | --- | --- |
| `Execute here, split by check` | the probe did not return `dirty:false` | no commits and no branch — your tree already has uncommitted changes |
| `Execute here, split by check` | fewer than two verification rows were gathered | only one task, so this is `Execute here` under another name |
| `Execute here, split by check` | no row after the first names its own slice of the work | the later tasks would only run a command — one task holds everything |
| `Execute with a background agent` | the selected row's `collision` is true | it edits files another running task also plans to touch |
| `Execute with a background agent` | no runnable check was gathered (a human review is not a command) | nothing runnable, so it cannot tell whether it succeeded |
| `Execute with a background agent` | the probe did not return `dirty:false` | it edits this same tree, around your uncommitted changes |
| `Execute with a background agent` | this host has no callable delegation capability | this session cannot start one; the prompt can still be copied |
| `Execute with a background agent` | in Codex, review after each result was requested and no human or coordinator channel is known | nobody would be there to accept each result |

`Execute here` and `Copy prompt to clipboard` never carry it — neither has
a condition that can go wrong. When two rows hold for the same option, tag
it once and give the shorter reason.

**One `(Recommended)`, never on a cautioned option.** The two labels
cannot collide by construction: every rule that promotes an option already
requires the conditions its cautions test for. If you ever find both
applying, the reading is wrong — recheck the probe and the counts rather
than tagging one option twice.

Every option stays selectable. Neither label hides anything from the
list, and a user who picks a cautioned option gets it built exactly as
asked, with no second question and no talking them out of it. The execution
capability must still exist; be candid when it does not.

Never substitute an app-level task for any of these destinations. In Claude
Code, never call `mcp__ccd_session__spawn_task` — it only offers the user a
chip and runs nothing until they click it. The session a clicked chip opens
does have MCP tools (verified 2026-09-24 on desktop app 2.7032.0 with Claude
Code 2.1.280; other builds and hosts unverified). `TaskCreate`, `Agent`, and the
clipboard mechanics are the only delivery paths. `TaskCreate` needs a session
that has the tool; a Claude Code session without it, such as a desktop session
started from a task chip, works `Execute here` through [delivery.md's path
for a session without `TaskCreate`](delivery.md#execute-here). In Codex, a new
sidebar task is created only when the user explicitly asks for one. Delivery,
clipboard handling, and checkpoint commits are specified in
[delivery.md](delivery.md).
