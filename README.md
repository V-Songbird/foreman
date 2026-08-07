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

> **TL;DR** — Every Claude Code session starts with amnesia. Foreman keeps your plan in your repo, committed like code. Ask "what's next?" and you get the recommended task, the reason it's first, and a ready-to-run prompt — one whose paths and claims were checked against your code.

---

## What is this?

Close the laptop, and every plan that only lived in your head closes with it. Open Claude Code tomorrow and it starts from zero. No memory of what you were building, what you ruled out, or that the file it's about to edit got renamed yesterday.

Foreman keeps the plan where the code lives: a plain-language roadmap, committed like any other file. Ask "what's next?" and it hands back the recommended task, the reason it's first, and a ready-to-run prompt that checks its own claims against your code.

## Why you'd want it

- **Your plan survives you forgetting it.** The next session picks up exactly where you left off, not from a shrug.
- **The handoff writes itself.** Every task goes out on the same template, guardrails built in, paths checked first.
- **It keeps up with your commits.** A task that looks finished is surfaced for you to confirm, then checked off.
- **Nothing moves without you.** No task gets added, changed, or checked off behind your back.

## How it works

| Moment | What happens |
| --- | --- |
| You ask "what's next?" | Foreman orders the roadmap — dependencies, collisions, what's done — and recommends the top one, with a ready-to-run prompt. The pick is yours |
| You describe new work | It becomes a roadmap entry, once you approve it |
| You commit | A task that looks finished is surfaced for you to confirm; opt in and new work the commit uncovered gets flagged too |
| You suspect the plan has drifted | The top tasks get double-checked against the actual code, and the roadmap corrected |

Hand a task off as tracked work, and every finished piece lands as its own commit on a `foreman/<slug>` branch. At the end, you pick what happens to it: squash, merge, PR, or keep.

## Install

Inside Claude Code, run:

```
/plugin marketplace add V-Songbird/foundry
/plugin install foreman@foundry
```

Then run `/foreman:init` once in each project you want a roadmap for. It asks a few questions and builds the roadmap. That's the whole setup.

Running [razor](https://github.com/V-Songbird/razor) and [hush](https://github.com/V-Songbird/hush) too? Good instinct — razor keeps the code lean, hush keeps it quiet, Foreman keeps the plan.

## What you can do

Talk to Foreman. That's the whole interface — one entrance, plain language, no command names to memorize:

| You say… | You get |
| --- | --- |
| "add this to the roadmap" | new work tracked, once you approve it |
| "where are we" | where every task stands, and what's waiting on you |
| "that entry's description is stale" | the entry corrected |
| "what's next" | the recommended task, why it's first, and a ready-to-run prompt |
| "is the plan still right? then give me something" | the top tasks checked against your code, then the pick |

Two ways to get a task, and the cheap one is the default:

- **Fast pick** — Foreman orders the roadmap it already has and recommends one. It reads no code.
- **Reconcile and pick** — the near-term tasks get checked against your actual code first, repair by repair. Foreman never starts this on its own, because it costs real tokens.

Editing the roadmap file by hand defeats the point, so don't.

### Advanced

The specialized commands are still there when you'd rather go straight in:

| You want to… | Command |
| --- | --- |
| Set up a roadmap for a project (one-time) | `/foreman:init` |
| See the recommended next task, add one, correct one, or check status | `/foreman:roadmap` |
| Double-check the top tasks against your actual code | `/foreman:survey` |
| Build a standalone prompt for something that isn't a roadmap entry | `/foreman:craft-prompt` |

## Why-notes that find you later

Git remembers every diff. Nobody remembers *why*. Turn this on, and any task that makes a real call writes a short note — the choice, the options that lost, what it commits you to — tagged into the code it governs. Open that code six months later and the note finds you. It's off until you ask for it, because it writes files into your repo. The whole feature fits on one page: [`decision-log.md`](decision-log.md).

Seeing `Foreman: 019` at the bottom of your commits? That's always on. The commit names the task, so a finished task closes in the same commit as its code and nothing dangles.

## Under the hood

The roadmap is a plain file in your repo (field-by-field details in [`roadmap-schema.md`](roadmap-schema.md)), and every prompt Foreman assembles is structurally validated before it ships. Pairs naturally with [razor](https://github.com/V-Songbird/razor) and [hush](https://github.com/V-Songbird/hush) — they're built to stay out of each other's way.

## Scope

Foreman is a solo-developer project companion. It keeps the roadmap and hands off the next task from it. That is the whole job.

> [!NOTE]
> **What Foreman will never grow into.** No teams, assignments, estimates,
> priorities, or dashboards. No wiki or knowledge base. No pull-request
> review or reviewer personas. No workflow definitions or agent-role
> pipelines. No scheduler and no unattended runs. No server, account, or
> hosted state. Nothing on that list ships before a major version, and only
> then with the reason written down next to it.

## Settings

`/foreman:init` leaves every setting at its default, so most people never touch configuration. To tune the optional behavior, see [`settings.md`](settings.md).

## Requirements

Node.js and git, both of which Claude Code already needs. Built and tested against Claude Code 2.1.x — `/foreman:roadmap` will tell you if a hook event it leans on stops arriving.

## License

MIT — see [LICENSE](./LICENSE).
