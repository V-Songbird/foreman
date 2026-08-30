# Foreman — how it works

The [README](README.md) says what Foreman is for. This page says how it does
it, for anyone who wants to know before they trust it with a plan.

## The roadmap is a file

Foreman keeps your plan in a file in your project called `ROADMAP.jsonl`. One
task per line. It is an ordinary text file, so you can read it with Foreman
switched off, put it in version control, or open it in any editor.

Every field in it is explained in [`roadmap-schema.md`](roadmap-schema.md).

Do not edit it by hand. Foreman keeps it consistent for you, and hand edits
break that. Tell Foreman what is wrong instead and it fixes the entry.

## What happens, and when

| Moment | What happens |
| --- | --- |
| You ask "what's next?" | Foreman sorts the roadmap. It knows what is finished, what is waiting on something else, and what would put two jobs in the same files. It recommends one and writes the prompt. You still choose |
| You describe new work | It gets added to the roadmap, once you approve it |
| You save your changes | If a task looks finished, Foreman asks you to confirm. It also points out new work it noticed along the way, unless you switch that off |
| You think the plan has gone stale | It reads the code, finds what no longer matches, and offers you each fix |

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

## Big tasks get split

A task with several separate checks can be handed off in pieces, each with its
own check. Every finished piece is saved on its own branch, so nothing is lost
if you stop halfway. At the end you decide what happens to that branch.

## Where a task can go

When a prompt is ready, Foreman asks where you want it to run. It recommends
one based on how full the session is, whether other work is in flight, how many
checks the task has, and whether your working tree is clean. A poor fit is
marked, never hidden — the choice stays yours.

## Task numbers in your history

Every commit Foreman makes ends with a line like `Foreman: 019`. That is the
task number. It lets you trace any change back to the job it came from, with
plain `git log`. This one is always on.

You can also put a `[Foreman: 019]` comment next to code some task settled.
From then on, anyone handed work on that file is told which task governs it,
by name.

## Commands

You never need these — plain sentences work. They are here if you would rather
type a command.

| You want to… | Command |
| --- | --- |
| Set up a roadmap for a project (one-time) | `/foreman:init` |
| Get the next task, add one, fix one, or see where things stand | `/foreman:roadmap` |
| Check the plan against your actual code | `/foreman:survey` |
| Write a one-off prompt for something not on the roadmap | `/foreman:craft-prompt` |

## Requirements

Node.js and git, both of which Claude Code already needs. Built and tested
against Claude Code 2.1.x. If a future Claude Code stops sending Foreman
something it relies on, `/foreman:roadmap` will tell you rather than going
quiet.

## Also worth reading

| | |
| --- | --- |
| [Settings](settings.md) | Every option, in one table |
| [The roadmap file](roadmap-schema.md) | Every field, and what it means |
| [The ledger](ledger.md) | The optional notes store, in full |
| [The prompt template](prompt-template.md) | The exact shape of every prompt Foreman writes |
