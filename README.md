<div align="center">
  <img src="assets/logo.svg" alt="foreman" width="240" />
  <h1>Foreman</h1>
  <p><strong>A living to-do list for your project, plus expertly written prompts to hand any task to a fresh Claude session.</strong></p>
</div>

---

## What is this?

Every project builds up a pile of "we should do X someday" — in your head, in chat logs, in sticky notes that scroll away. Foreman keeps that pile **inside the project itself**, in a plain-language roadmap that travels with your code. Ask "what's next?" and it picks the best task to do now, then writes a complete, professional prompt you can hand straight to a fresh Claude session — no prompt-engineering skills required.

## Why you'd want it

- **Your plan survives between sessions.** The roadmap lives in your repository, committed like code — not in one chat window that disappears.
- **Great prompts without the skill.** Every handoff prompt is assembled from a proven template, with guardrails built in — you just say what you want in plain language.
- **It keeps itself up to date.** After each commit, Foreman notices when you've finished a task and records it. Opt in, and it also spots new work the commit uncovered — and asks what to do with it.
- **It never acts without asking.** Nothing is added, changed, or marked done behind your back, and a project you haven't set up is never touched.

## Install

Inside Claude Code, run:

```
/plugin marketplace add V-Songbird/claude-plugins
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

## Under the hood

If you're curious, the roadmap is just a plain file in your repo — the field-by-field details live in [`roadmap-schema.md`](roadmap-schema.md) if you ever want them.

## License

MIT — see [LICENSE](./LICENSE).
