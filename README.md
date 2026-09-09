<!-- foundry:edition Claude -->
<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo.svg" alt="Foreman" width="240" />
  </picture>
  <h1>Foreman</h1>
  <p><strong>Your plan stays next to your code. The next task arrives with its context checked.</strong></p>
</div>

<!-- foundry:platform identity -->
**Edition: Claude Code.** Use this edition’s installation and compatibility notes below.
<!-- /foundry:platform identity -->

[**Install**](#install) · [What is this?](#what-is-this) · [What you can do](#what-you-can-do) · [The numbers](#the-numbers) · [Going deeper](#going-deeper)

> **TL;DR** — Your plan stays next to your code. The next task arrives with its context checked.

<p align="center"><img src="assets/mascot.svg" alt="Ember gathers scattered papers into a task list and points to the next task." width="700"></p>

## What is this?

Foreman keeps a correctable roadmap in your project. Ask what is next and get a recommended task, its reason, and a prompt checked against the real files. Completed work carries evidence back into the plan.

## Why you'd want it

- Pick up where the last session stopped.
- Keep the task, its reason and its constraints together.
- Check stale plans against the code before acting.
- Keep acceptance of finished work separate from a successful test run.

## How it works

The roadmap lives in your project. Foreman reads it, checks the relevant context and helps you choose what to do next. Optional lessons let later tasks learn from earlier work without creating a separate knowledge base.

## Install

<!-- foundry:platform install -->
Inside Claude Code:

```text
/plugin marketplace add V-Songbird/foundry
/plugin install foreman@foundry
```

Start a new session to load the plugin. Run `/foreman:init` once in the project. Existing roadmap data can be reused.
<!-- /foundry:platform install -->

## What you can do

| You say | You get |
| --- | --- |
| Add this to the roadmap | Requested work recorded with its reason and boundaries |
| Where are we? | Status, blockers and work waiting for acceptance |
| What's next? | A recommended task and a choice of where to run it |
| Check whether the plan still matches the code | A grounded review before choosing work |
| Craft a prompt for this | A checked handoff without requiring a roadmap entry |

<!-- foundry:platform commands -->
Use natural language or the `/foreman` commands, including `/foreman:init`.
<!-- /foundry:platform commands -->

## The numbers

Each result belongs to the named model and recorded run. Missing measurements remain marked as unmeasured.

<!-- foundry:platform benchmarks -->
<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Sonnet (proof-sn2)","Claude Opus (proof-op2)"],"source":"docs/foreman/research/foreman-proof-axes-2026-08-29.md","date":"2026-08-29"} -->
| Model | Setup | Correct tasks | Mean session cost |
| --- | --- | --- | --- |
| Claude Sonnet (proof-sn2) | Written task paragraph | 100% | $0.0757 |
| Claude Sonnet (proof-sn2) | Foreman | 100% | $0.0820 |
| Claude Opus (proof-op2) | Written task paragraph | 100% | $0.1627 |
| Claude Opus (proof-op2) | Foreman | 100% | $0.1746 |

Foreman tied the well-written paragraph on correctness and cost more: 8.3% on Sonnet and 7.3% on Opus. These are historical comparisons, not a claim about the current release or another model.
<!-- /foundry:platform benchmarks -->

*Results can vary between runs.*

## Going deeper

<!-- foundry:platform links -->
[How it works](HOW-IT-WORKS.md) · [Settings](settings.md) · [Roadmap schema](roadmap-schema.md) · [Ledger](ledger.md)
<!-- /foundry:platform links -->

[Foundry](https://github.com/V-Songbird/foundry) holds the research, methodology and detailed evidence for this plugin.

## Good to know

Foreman is for a solo developer. It does not become a team tracker, code-review service, unattended scheduler or workflow server. Your project keeps its own data. The optional ledger is off until requested; disabling it deletes no existing notes.

<!-- foundry:platform compatibility -->
The Claude edition provides its own execution and delegation flow. Do not infer availability of a feature from a different edition’s guide. See [how Foreman works](HOW-IT-WORKS.md).
<!-- /foundry:platform compatibility -->

## License

MIT — see [LICENSE](LICENSE).
