# How to run it — the shared destination question

The one copy of the destination question both prompt-crafting skills ask
(roadmap pick's Q2, craft-prompt's Call 5) — a fix here reaches both.
`prompt-template.md`'s delivery-mechanics section names the same step for
script authors and points here; the exact wording lives here. There is no
follow-up question about which model runs the work: Foreman never asks and
never sets one, so a background Agent inherits the calling session's model
and a pasted prompt runs wherever the user pastes it.

**"How do you want to run this?"** — destination and execution mode in one
question, asked now, before the prompt exists. There is nothing to preview
yet; the answer decides how the prompt gets built and delivered, not the
other way around. Options, in this order:

- `Execute here` — one tracked task carrying the whole prompt, worked in
  this session. The common case, and it changes nothing about your
  branches.
- `Execute here, split by check` — one tracked task per verification
  command, each finished task committed on a `foreman/<slug>` branch (the
  calling flow's delivery step owns the checkpoint protocol). **Offer this
  option only when the gathered verification commands number two or
  more.**
- `Execute with a background Agent` — offload it, get notified on completion — best for orchestration, where this session owns the commits
- `Copy prompt to clipboard` — just get the text, no execution

## Probe the tree before asking

Always, before the question: run
`node ${CLAUDE_PLUGIN_ROOT}/scripts/safe-commit.js begin` once. It reads
`git status` and writes nothing, so taking it early costs a command and
changes no state; the delivery step takes its own boundary later
regardless. Two of the rules below need the answer, and one of them can
fire on a single check, so there is no cheaper moment and no condition
worth guarding it with.

Only a `dirty:false` result means this run can commit. On **anything
else** — `dirty:true`, a git failure, no repository at all — the split
still runs its tasks in order but commits nothing and creates no branch,
because `prompt-template.md`'s "Take the boundary first" rule turns both
off for the whole run. That is not a footnote to discover afterwards: say
it in the option's own description ("no commits — your tree already has
uncommitted changes") and never let that option lead. A split whose
selling point is per-check commits must not be recommended when it cannot
make one.

A dirty tree is a caution on the background Agent for a different reason:
Foreman dispatches it without `isolation`, so it edits **this** working
tree, alongside whatever you have not committed yet. Say that in its
description too when the probe came back dirty.

## Which option leads

Exactly one option carries `(Recommended)`, and it is not always the same
one. Take the **first** rule below that holds and append the tag to that
option's label — never to two:

1. **A context reading arrived this turn** saying this session is at or
   above Foreman's line — Foreman's own `PostToolUse` hook emits it before
   this question, and no reading at all means this rule does not hold, not
   that it fails. Recommend `Copy prompt to clipboard`. A nearly-full
   session is the worst place to start fresh work: the handoff is
   self-contained by construction, so pasting it into an empty session
   loses nothing and buys back the whole window. The background Agent is
   **not** the answer here — it reports back into this same session, so it
   spends the room it looks like it saves.
2. **Other work is already running and this task steers clear of it** —
   the menu's `in_progress` array holds at least one entry that is *not*
   the one just selected (a resume pick is that entry, so it never counts
   as other work), the selected row's `collision` is explicitly `false`,
   the probe said `dirty:false`, and the gathered verification array is
   non-empty. A resume row carries no `collision` flag at all, and unknown
   is not false, so this rule cannot hold for one. Recommend
   `Execute with a background Agent`. That combination is the one moment
   Foreman can see parallelism paying: something else is genuinely in
   flight, the two tasks share no planned file, the tree is clean enough
   that they will not tread on each other, and the agent has a runnable
   check to know it succeeded by. Missing any one of the four, the option
   stays offered and simply does not lead. In `craft-prompt` there is no
   menu, so this rule never holds — that is correct, not a gap.
3. **Two or more checks and a `dirty:false` probe.** Recommend
   `Execute here, split by check`. Work that verifies in stages is work
   worth checkpointing in stages, and here it actually can.
4. **Otherwise.** Recommend `Execute here`.

**Never recommend the background Agent outside rule 2.** It cannot ask
you a question, so an entry with nothing runnable has no way to tell
whether it got there; and it shares your working tree, so a collision or a
dirty tree makes an unattended run the riskiest option on the list rather
than the most convenient. The option is always *offered* — the user knows
things Foreman does not, starting with whether they want to do something
else meanwhile — it just never leads on Foreman's own say-so.

Say the reason in the recommended option's own description, in the user's
terms and without the machinery: "this session is filling up, a fresh one
will do better" rather than a token count or a hook name. Quote the
percentage only if they ask for it. The tag is a recommendation and
nothing more — every option stays selectable, and no rule firing ever
removes another option.

Never call `mcp__ccd_session__spawn_task` for any of these — it has a known
bug where tasks spawned through it don't get MCP tools. `TaskCreate`,
`Agent`, and the calling flow's clipboard mechanics are the only three
delivery paths, regardless of Desktop or CLI.

`AskUserQuestion` appends its own free-text option; never author one — a
user's free text naming the pieces, or a fixed number of tasks, both mean
the split cuts into that many slices at whatever verification boundaries
exist instead of one-per-check. Don't add a confirmation question — the
created rows are the preview, and a wrong one is removed with `TaskUpdate`
`status: "deleted"`.
