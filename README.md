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

<p align="center"><a href="#get-started"><strong>Get started</strong></a> · <a href="#what-is-this">What is this?</a> · <a href="#how-it-works">How it works</a> · <a href="#what-you-can-do">What you can do</a> · <a href="#evidence-and-benchmarks">Evidence</a></p>





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

## Get started

Choose the assistant you use. Its edition page has the installation steps,
commands and compatibility notes for your setup.

| Your assistant | Status | Next step |
| --- | --- | --- |
| Claude Code | Available | [Install and get started](https://github.com/V-Songbird/foreman/tree/Claude) |
| Codex | Available | [Install and get started](https://github.com/V-Songbird/foreman/tree/Codex) |

## Good to know

Foreman is for a solo developer. It does not become a team tracker, code-review service, unattended scheduler or workflow server. Your project keeps its own data. The optional ledger is off until requested; disabling it deletes no existing notes.

## Evidence and benchmarks

<!-- foundry:hero -->
<p align="center"><img src="assets/hero.svg" alt="Foreman original product visualization" width="700"></p>

The task trail above illustrates the workflow. The recorded demo below comes from Claude Code; it is not a Codex measurement. [Evidence and methodology](https://github.com/V-Songbird/foundry/tree/main/docs/foreman).

<details>
<summary>Watch the recorded Claude Code demo</summary>

<p align="center"><img src="assets/demo.svg" alt="Recorded Claude Code demonstration of Foreman" width="700"></p>

</details>
<!-- /foundry:hero -->

Measurements belong to the model and setup that produced them. Each edition
keeps its own results, limitations and any measurements still missing:

- [Claude Code results and limitations](https://github.com/V-Songbird/foreman/tree/Claude#the-numbers)
- [Codex evidence and measurement status](https://github.com/V-Songbird/foreman/tree/Codex#the-numbers)

## Going deeper

[Research and validation](https://github.com/V-Songbird/foundry/tree/main/docs/foreman) · [Benchmark instruments and retained evidence](https://github.com/V-Songbird/foundry/tree/main/benchmarks/foreman) · [Foundry](https://github.com/V-Songbird/foundry)

## License

MIT — see [LICENSE](LICENSE).
