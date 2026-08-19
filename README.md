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

> **TL;DR** — Every Claude Code session forgets everything when it ends. Foreman writes your plan into your project, as a normal file you can read. Ask "what's next?" and you get the task it recommends, why that one, and a ready-to-run prompt. It checks that prompt against your real code first, so it can't point at a file that moved.

---

## What is this?

Close the laptop, and every plan that only lived in your head closes with it. Open Claude Code tomorrow and it starts from zero. No memory of what you were building, what you ruled out, or that the file it's about to edit got renamed yesterday.

Foreman keeps the plan next to the code, in a file it calls the roadmap. It is a to-do list in plain words, saved in your project like any other file. Ask "what's next?" and it hands back the task it recommends, why that one came first, and a prompt you can run straight away. Before handing it over, it opens the files the task names and checks they are still there and still say what the plan thinks.

## Why you'd want it

- **Your plan survives you forgetting it.** The next session picks up exactly where you left off, not from a shrug.
- **The instructions write themselves.** Every task goes out in the same shape, with the same safety rails, and the file names checked before you see it.
- **It keeps up with your work.** When a task looks finished, Foreman says so and asks. You confirm, and it gets ticked off.
- **Nothing moves without you.** No task gets added, changed, or checked off behind your back.

## How it works

| Moment | What happens |
| --- | --- |
| You ask "what's next?" | Foreman sorts the roadmap. It knows what is finished, what is waiting on something else, and what would put two jobs in the same files. It recommends one and writes the prompt. You still choose |
| You describe new work | It gets added to the roadmap, once you approve it |
| You save your changes | If a task looks finished, Foreman asks you to confirm. Switch one setting on and it also points out new work it noticed along the way |
| You think the plan has gone stale | It reads the code, finds what no longer matches, and offers you each fix |

A big task can be handed off in pieces, each with its own check. Every finished piece is saved on its own branch, so nothing is lost if you stop halfway. At the end you decide what happens to that branch.

## Install

Inside Claude Code, run:

```
/plugin marketplace add V-Songbird/foundry
/plugin install foreman@foundry
```

Then run `/foreman:init` once in each project you want a roadmap for. It asks you a few questions and writes the roadmap for you. That is the whole setup.

Running [razor](https://github.com/V-Songbird/razor) and [hush](https://github.com/V-Songbird/hush) too? Good instinct — razor keeps the code lean, hush keeps it quiet, Foreman keeps the plan.

## What you can do

Just talk to it. That is the whole thing. One way in, plain words, nothing to memorise:

| You say… | You get |
| --- | --- |
| "add this to the roadmap" | new work tracked, once you approve it |
| "where are we" | where every task stands, and what's waiting on you |
| "that task's description is out of date" | the task fixed |
| "what's next" | the task it recommends, why that one, and a prompt you can run |
| "is the plan still right? then give me something" | your code checked against the plan first, then a task |

Two ways to get a task. The cheap one is what you get by default:

- **Fast pick** — Foreman sorts the roadmap it already has and recommends one. It reads no code, so it is quick and nearly free. This is what you get unless you ask for the other one.
- **Reconcile and pick** — it reads your code first, finds where the plan has gone stale, and offers you each fix before recommending anything. This one costs real money, so Foreman never starts it on its own. You have to ask.

Don't edit the roadmap file by hand. Foreman keeps it tidy for you, and hand edits break that.

### Advanced

If you would rather type a command than a sentence, these go straight to the point:

| You want to… | Command |
| --- | --- |
| Set up a roadmap for a project (one-time) | `/foreman:init` |
| Get the next task, add one, fix one, or see where things stand | `/foreman:roadmap` |
| Check the plan against your actual code | `/foreman:survey` |
| Write a one-off prompt for something not on the roadmap | `/foreman:craft-prompt` |

## Why-notes that find you later

Your project history remembers every change. Nobody remembers *why*. Turn this on and a task that makes a real decision writes a short note: what you chose, what you turned down, and what that locks you into. The note is tied to the code it is about. Open that code six months later and the note finds you. It is off until you ask for it, because it writes files into your project. The whole thing fits on one page: [`decision-log.md`](decision-log.md).

Seeing `Foreman: 019` at the bottom of your saved changes? That one is always on. It is the task number, so you can trace any change back to the job it came from.

There is a lighter version of the same idea. Turn on `areaNotes` and a task that finishes can leave one sentence about the code it touched. Anyone who opens those files later gets that sentence back, with a note saying whether the code has moved since. A sentence that turns out to be wrong can be retired. Every option is in [`settings.md`](settings.md).

> [!NOTE]
> `areaNotes` is **Beta**. It is the newest thing here and may still have rough edges, so it stays off until you say yes. Turning it back off later does not delete anything you have already saved.

## Under the hood

The roadmap is an ordinary file in your project, so you can read it with Foreman switched off. Every field is explained in [`roadmap-schema.md`](roadmap-schema.md). Every prompt is checked before it leaves, so a missing step or a command that cannot run is caught here rather than by whoever does the work. Pairs naturally with [razor](https://github.com/V-Songbird/razor) and [hush](https://github.com/V-Songbird/hush) — they're built to stay out of each other's way.

## Scope

Foreman is for one developer working alone. It keeps the roadmap, and hands you the next task from it. That is the whole job.

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

## Settings

`/foreman:init` leaves everything at its default, so most people never open the settings at all. If you do want to change something, [`settings.md`](settings.md) lists every option in one table.

## Requirements

Node.js and git, both of which Claude Code already needs. Built and tested against Claude Code 2.1.x. If a future Claude Code stops sending Foreman something it relies on, `/foreman:roadmap` will tell you rather than going quiet.

## License

MIT — see [LICENSE](./LICENSE).
