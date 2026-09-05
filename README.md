<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo.svg" alt="foreman" width="240" />
  </picture>
  <h1>Foreman</h1>
  <p><strong>Every Claude Code session forgets everything when it ends. Foreman is what's waiting when the next one wakes up.</strong></p>

  <img src="assets/hero.svg" alt="A poster: one task id, 019, rides a single green trail through four checkpoints — roadmap, decision note, code anchor, commit. It reads: Nothing gets lost." width="700" />

  <p><em>This is how a task is remembered.</em></p>
</div>

<p align="center">
    <a href="https://github.com/V-Songbird/foreman/stargazers"><img src="https://img.shields.io/github/stars/V-Songbird/foreman?style=social" alt="GitHub stars"/></a>
    <a href="https://github.com/V-Songbird/foreman/blob/main/LICENSE"><img src="https://img.shields.io/github/license/V-Songbird/foreman" alt="License"/></a>
    <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-E5582B" alt="Claude Code"/></a>
</p>

<p align="center">
    <a href="#install"><strong>Install</strong></a> &nbsp;·&nbsp;
    <a href="#what-is-this">What is this?</a> &nbsp;·&nbsp;
    <a href="#why-youd-want-it">Why you'd want it</a> &nbsp;·&nbsp;
    <a href="#what-you-can-do">What you can do</a> &nbsp;·&nbsp;
    <a href="#going-deeper">Going deeper</a>
</p>

> **TL;DR** — Every Claude Code session forgets everything when it ends. Foreman writes your plan into your project, as a normal file you can read. Ask "what's next?" and you get the task it recommends, why that one, and a ready-to-run prompt. It checks that prompt against your real code first, so it can't point at a file that moved.

---

<p align="center"><img src="assets/demo.svg" alt="One real exchange with Foreman on a small command-line notes tool, three tasks on its roadmap. You: what&#x27;s next? Foreman answers after 32 seconds: Two tasks are ready to go — neither is blocked, and nothing else is in flight. Which task next? 1. Save notes to a file so they survive a restart (001) — (Recommended) Right now notes only live in memory, so closing the … You: 1. Copy the prompt to my clipboard. Foreman answers after 51 seconds: Task 001 — Save notes to a file so they survive a restart. Right now the notes tool keeps everything in memory, so quitting the terminal throws away every note you took. This makes the store write itself to a JSON file i… Then you paste the prompt Foreman wrote into a fresh session; it opens by naming the files it checked, with line numbers. Claude Opus 5, replayed on the recorded wall clock." width="700"></p>

## What is this?

Close the laptop, and every plan that only lived in your head closes with it.

Open Claude Code tomorrow and it starts from zero. No memory of what you were
building. No memory of what you ruled out and why. No idea that the file it is
about to edit got renamed yesterday.

So you explain it all again. Every morning.

Foreman keeps the plan next to the code, in a file it calls the roadmap. It is
a to-do list in plain words, saved in your project like any other file. Ask
"what's next?" and it hands back the task it recommends, why that one came
first, and a prompt you can run straight away.

Before handing that prompt over, it opens the files the task names and checks
they are still there, and still say what the plan thinks they say.

That is the whole idea. The plan stops living in your head.

## Why you'd want it

- **Your plan survives you forgetting it.** The next session picks up exactly where you left off, not from a shrug.
- **You stop re-explaining your project.** The task, the reason, and the files all arrive together, already written.
- **The instructions write themselves.** Every task goes out in the same shape, with the same safety rails, and the file names checked before you see it.
- **It keeps up with your work.** When a task looks finished, Foreman says so and asks. You confirm, and it gets ticked off.
- **Nothing moves without you.** No task gets added, changed, or checked off behind your back.

Here is a real one. A small command-line notes tool with three tasks on its
roadmap: save notes to a file, add a `--due` flag, search by tag. The search
waits on the save.

**You:** what's next?

**Foreman:**

> Two tasks are ready to go — neither is blocked, and nothing else is in flight.
>
> **Which task next?**
>
> 1. **Save notes to a file so they survive a restart (001)** — *(Recommended)* Right now notes only live in memory, so closing the terminal wipes everything; this makes the tool usable past a single sitting. It leads because one other task is waiting behind it.
> 2. **Add a `--due` flag to `add` (002)** — People are typing dates into the note text by hand, so nothing can sort or warn by date. It's just the oldest other ready task; nothing is waiting on it.

**You:** 1. Copy the prompt to my clipboard.

**Foreman:**

> **Task 001 — Save notes to a file so they survive a restart.** Right now the notes tool keeps everything in memory, so quitting the terminal throws away every note you took. This makes the store write itself to a JSON file in your home directory whenever it changes and read it back at startup, without touching any of the CLI's commands or output.
>
> The prompt is on your clipboard — paste it into a fresh session.

The prompt it wrote opens like this. The files and line numbers in it were
checked against the project a moment earlier:

```
<task_context>
You are a Node.js developer working on a small command-line notes tool.
Your goal is Notes added in one run of the CLI are still there in the next run,
because the store now persists itself to a JSON file in the user's home
directory and reads it back on start.
</task_context>

<relevant_files>
src/store.js — nextId (5), notes (6), add (8), list (14), markDone (18), reset (25)
test/store.test.js — assert (4), store (5)
Pattern: src/cli.js — build the new code the same way
</relevant_files>

<task_rules>
- Add persistence to the note store: on start, load existing notes from a JSON
  file under the user home directory (creating nothing and failing softly if the
  file is absent or unreadable); on every mutation, write the current state back
  to that file.
- Keep the existing in-memory store functions and their signatures unchanged so
  no CLI command has to change.
- Add tests covering the round trip: notes saved by one store instance are
  visible to a freshly constructed one, and a missing or corrupt file starts from
  an empty store rather than throwing.
...
```

Both replies are as they came back, on Claude Opus 5. The second one also
named where it saved a copy of the prompt; that line is left out here.

## Install

Inside Claude Code, run:

```
/plugin marketplace add V-Songbird/foundry
/plugin install foreman@foundry
```

Then run `/foreman:init` once in each project you want a roadmap for. It asks
you a few questions and writes the roadmap for you. That is the whole setup.

Running [razor](https://github.com/V-Songbird/razor) and [hush](https://github.com/V-Songbird/hush) too? Good instinct — razor keeps the code lean, hush keeps it quiet, Foreman keeps the plan.

## What you can do

Just talk to it. That is the whole thing. One way in, plain words, nothing to
memorise:

| You say… | You get |
| --- | --- |
| "add this to the roadmap" | new work tracked, once you approve it |
| "where are we" | where every task stands, and what's waiting on you |
| "that task's description is out of date" | the task fixed |
| "what's next" | the task it recommends, why that one, and a prompt you can run |
| "is the plan still right? then give me something" | your code checked against the plan first, then a task |

There are [commands](HOW-IT-WORKS.md#commands) too, if you would rather type
them. You never need them.

## What the last task learned

Someone finds out your tests hang unless you fake the clock. They fix their bug
and finish, and that discovery is gone. Three weeks later the next person
spends the same afternoon finding the same thing.

Turn this on and a finished task can leave one sentence instead. The next task
that touches those files is handed it before it starts. So is anyone who opens
one of them. A sentence that turns out to be wrong can be retired.

It is off until you ask for it, because it puts a new file in your project.
The whole thing fits on one page: [the ledger](ledger.md).

> [!NOTE]
> The ledger is **Beta**. It is the newest thing here and may still have rough
> edges, so it stays off until you say yes. Turning it back off later does not
> delete anything you have already saved.

## Going deeper

Everything technical lives here, so this page can stay short:

| | |
| --- | --- |
| [How Foreman works](HOW-IT-WORKS.md) | What runs and when, how a task is picked, what gets checked |
| [Settings](settings.md) | Every option, and what each one does |
| [The roadmap file](roadmap-schema.md) | Every field, and what it means |
| [The ledger](ledger.md) | The optional notes store, in full |
| [The prompt template](prompt-template.md) | The exact shape of every prompt Foreman writes |

## Good to know

Foreman is for one developer working alone. It keeps the roadmap, and hands you
the next task from it. That is the whole job.

`/foreman:init` leaves everything at its default, so most people never open the
settings at all.

Leave the roadmap file to Foreman. It keeps it tidy for you, and hand edits
break that. Tell Foreman what is wrong instead and it fixes the entry.

You need Node.js and git, both of which Claude Code already needs.

> [!NOTE]
> **What Foreman will never grow into.** No teams, no assigning work to
> people, no time estimates, no priority levels, no dashboards. No wiki, and
> no knowledge base with its own folders, tags or search. Notes here stay
> attached to the work and the files they came from, nowhere
> else. No code review. No building your own pipelines out of
> named roles. No timer that runs things while you are away. No server, no
> account, and nothing stored anywhere but your own project. Nothing on that
> list arrives before a major version, and only then with the reason written
> down next to it.

## License

MIT — see [LICENSE](./LICENSE).
