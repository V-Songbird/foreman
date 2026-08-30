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
