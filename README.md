<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo.svg" alt="Foreman" width="240" />
  </picture>
  <h1>Foreman</h1>
  <p><strong>Your plan stays next to your code. The next task arrives with its context checked.</strong></p>
</div>

**Choose your edition: [Claude Code](https://github.com/V-Songbird/foreman/tree/Claude) · [Codex](https://github.com/V-Songbird/foreman/tree/Codex)**

[**Get started**](#get-started) · [What is this?](#what-is-this) · [How it works](#how-it-works) · [What you can do](#what-you-can-do) · [Evidence](#evidence-and-benchmarks)

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

## Get started

Choose the assistant you use. Its edition page has the installation steps,
commands and compatibility notes for your setup.

| Your assistant | Status | Next step |
| --- | --- | --- |
| Claude Code | Available | [Install and get started](https://github.com/V-Songbird/foreman/tree/Claude) |
| Codex | Available | [Install and get started](https://github.com/V-Songbird/foreman/tree/Codex) |

## What you can do

| You say | You get |
| --- | --- |
| Add this to the roadmap | Requested work recorded with its reason and boundaries |
| Where are we? | Status, blockers and work waiting for acceptance |
| What's next? | A recommended task and a choice of where to run it |
| Check whether the plan still matches the code | A grounded review before choosing work |
| Craft a prompt for this | A checked handoff without requiring a roadmap entry |

## Good to know

Foreman is for a solo developer. It does not become a team tracker, code-review service, unattended scheduler or workflow server. Your project keeps its own data. The optional ledger is off until requested; disabling it deletes no existing notes.

## Evidence and benchmarks

Measurements belong to the model and setup that produced them. Each edition
keeps its own results, limitations and any measurements still missing:

- [Claude Code results and limitations](https://github.com/V-Songbird/foreman/tree/Claude#the-numbers)
- [Codex evidence and measurement status](https://github.com/V-Songbird/foreman/tree/Codex#the-numbers)

## Going deeper

[Research and validation](https://github.com/V-Songbird/foundry/tree/main/docs/foreman) · [Benchmark instruments and retained evidence](https://github.com/V-Songbird/foundry/tree/main/benchmarks/foreman) · [Foundry](https://github.com/V-Songbird/foundry)

## License

MIT — see [LICENSE](LICENSE).
