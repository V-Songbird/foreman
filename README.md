<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo.svg" alt="foreman" width="240" />
  </picture>
  <h1>Foreman</h1>
  <p><strong>A living to-do list for your project, plus expertly written prompts to hand any task to a fresh Claude session.</strong></p>
</div>

---

## What is this?

Every project builds up a pile of "we should do X someday" — in your head, in chat logs, in sticky notes that scroll away. Foreman keeps that pile **inside the project itself**, in a plain-language roadmap that travels with your code. Ask "what's next?" and it picks the best task to do now, then writes a complete, professional prompt you can hand straight to a fresh Claude session — no prompt-engineering skills required.

It's built for real engineering work — projects that outlive any one chat window, where the next session never remembers the last.

## Why you'd want it

- **Your plan survives between sessions.** The roadmap lives in your repository, committed like code — and every new session gets reminded what was left in progress, with the chance to finish it first.
- **Great prompts without the skill.** Every handoff prompt is assembled from a proven template, with guardrails built in — you just say what you want in plain language.
- **It keeps itself up to date.** After each commit, Foreman notices when you've finished a task and records it. Opt in, and it also spots new work the commit uncovered — and asks what to do with it.
- **It never acts without asking.** Nothing is added, changed, or marked done behind your back, and a project you haven't set up is never touched.

## Install

Inside Claude Code, run:

```
/plugin marketplace add V-Songbird/foundry
/plugin install foreman
```

Then, in each project you want a roadmap for, run `/foreman:init` once. That's the only setup — it asks a few questions about your project and creates the roadmap for you.

## What you can do

You talk to Foreman in plain language — you never edit the roadmap file by hand.

| You want to… | Command |
| --- | --- |
| Set up a roadmap for a project (one-time) | `/foreman:init` |
| Pick the next task, add one, or check status | `/foreman:roadmap` |
| Build a handoff prompt for a specific task | `/foreman:craft-prompt` |
| Double-check the top tasks against your actual code | `/foreman:survey` |

## Benchmarks

We measured what a good handoff is actually worth: the same real coding jobs, run as full agent sessions — never a single canned reply — started four ways, from a bare one-line ask up to a Foreman handoff, with the real bill read straight from the API.

<p align="center"><img src="assets/bench-rescue.svg" alt="The brief pointed at a file that had been renamed: the one-line ask shipped broken work every time, the Foreman handoff never did — it checked the brief against the code first" width="640"></p>

**When the brief goes stale, the one-line ask ships broken work.** Every living repo accumulates stale detail — a file gets renamed, a note outlives the code it described. We planted exactly that trap, and on the smaller model the one-line ask patched the wrong file and shipped a broken result every single time. The Foreman handoff has the session check the brief against the code before acting — it found the real file and finished the job, every single time.

<p align="center"><img src="assets/bench-cost.svg" alt="The same jobs asked two ways on the bigger model: the one-line ask cost $0.21 per session, the Foreman handoff $0.16 — about a quarter less" width="640"></p>

**Skipping the brief doesn't skip the cost.** Every fact you leave out of the ask, the session buys back by exploring your codebase at your expense. On the bigger model, the one-line ask cost about a third more than the Foreman handoff for the same jobs — the shortest prompt was the most expensive session.

<p align="center"><img src="assets/bench-picks.svg" alt="Cost per what-should-I-work-on-next as the backlog grows: a to-do file costs $0.12 at 10 tasks, $0.14 at 50, $0.21 at 150 — Foreman's roadmap answers free at any size, with the same answer every time" width="640"></p>

**"What's next?" is free, every time you ask.** Keep your backlog in a plain to-do file and Claude re-reads and re-reasons over the whole thing on every ask — the bill grows with the list, and the pick can change with the model's mood. Foreman reads the roadmap mechanically: instant, free at any size, and the same answer every time.

> [!NOTE]
> A carefully hand-written brief performs like a Foreman handoff — the difference is you don't have to write it, and the guardrails come along for free. And on a strong model with a fresh, accurate brief, the rescue above simply isn't needed: stale and thin briefs are where it pays.

*How we tested: same jobs, four ways of asking, several runs each in fresh throwaway workspaces — a full multi-turn agent session every time — with costs read from the API, not estimated. Reproduce it yourself — see [benchmarks/](benchmarks/).*

## Under the hood

If you're curious, the roadmap is just a plain file in your repo (field-by-field details in [`roadmap-schema.md`](roadmap-schema.md)), and every prompt Foreman assembles is script-checked before it ships — a malformed handoff never reaches a session. Pairs naturally with [razor](https://github.com/V-Songbird/razor) and [hush](https://github.com/V-Songbird/hush): razor cuts the code, hush cuts the noise, Foreman writes the prompts — and measured together, the three add no overhead to each other.

## Settings

Most people never touch these — `/foreman:init` asks the questions and writes `.foreman/config.json` for you. The knobs, if you ever want them by hand:

| Setting | What it does |
| --- | --- |
| `discoverySuggestions` | After each commit, offer new roadmap entries Claude spotted in the work. |
| `usePersona` | Whether handoff prompts open with a "You are a…" role sentence, or plain domain framing. |
| `omitSections` | Prompt sections to leave out entirely (`tone`, `example`, `background`, `output_format`). |
| `requireVerification` | Hold off marking a task done after a commit until you confirm it's verified. |
| `taskCloseGate` | When a tracked task finishes with its roadmap entry still open: `off` says nothing, `nudge` (default) reminds you to close it, `block` holds the completion until you do. |
| `targetModel` | How much detail crafted prompts spell out, scoped to the model that runs them: `haiku` elaborates fully, while `sonnet`, `opus`, and `inherit` (default — no fixed model) keep the standard level. |

Running with razor and hush? The recommended shape is:

```json
{
  "usePersona": false,
  "omitSections": ["tone"]
}
```

razor already gives the session its persona and hush already owns the voice, so Foreman's prompts stay out of both lanes. Add `"output_format"` to the list if hush should own the reply's shape too.

Prompts handed to a background agent keep Foreman's minimal default tone even when `tone` is omitted — output styles don't reach those sessions, so nothing else would own the voice there.

> [!NOTE]
> Foreman never detects which plugins you run — this file is you declaring the shape you want, and it works the same for any third-party style plugin.

## License

MIT — see [LICENSE](./LICENSE).
