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

<p align="center"><img src="assets/mascot.svg" alt="A cartoon. Ember, a round orange blob with a little flame on its head, sits at a desk while loose papers rain down around it; it flails, sweats, and its flame flickers wildly. A green Foreman badge drops in. The papers gather into one neat list card, and three checks tick in one by one while Ember settles, its flame a small steady glow. At the end Ember points at the list and one bubble appears: What&#x27;s next? This one." width="700"></p>

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

> **Which task next?**
>
> 1. **Save notes to a file so they survive a restart (001)** *(Recommended)* Right now notes only live in memory, so quitting the terminal wipes everything — the tool can't be used across sittings. Ranked first because it unblocks 1 other open task.
> 2. **Add a `--due` flag to `add` (002)** People are typing due dates into the note body by hand, so nothing can sort or warn by date. Ranked second as the oldest ready task with nothing waiting behind it.
>
> Or describe something else you'd rather work on.
>
> Once you pick, I'll ask where to run it (here as one task, here split by check, a background agent, or copied to your clipboard).

**You:** 1. Copy the prompt to my clipboard.

**Foreman:**

> Copied to your clipboard.
>
> **What this task changes:** right now every note the CLI holds lives only in memory, so closing the terminal throws them all away. The handoff has the next session write the store to a JSON file in your home directory on every change and reload it at startup — leaving the existing store functions and the CLI's commands and output exactly as they are.

The prompt it wrote opens like this. The files and line numbers in it were
checked against the project a moment earlier, and the second line under the
goal is the task's own reason from the roadmap, word for word:

```
<task_context>
You are a Node.js CLI developer working on a small notes tool.
Your goal is Notes added in one run of the CLI are still listed by a later,
separate run — the store persists to a JSON file on disk and reloads it on
startup, with no change to the CLI's commands or output.
Why this task exists: Everything lives in memory. Close the terminal and every
note is gone, which makes the tool useless for anything past one sitting.
</task_context>

<relevant_files>
src/store.js — nextId (5), notes (6), add (8), list (14), markDone (18), reset (25)
test/store.test.js — assert (4), store (5)
Pattern: src/cli.js — imports src/store, as this task's files do; read it as the
existing analogue before writing new code
</relevant_files>

<task_rules>
- Load the persisted JSON file from a path under the user home directory when
  the store initializes, treating a missing or unreadable file as an empty store
  rather than an error.
- Write the full store back to that JSON file after every change (add, done, and
  any other mutation).
- Leave the existing in-memory store functions' names, signatures, and return
  values unchanged so the CLI code needs no edits.
- Cover load-on-start and save-on-change in test/store.test.js, including the
  missing-file case.

Constraints:
- Do not change the CLI's commands, flags, argument handling, or printed output.
- Keep the existing in-memory store functions' signatures and return values
  intact - persistence wraps them, it does not replace them.
- The store file lives under the user's home directory, not in the repository or
  the current working directory.
- Tests must not write to the real user home directory - point the store at a
  temporary path.
Expected file surface: src/store.js, test/store.test.js. Anything beyond this
list gets flagged to the user before it is written, not after.
...
```

Both replies are as they came back, on Claude Opus 5, recorded without an
interactive question tool. Two things are left out here: the first reply's
opening line, which said it would show the menu as text for that reason, and
the second reply's tail, which named where it saved a copy of the prompt and
quoted one builder warning it had already folded into the constraints.

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
