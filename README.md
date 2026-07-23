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

> **TL;DR** — Every Claude Code session starts with amnesia. Foreman keeps the plan in your repo, committed like code: ask "what's next?" and you get the best task with a ready-to-run prompt, checked against the actual codebase — about a quarter cheaper per session than a bare one-line ask.

---

## What is this?

Close the laptop and every plan that only lived in your head closes with it. Open Claude Code tomorrow and it starts from zero — no memory of what you were building, what you already ruled out, or that the file it's about to edit got renamed yesterday.

Foreman keeps the plan where the code lives: a plain-language roadmap, committed like any other file. Ask "what's next?" and it hands back the best task and a ready-to-run prompt, built from what's actually true about your project right now. It earns its keep on real engineering work — the kind that outlives a single chat window.

## Why you'd want it

- **Your plan survives you forgetting it.** The roadmap lives in your repo, committed like code — the next session picks up exactly where you left off, not from a shrug.
- **You don't have to be good at prompting.** Every handoff prompt comes from the same template, guardrails built in — say what you want in plain language, Foreman does the rest.
- **It updates itself.** After each commit, Foreman checks what got finished and marks it. Opt in, and it also flags new work the commit uncovered.
- **Nothing moves without you.** No task gets added, changed, or checked off behind your back, and a project you haven't set up stays untouched.

## How it works

| Moment | What happens |
| --- | --- |
| You ask "what's next?" | Foreman weighs the roadmap — dependencies, collisions, what's done — and hands back the best task with a ready-to-run prompt |
| You describe new work | It becomes a roadmap entry, once you approve it |
| You commit | Finished tasks get checked off; opt in and new work the commit uncovered gets flagged too |
| You suspect the plan has drifted | The top tasks get double-checked against the actual code, and the roadmap corrected |

And when a handoff runs as tracked tasks — here, or pasted into another session from a copied prompt with several checks — every finished task lands as a commit on a dedicated `foreman/<slug>` branch — done work stays done, and at the end you choose: squash, merge, PR, or keep.

## Install

Inside Claude Code, run:

```
/plugin marketplace add V-Songbird/foundry
/plugin install foreman@foundry
```

Then, in each project you want a roadmap for, run `/foreman:init` once — it asks a few questions and builds the roadmap for you. That's the whole setup.

Running [razor](https://github.com/V-Songbird/razor) and [hush](https://github.com/V-Songbird/hush) too? Good instinct — razor keeps the code lean, hush keeps it quiet, Foreman writes the prompts.

## What you can do

You talk to Foreman in plain language. Touching the roadmap file by hand defeats the point, so don't.

| You want to… | Command |
| --- | --- |
| Set up a roadmap for a project (one-time) | `/foreman:init` |
| Pick the next task, add one, or check status | `/foreman:roadmap` |
| Build a handoff prompt for a specific task | `/foreman:craft-prompt` |
| Double-check the top tasks against your actual code | `/foreman:survey` |

## Benchmarks

We measured what a good handoff is actually worth: the same real coding jobs, run as full agent sessions, started four ways — from a bare one-line ask up to a Foreman handoff — with the real bill read straight from the API.

<p align="center"><img src="assets/bench-rescue.svg" alt="The brief pointed at a file that had been renamed: the one-line ask shipped broken work every time, the Foreman handoff never did — it checked the brief against the code first" width="700"></p>

**When the brief goes stale, the one-line ask ships broken work.** Every living repo accumulates stale detail — a file gets renamed, a note outlives the code it described. We planted exactly that trap. On the smaller model the one-line ask patched the wrong file every single time; the Foreman handoff checks the brief against the code first, found the real file, and finished the job — every single time.

<p align="center"><img src="assets/bench-cost.svg" alt="The same jobs asked two ways on the bigger model: the one-line ask cost $0.21 per session, the Foreman handoff $0.16 — about a quarter less" width="700"></p>

**Skipping the brief doesn't skip the cost.** Every fact you leave out of the ask, the session buys back by exploring your codebase at your expense. On the bigger model the one-line ask cost about a third more than the Foreman handoff for the same jobs — the shortest prompt was the most expensive session.

<p align="center"><img src="assets/bench-picks.svg" alt="Cost per what-should-I-work-on-next as the backlog grows: a to-do file costs $0.12 at 10 tasks, $0.14 at 50, $0.21 at 150 — Foreman's roadmap answers free at any size, with the same answer every time" width="700"></p>

**"What's next?" is free, every time you ask.** Keep your backlog in a plain to-do file and Claude re-reads the whole thing on every ask — the bill grows with the list, and the pick can change with the model's mood. Foreman reads the roadmap mechanically: instant, free at any size, same answer every time.

> [!NOTE]
> A carefully hand-written brief performs like a Foreman handoff — the difference is you don't have to write it, and the guardrails come along for free. On a strong model with a fresh, accurate brief, the rescue above simply isn't needed: stale and thin briefs are where it pays.

*How we tested: same jobs, four ways of asking, several runs each in fresh throwaway workspaces — a full multi-turn agent session every time, never a single generated reply — costs read from the API, not estimated. Numbers move a few percent between runs. Reproduce it yourself — see [benchmarks/](benchmarks/).*

## Under the hood

The roadmap is a plain file in your repo (field-by-field details in [`roadmap-schema.md`](roadmap-schema.md)), and every prompt Foreman assembles is script-checked before it ships — a malformed handoff never reaches a session. Pairs naturally with [razor](https://github.com/V-Songbird/razor) and [hush](https://github.com/V-Songbird/hush): razor cuts the code, hush cuts the noise, Foreman writes the prompts — and measured together, the three add no overhead to each other.

### Decision docs

Git remembers every diff. Nobody remembers why. Turn on `decisionLog` and any task that decides something writes a short ADR — one file per roadmap entry, at `<dir>/<id>.md` — and marks the code it governs with an anchor comment, `[Foreman: 019]` (or `[Foreman: 019, 034]` once more than one decision lands on the same spot). Come back in six months and you get the choice, the alternatives that lost, and the consequences — not a git-blame dig.

Closing a task is a forced choice, not an afterthought: every finished entry names its doc, or says `"none"` when nothing was worth writing down. Skip that, point it at a doc that was never written, or forget the anchor in the commit, and the completion check catches it — `gate` decides how loud: `off` stays silent, `nudge` (the default) reminds you, `block` holds the completion until the record's fixed.

The anchors keep paying off after the fact, too: read or edit any file carrying one and Foreman surfaces the doc it points to — before you violate a decision you didn't know was there, not after.

Decision docs are dated records, never rewritten backward. Change your mind later and the old doc stays as it was; the new one names it in its own `supersedes` frontmatter instead. The history stays honest either way.

## Settings

Most people never touch these — `/foreman:init` asks the questions and writes `.foreman/config.json` for you. The knobs, if you ever want them by hand:

| Setting | What it does |
| --- | --- |
| `discoverySuggestions` | After each commit, offer new roadmap entries Claude spotted in the work. On by default; set `false` to silence it. |
| `usePersona` | Whether handoff prompts open with a "You are a…" role sentence (default `true`), or plain domain framing. |
| `omitSections` | Prompt sections to leave out entirely (`tone`, `example`, `background`, `output_format`). Default none. |
| `customSections` | Extra sections to add to crafted prompts, each `{tag, content}` rendered as an inline `<tag>` block. Tags reserved by the template are rejected. Default none. |
| `requireVerification` | Hold off marking a task done after a commit until you confirm it's verified. Default `false`. |
| `taskCloseGate` | When a tracked task finishes with its roadmap entry still open: `off` says nothing, `nudge` (default) reminds you to close it, `block` holds the completion until you do. |
| `decisionLog` | Per-task decision docs: `{enabled, dir, gate}`. `enabled` (default `true`) turns them on — set `false` to opt out — `dir` (default `docs/foreman`) is where they're written, `gate` (default `nudge`) sets how a missing doc or anchor is enforced at completion — `off`, `nudge`, or `block`, same ladder as `taskCloseGate`. Environment overrides can flip it on or repoint the folder for a single run without touching the file. |
| `checkpoints` | How task-split runs commit their work. Four optional keys: `baseBranch` names the base branch (default: auto-detect), `branch: false` checkpoints on the current branch instead of creating a `foreman/<slug>` one, `push: true` pushes each checkpoint commit (default: keep them local), and `onFinish` set to `squash`, `merge`, `pr`, or `keep` performs that end-of-run action directly instead of asking (default: `ask`). |
| `targetModel` | How much detail crafted prompts spell out, scoped to the model that runs them: `haiku` elaborates fully, `sonnet`, `opus`, and `fable` skip scaffolding those models don't need, and `inherit` (default) keeps the standard level. At `inherit`, Foreman recommends a model per task at craft and dispatch time for you to confirm or override; set a concrete value to pin one for every prompt. |
| `fableEnabled` | Declare that your plan can run Fable 5 (Max or API). On tasks with two or more verification checks, the executing-model question then offers `Fable — orchestrates workers per slice`: Fable never edits files itself, it dispatches one implementer subagent per check and reviews each result before accepting it. Default `false`. |

Running with razor and hush? The recommended shape is:

```json
{
  "usePersona": false,
  "omitSections": ["tone"]
}
```

razor already gives the session its persona and hush already owns the voice, so Foreman's prompts stay out of both lanes. Add `"output_format"` to the list if hush should own the reply's shape too. Prompts handed to a background agent keep Foreman's minimal default tone even when `tone` is omitted — output styles don't reach those sessions, so nothing else would own the voice there.

> [!NOTE]
> Foreman never detects which plugins you run — this file is you declaring the shape you want, and it works the same for any third-party style plugin.

## License

MIT — see [LICENSE](./LICENSE).
