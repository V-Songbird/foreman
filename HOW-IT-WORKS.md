# Foreman — how it works

The [README](README.md) says what Foreman is for. This page says how it does
it, for anyone who wants to know before they trust it with a plan.

Foreman runs inside two assistants, Claude Code and Codex. This page calls the
assistant a *host*. Everything below works the same on both hosts unless a
section says otherwise.

## The roadmap is a file

Foreman keeps your plan in a file in your project called `ROADMAP.jsonl`. One
task per line. It is an ordinary text file, so you can read it with Foreman
switched off, put it in version control, or open it in any editor.

Every field in it is explained in [`roadmap-schema.md`](roadmap-schema.md).

Do not edit it by hand. Foreman keeps it consistent for you, and hand edits
break that. Tell Foreman what is wrong instead and it fixes the entry.

Every change goes through one small script. It checks ids and dependencies,
lets only one change run at a time, refuses a correction written against an
older copy of the entry, and checks the whole file before and after writing.
A hook stops the assistant's file-editing tools from changing the file
directly. A shell command is not stopped on either host, which is one more
reason to ask Foreman instead.

## What happens, and when

| Moment | What happens |
| --- | --- |
| You ask "what's next?" | Foreman sorts the roadmap. It knows what is finished, what is waiting on something else, and what would put two jobs in the same files. It recommends one and writes the prompt. You still choose |
| You describe new work | It gets added to the roadmap. Foreman asks first only when it looks like something already tracked |
| You save your changes | If a task looks finished, Foreman asks you to confirm. It also points out new work it noticed along the way, unless you switch that off |
| Work is about to be reported as finished | In Codex, Foreman first offers anything untracked it noticed, even after an investigation that saved no changes |
| You think the plan has gone stale | It reads the code, finds what no longer matches, and offers you each fix |
| You start a new session | Foreman mentions tasks still in progress or waiting for your acceptance, and offers to archive finished entries once many have piled up |

## Two ways to get a task

The cheap one is what you get by default.

- **Fast pick** — Foreman sorts the roadmap it already has and recommends one.
  It reads no code, so it is quick and nearly free. This is what you get unless
  you ask for the other one.
- **Reconcile and pick** — it reads your code first, finds where the plan has
  gone stale, and offers you each fix before recommending anything. This one
  costs real money, so Foreman never starts it on its own. You have to ask.

## The prompt is checked before you see it

A task on the roadmap names the files it expects to touch. Before handing you
a prompt, Foreman opens those files and checks them.

- A file that moved or was renamed is caught here, not by whoever does the
  work.
- A file the task is going to *create* is expected not to exist yet, and says
  so in the prompt rather than being treated as a mistake.
- A path that points outside your project is refused. Foreman never read it,
  and no task writes there.
- A name in the task description that matches nothing in any of those files is
  flagged, so an invented function name does not travel into the work.

The same check runs over the prompt itself: a missing step, or a verification
command that cannot actually run, is caught before delivery.

The prompt also says what kind of work it is. A task that asks a question is
an investigation: the prompt asks for findings with evidence, and a failing
check is something to report, not something to fix. A decision task asks for
a choice and the reason it wins; its failing checks never turn it into
implementation work.

## Finished is not the same as accepted

By default, a task whose work is committed and checked waits for you, marked
`awaiting_acceptance`. Your yes closes it; "not ready" sends it back with what
you said. Passing tests are evidence, not acceptance, and so is a background
worker's report that it succeeded. To close tasks as soon as their commit
lands instead, set `requireVerification` to `false` in [settings](settings.md).

## Big tasks get split

A task with several separate checks can be handed off in pieces, each with its
own check. Every finished piece is committed on a work branch, so nothing is lost
if you stop halfway. At the end you decide what happens to that branch.

Only the last piece closes the roadmap entry. Foreman's commits carry only the
task's own files, and a run that starts with uncommitted changes in your
working tree makes no automated commits at all.

## Where a task can go

When a prompt is ready, Foreman asks where you want it to run: here in this
session, with a background worker, or copied so you can paste it into another
session. It recommends one based on how full the session is, whether other
work is in flight, how many checks the task has, and whether your working tree
is clean. A poor fit is marked, never hidden — the choice stays yours.

Codex does not tell Foreman how full a session is, so in Codex the
recommendation leaves that part out. A Codex background worker is a subagent
with a bounded job; the session that sent it checks what comes back and makes
the roadmap changes itself.

## How each host runs the work

Each host gives Foreman different events to hook into, so the same steps are
wired differently. [Foreman in Codex](CODEX.md) covers the Codex side in more
detail.

| Step | Claude Code | Codex |
| --- | --- | --- |
| Where the hooks are registered | `hooks/hooks.json` | `hooks/codex-hooks.json`, named by the Codex manifest; review and trust them with `/hooks` |
| A new session starts | A reminder about open entries, on startup and clear | The same |
| Opening a task | A `TaskCreated` hook marks the entry in progress when the prompt becomes a task; other destinations do it from the prompt's own instructions | The prompt runs `hooks/codex-task.js start` and continues only when the entry is ready |
| Finishing a task | With `taskCloseGate: "block"`, a `TaskCompleted` hook holds the first attempt while the entry is still open | `hooks/codex-task.js check` reports what is still open; with `taskCloseGate: "block"`, a `Stop` or `SubagentStop` hook then asks for one more turn |
| After a shell command | A commit gets status and discovery reminders. Before the destination question, a note on how full the session is, when your window size is set | A commit gets status and discovery reminders |
| Direct edits of roadmap files | Blocked for `Edit` and `Write` | Blocked for `apply_patch`, `Edit` and `Write` |
| Lessons when a file is touched | `Read`, `Edit` and `Write` | `apply_patch`, `Read`, `Edit` and `Write` |
| Background work | A background `Agent` | A subagent that reports to its coordinator |
| Script paths inside prompts | `${CLAUDE_PLUGIN_ROOT}`, which Claude Code fills in | Quoted installed paths |

Shell commands are outside the edit and lesson hooks on both hosts. A prompt
carries its own host's script paths, so a prompt copied out of one host should
be crafted again in the other.

## Review between increments

> [!NOTE]
> Codex only. Claude Code does not offer this yet.

Sometimes you want to see each part of a task before the next part is built.
In Codex you can ask for exactly that: Foreman runs one roadmap task in
*increments* — results you can look at and try — and waits for your decision
after each one.

**How to ask.** After installing or updating Foreman, start a new Codex task so
its current skills are loaded. Then ask plainly, for example: "Foreman, run
this task here in increments and wait for my approval after each result." Only
an explicit request turns this on. It is not a stored preference: the skill
passes `reviewEachIncrement: true` to the prompt builder for that one run. An
ordinary split, or an absent or `false` flag, keeps its usual behavior, and the
builder never reads your wording to switch modes.

**What counts as one increment.** One `judgment.verification` row is one
meaningful result. Creating its files and checking them are steps inside it,
not extra increments. A row can carry an automatic check (`run` plus
`expected`), a human check (`review.action` plus `review.expected`), or both;
it needs at least one complete pair. Only commands go through the command
checks, so a result you judge by eye needs no invented command. `review` is the
input field; `Look:` is how the prompt shows it. In an explicitly reviewed run,
**every row needs `review`**, including results that automated checks could
verify. A row with both kinds of check counts once when Foreman decides how to
split the work and where checkpoints go.

A tracked feature remains one roadmap entry. Its increments are rows in one
run, and their evidence goes into that entry's notes. A sign-in feature, for
example, can deliver a usable form, then authentication with error handling,
then sign-out with a check of the whole flow. You can approve a result, ask for
changes to it, or pause before the next result that depends on it.

This small payload asks for a reviewed documentation result, with no roadmap
entry behind it:

```json
{
  "title": "Clarify the review example",
  "why": "Readers need to know when execution waits for them.",
  "what": "Clarify the review example in HOW-IT-WORKS.md.",
  "touches": ["HOW-IT-WORKS.md"],
  "host": "codex",
  "destination": "clipboard",
  "reviewEachIncrement": true,
  "judgment": {
    "role": "a documentation editor",
    "goal": "to make the review example clear and actionable",
    "context": "This is the Codex-only reviewed-increment workflow.",
    "steps": ["Read the existing example and clarify its wait behavior."],
    "constraints": ["Keep the existing task acceptance policy."],
    "verification": [{
      "goal": "Explain the wait before the next result",
      "files": ["HOW-IT-WORKS.md"],
      "review": {
        "action": "Read the revised review example",
        "expected": "You can tell when to accept, request changes or pause; no installation is included"
      }
    }]
  }
}
```

A human-only row like this one is valid without `run` or its `expected`. Add a
real `run` and `expected` pair to the same row when that result also needs
automated evidence. For an ordinary automatic-only row, leave out `review` and
do not set `reviewEachIncrement`. Use `destination: "task"` with `split: true`
for a split that runs here. The destination you chose is kept. Exporting a
prompt to the clipboard neither starts the work nor accepts anything, and even
a single reviewed row carries the pause.

**What happens at each result.** The session builds the current increment and
runs its required checks. Then it shows you the result, its limits, the
evidence and what to look at, offers **Accept / Request changes / Pause**, and
waits for a real answer before any dependent work. Passing tests, time passing
and a question tool confirming that a question was delivered are not answers.
Requesting changes keeps the increment open; after two failed fix attempts the
session reports and pauses. Without a question tool, it asks in conversation.
With no person or coordinator to relay the question, it keeps the result
pending and stops. A subagent returns its result to the session that sent it,
which handles your review and the shared bookkeeping; running in the
background never supplies an answer.

**What gets written down.** The coordinating session records brief decisions
and concrete work references in the entry's existing notes with
`roadmap.js annotate`; a run without an entry keeps them in its conversation or
handoff. If you explicitly allow continuing without a review, that check is
recorded as `unverified:` (omitted), never as `accepted:`. Recording an
acceptance and making a checkpoint commit are separate steps, and a run that
started with uncommitted changes can continue without commits. Accepting an
increment keeps the task open: once every increment is done, the combined
result is checked and the usual close rules apply. Only a decision that
explicitly covers both the last result and the whole task accepts them
together.

**Picking up after an interruption.** Recovery is assisted, not automatic. The
session reads the entry's complete notes and inspects the current work,
including the files or commits the notes refer to. It continues from an
acceptance that the current work still backs up; it does not skip a result
merely because a note starts with `accepted:` or a row number matches. Changed
work, missing references, unclear scope or an answer that arrived late all
mean asking again. Both an omission note and a later resolution note stay,
each matched to its specific check. `annotate` appends a line on every call, so
after an uncertain outcome the session rereads the notes before retrying. There
is no exact replay and no separate increment store. Older Foreman versions can
still read the roadmap while ignoring this protocol; reading the format is not
the same as following the protocol.

**Closing the task.** For each historical `unverified:` check, the session
compares later evidence for that same result. When the comparison supports it,
it appends `verification resolved:` and keeps the original note. It offers to
test first only for checks that are still unverified; accepting something
unrelated does not clear them. The detailed contracts are
[preparation](skills/roadmap/prepare-increments.md),
[review](skills/roadmap/increment-review.md),
[recovery](skills/roadmap/resume-increments.md), and
[integrated close](skills/roadmap/close-increments.md).

## Task numbers in your history

Every commit Foreman makes ends with a line like `Foreman: 019`. That is the
task number. It lets you trace any change back to the job it came from, with
plain `git log`. This one is always on.

Foreman reads those lines back, too. When a task names a function, the prompt
it hands over says which earlier tasks created and changed that function, by
number and title, straight from the file's own commit history. It is offered
as history, not as instructions, and the prompt says so.

You can also put a `[Foreman: 019]` comment next to code some task settled.
From then on, anyone handed work on that file is told which task settled it,
by name.

## Commands

You never need these — plain sentences work. They are here if you would rather
call a skill by name.

| You want to… | Claude Code | Codex skill |
| --- | --- | --- |
| Ask in your own words | `/foreman:foreman` | `foreman` |
| Set up a roadmap for a project (one-time) | `/foreman:init` | `init` |
| Get the next task, add one, fix one, or see where things stand | `/foreman:roadmap` | `roadmap` |
| Check the plan against your actual code | `/foreman:survey` | `survey` |
| Write a one-off prompt for something not on the roadmap | `/foreman:craft-prompt` | `craft-prompt` |

## Requirements

Node.js 22 or later and Git, on both hosts. Foreman's scripts need no npm
packages and no server.

- **Claude Code.** Built and tested against Claude Code 2.1.x. If a future
  Claude Code stops sending Foreman something it relies on, `/foreman:roadmap`
  will tell you rather than going quiet.
- **Codex.** A Codex host with plugin support, with Foreman's hooks trusted.
  The Codex versions Foreman was checked against are listed in
  [Foreman in Codex](CODEX.md).

Run the scripts from the project they should work on, or name that project
with `FOREMAN_PROJECT_DIR` — see
[which project Foreman works on](settings.md#which-project-foreman-works-on).

## Also worth reading

| | |
| --- | --- |
| [Settings](settings.md) | Every option, in one table |
| [The roadmap file](roadmap-schema.md) | Every field, and what it means |
| [The ledger](ledger.md) | The optional notes store, in full |
| [The prompt template](prompt-template.md) | The exact shape of every prompt Foreman writes |
| [Foreman in Codex](CODEX.md) | How Foreman maps onto Codex, and its limits there |
| [Codex handoff prompting](CODEX-PROMPTING.md) | The guidance Codex prompts follow |
