<!-- foundry:edition Claude -->
<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.png" />
    <img src="assets/banner-light.png" alt="Foreman" width="900" />
  </picture>
  <h1>Foreman</h1>
  <p><strong>Your plan stays next to your code. The next task arrives with its context checked.</strong></p>
</div>

<p align="center"><strong>Available on</strong></p>
<p align="center">
  <a href="https://github.com/V-Songbird/foreman/tree/Codex"><img src="assets/edition-codex.svg" alt="Codex" width="80" height="80" /></a>&emsp;&emsp;<a href="https://github.com/V-Songbird/foreman/tree/Claude"><img src="assets/edition-claude.svg" alt="Claude" width="80" height="80" /></a><br />
  <a href="https://github.com/V-Songbird/foreman/tree/Codex">Codex</a>&emsp;&emsp;&emsp;&emsp;<a href="https://github.com/V-Songbird/foreman/tree/Claude">Claude</a>
</p>

<!-- foundry:platform identity -->
<p align="center"><strong>Edition: Claude Code.</strong> Use this edition’s installation and compatibility notes below.</p>
<!-- /foundry:platform identity -->

<p align="center"><a href="#install"><strong>Get started</strong></a> · <a href="#what-is-this">What is this?</a> · <a href="#how-it-works">How it works</a> · <a href="#what-you-can-do">What you can do</a> · <a href="#the-numbers">Evidence</a></p>

## What is this?

You finish a session with a fix, a side request and an issue still waiting. Next time, you need to know which one comes first and why. Foreman keeps that context in a roadmap beside your code.

Ask "what’s next?" and it recommends a task with its reason and a prompt checked against the project’s files. Completed work brings evidence back into the plan; acceptance stays a separate decision.

<p align="center"><img src="assets/mascot.svg" alt="Ember gathers scattered papers into a task list and points to the next task." width="700"></p>

## Why you'd want it

- Pick up where the last session stopped.
- Keep the task, its reason and its constraints together.
- Check stale plans against the code before acting.
- Keep acceptance of finished work separate from a successful test run.

## How it works

The roadmap lives in your project. Foreman reads it, checks the relevant context and helps you choose what to do next. Optional lessons let later tasks learn from earlier work without creating a separate knowledge base.

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

## Install

<!-- foundry:platform install -->
Inside Claude Code:

```text
/plugin marketplace add V-Songbird/foundry
/plugin install foreman@foundry
```

Start a new session to load the plugin. Run `/foreman:init` once in the project. Existing roadmap data can be reused.
<!-- /foundry:platform install -->

## Good to know

Foreman is for a solo developer. It does not become a team tracker, code-review service, unattended scheduler or workflow server. Your project keeps its own data. The optional ledger is off until requested; disabling it deletes no existing notes.

<!-- foundry:platform compatibility -->
The Claude edition provides its own execution and delegation flow. Do not infer availability of a feature from a different edition’s guide. See [how Foreman works](HOW-IT-WORKS.md).
<!-- /foundry:platform compatibility -->

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

<!-- foundry:hero -->
<p align="center"><img src="assets/hero.svg" alt="Foreman original product visualization" width="700"></p>

The task trail above illustrates the workflow. The recorded demo below comes from Claude Code; it is not a Codex measurement. [Evidence and methodology](https://github.com/V-Songbird/foundry/tree/main/docs/foreman).

<details>
<summary>Watch the recorded Claude Code demo</summary>

<p align="center"><img src="assets/demo.svg" alt="Recorded Claude Code demonstration of Foreman" width="700"></p>

</details>
<!-- /foundry:hero -->

## Going deeper

<!-- foundry:platform links -->
[How it works](HOW-IT-WORKS.md) · [Settings](settings.md) · [Roadmap schema](roadmap-schema.md) · [Ledger](ledger.md)
<!-- /foundry:platform links -->

[Foundry](https://github.com/V-Songbird/foundry) holds the research, methodology and detailed evidence for this plugin.

## License

MIT — see [LICENSE](LICENSE).
