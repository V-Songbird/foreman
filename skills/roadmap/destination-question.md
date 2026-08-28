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

## Probe the tree before offering the split

Only when the gathered verification commands number two or more, and so
the split option is about to appear: run
`node ${CLAUDE_PLUGIN_ROOT}/scripts/safe-commit.js begin` once, before the
question. It reads `git status` and writes nothing, so taking it early
costs a command and changes no state; the delivery step takes its own
boundary later regardless.

Only a `dirty:false` result means this run can checkpoint. On **anything
else** — `dirty:true`, a git failure, no repository at all — the split
still runs its tasks in order but commits nothing and creates no branch,
because `prompt-template.md`'s "Take the boundary first" rule turns both
off for the whole run. That is not a footnote to discover afterwards: say
it in the option's own description ("no commits — your tree already has
uncommitted changes") and never let that option lead. A split whose
selling point is per-check commits must not be recommended when it cannot
make one.

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
   loses nothing and buys back the whole window.
2. **Two or more checks and a `dirty:false` probe.** Recommend
   `Execute here, split by check`. Work that verifies in stages is work
   worth checkpointing in stages, and here it actually can.
3. **Otherwise.** Recommend `Execute here`.

Say the reason in the recommended option's own description, in the user's
terms and without the machinery: "this session is filling up, a fresh one
will do better" rather than a token count or a hook name. Quote the
percentage only if they ask for it. The tag is a recommendation and
nothing more — every option stays selectable, and rule 1 firing never
removes `Execute here`.

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
