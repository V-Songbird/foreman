<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo.svg" alt="foreman" width="240" />
  </picture>
  <h1>Foreman</h1>
  <p><strong>Every Claude Code session forgets everything when it ends. Foreman is what's waiting when the next one wakes up.</strong></p>

  <img src="assets/bench-signoff.svg" alt="Every haiku run in the benchmark suite drawn as a stamp, grouped by task. The one-line-ask row is checked off green except for four red rejected stamps, all in the same group — every run shipped broken code the moment the target file had been renamed. The Foreman-handoff row is signed off green across all twelve runs, on every task including that one." width="700" />

  <p><em>This is what passes inspection.</em></p>
</div>

<p align="center">
    <a href="https://github.com/V-Songbird/foreman/stargazers"><img src="https://img.shields.io/github/stars/V-Songbird/foreman?style=social" alt="GitHub stars"/></a>
    <a href="https://github.com/V-Songbird/foreman/blob/main/LICENSE"><img src="https://img.shields.io/github/license/V-Songbird/foreman" alt="License"/></a>
    <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-E5582B" alt="Claude Code"/></a>
</p>

> **TL;DR** — Every Claude Code session starts with amnesia. Foreman keeps your plan in your repo, committed like code. Ask "what's next?" and you get Foreman's recommended task — with the reason it's the recommendation — and a ready-to-run prompt whose paths and symbols are preflighted, and which checks its own claims against the codebase before it edits anything. About a quarter cheaper per session than a bare one-line ask.

---

## What is this?

Close the laptop, and every plan that only lived in your head closes with it. Open Claude Code tomorrow and it starts from zero — no memory of what you were building, what you already ruled out, or that the file it's about to edit got renamed yesterday.

Foreman keeps the plan where the code lives: a plain-language roadmap, committed like any other file. Ask "what's next?" and Foreman hands back its recommended task — and says why it's first — plus a ready-to-run prompt that starts by checking its own claims against your code. It earns its keep on real engineering work — the kind that outlives a single chat window.

## Why you'd want it

- **Your plan survives you forgetting it.** The roadmap lives in your repo, committed like code. The next session picks up exactly where you left off, not from a shrug.
- **The handoff writes itself.** Every task Foreman hands off comes from the same template, guardrails built in, paths and symbols checked first. Say what you want in plain language, and Foreman does the rest.
- **It keeps up with your commits.** After each commit, Foreman spots the task that looks finished and asks you to confirm before checking it off. Opt in, and it also flags new work the commit uncovered.
- **It can clear a short run of work without turning into a process tool.** Ask for a small sprint, approve one plan, and review the finished entries together at the end. Still experimental.
- **Nothing moves without you.** No task gets added, changed, or checked off behind your back, and a project you haven't set up stays untouched.

## How it works

| Moment | What happens |
| --- | --- |
| You ask "what's next?" | Foreman orders the roadmap — dependencies, collisions, what's done — and recommends the top one, with the reason it came first, plus a ready-to-run prompt. The order is Foreman's default; the pick is yours |
| You describe new work | It becomes a roadmap entry, once you approve it |
| You ask for the next few tasks (experimental) | Foreman makes one small serial plan and brings the successful work back for one final acceptance |
| You commit | A task that looks finished is surfaced for you to confirm, then checked off; opt in and new work the commit uncovered gets flagged too |
| You suspect the plan has drifted | The top tasks get double-checked against the actual code, and the roadmap corrected |

Hand a task off as tracked work, and every finished piece lands as its own commit on a `foreman/<slug>` branch. Done work stays done. At the end, you pick what happens to it: squash, merge, PR, or keep.

## Install

Inside Claude Code, run:

```
/plugin marketplace add V-Songbird/foundry
/plugin install foreman@foundry
```

Then, in each project you want a roadmap for, run `/foreman:init` once. It asks a few questions and builds the roadmap for you. That's the whole setup.

Running [razor](https://github.com/V-Songbird/razor) and [hush](https://github.com/V-Songbird/hush) too? Good instinct — razor keeps the code lean, hush keeps it quiet, Foreman keeps the plan.

## What you can do

Talk to Foreman. That's the whole interface — one entrance, plain language, no command names to memorize. Say what you want and it goes to the right place:

| You say… | You get |
| --- | --- |
| "add this to the roadmap" | new work tracked, once you approve it |
| "where are we" | where every task stands, and what's waiting on you |
| "that entry's description is stale" | the entry corrected, current value against the new one |
| "what's next" | the recommended task, why it's first, and a ready-to-run prompt |
| "is the plan still right? then give me something" | the top tasks checked against your code, repairs you approve one by one, then the pick |
| "work through the next few" | one small serial batch, one approval, one final acceptance (experimental) |

Two ways to get a task, and the cheap one is the default:

- **Fast pick** — ask "what's next" and Foreman orders the roadmap it already has, recommends one, and hands you a ready-to-run prompt. It reads no code, so it costs next to nothing.
- **Reconcile and pick** — the near-term tasks get checked against your actual code first, you approve each repair one at a time, and the pick then runs on a roadmap that was just corrected. Ask for it and it happens; Foreman never starts it on its own, because it costs real tokens.

Editing the roadmap file by hand defeats the point, so don't.

### Advanced

The specialized commands are still there when you'd rather skip the entrance and go straight in:

| You want to… | Command |
| --- | --- |
| Set up a roadmap for a project (one-time) | `/foreman:init` |
| See the recommended next task, add one, correct one, or check status | `/foreman:roadmap` |
| Work through a few ready tasks with one approval (experimental) | `/foreman:sprint` |
| Double-check the top tasks against your actual code | `/foreman:survey` |
| Build a standalone prompt for something that isn't a roadmap entry | `/foreman:craft-prompt` |

That last one is a separate tool, not part of the roadmap job: it interviews
you section by section and hands back one self-contained prompt. Roadmap work
never needs it — the handoff for a picked task is built for you.

## Why-notes that find you later

Git remembers every diff. Nobody remembers *why*. Turn this on, and any task that makes a real call writes a short note: the choice, the options that lost, and what it commits you to — tagged right into the code it governs. Open that code six months later, and Foreman hands you the note before you undo a decision you didn't know was there. It's off until you ask for it, because it writes files into your repo and comments into your source. The whole feature fits on one page: [`decision-log.md`](decision-log.md).

Seeing `Foreman: 019` at the bottom of your commits? That's a different
thing, and it's always on. A normal single-task run closes alongside its
code, so the commit names the task instead of the roadmap chasing a commit
that doesn't exist yet. A sprint keeps one code commit per entry, then records
the batch's final acceptance in one coordinator-owned bookkeeping commit.
Same page covers it.

## Benchmarks

We measured what a good handoff is actually worth: the same real coding jobs, run as full agent sessions, started four ways — from a bare one-line ask up to a Foreman handoff — with the real bill read straight from the API.

<p align="center"><img src="assets/bench-rescue.svg" alt="The brief pointed at a file that had been renamed: the one-line ask shipped broken work every time, the Foreman handoff never did — it checked the brief against the code first" width="700"></p>

**When the brief goes stale, the one-line ask ships broken work.** Every living repo collects stale detail — a file gets renamed, a note outlives the code it described. We planted exactly that trap. On the smaller model, the one-line ask patched the wrong file every single time. The Foreman handoff checks the brief against the code first, found the real file, and finished the job — every single time.

<p align="center"><img src="assets/bench-cost.svg" alt="The same jobs asked two ways on the bigger model: the one-line ask cost $0.21 per session, the Foreman handoff $0.16 — about a quarter less" width="700"></p>

**Skipping the brief doesn't skip the cost.** Every fact you leave out of the ask, the session buys back by exploring your codebase — on your dime. On the bigger model, the one-line ask cost about a third more than the Foreman handoff for the same jobs. The shortest prompt was the most expensive session.

<p align="center"><img src="assets/bench-picks.svg" alt="Cost per what-should-I-work-on-next as the backlog grows: a to-do file costs $0.12 at 10 tasks, $0.14 at 50, $0.21 at 150 — Foreman's roadmap answers free at any size, with the same answer every time" width="700"></p>

**"What's next?" is free, every time you ask.** Keep your backlog in a plain to-do file, and Claude re-reads the whole thing on every ask — the bill grows with the list, and the pick can change with the model's mood. Foreman reads the roadmap mechanically: instant, free at any size, same answer every time.

> [!NOTE]
> A carefully hand-written brief performs like a Foreman handoff — the difference is you don't have to write it, and the guardrails come along for free. On a strong model with a fresh, accurate brief, the rescue above simply isn't needed: stale and thin briefs are where it pays.

*How we tested: same jobs, four ways of asking, several runs each in fresh throwaway workspaces — a full multi-turn agent session every time, never a single generated reply — costs read from the API, not estimated. Numbers move a few percent between runs. Reproduce it yourself — see [benchmarks/](benchmarks/).*

## Under the hood

The roadmap is a plain file in your repo (field-by-field details in [`roadmap-schema.md`](roadmap-schema.md)), and every prompt Foreman assembles is structurally validated before it ships. Routine bookkeeping happens mechanically, leaving the model for work that needs judgment. Foreman pairs naturally with [razor](https://github.com/V-Songbird/razor) and [hush](https://github.com/V-Songbird/hush): razor cuts the code, hush cuts the noise, Foreman keeps the plan. Measured together, the three add no overhead to each other.

## Scope

Foreman is a solo-developer project companion — not project-management
software, not an agent-workflow builder. It keeps the roadmap, hands off
work, and can coordinate a small approved sprint. It has no roles, no
pipelines, and no dashboards, and it never will.

## Settings

`/foreman:init` writes sensible project defaults, so most people never touch
configuration. If you want to tune the optional behavior, see the
[`settings.md`](settings.md) reference.

## License

MIT — see [LICENSE](./LICENSE).
