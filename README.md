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
  <a href="#codex"><img src="assets/edition-codex.svg" alt="Codex" width="80" height="80" /></a>&emsp;&emsp;<a href="#claude-code"><img src="assets/edition-claude.svg" alt="Claude" width="80" height="80" /></a><br />
  <a href="#codex">Codex</a>&emsp;&emsp;&emsp;&emsp;<a href="#claude-code">Claude</a>
</p>

<p align="center"><a href="#get-started"><strong>Get started</strong></a> · <a href="#what-is-this">What is this?</a> · <a href="#how-it-works">How it works</a> · <a href="#what-you-can-do">What you can do</a> · <a href="#the-numbers">Evidence</a></p>

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

### How to ask

Plain sentences like the ones above work in both assistants. If you would rather call Foreman by name, each assistant has its own way:

| You want to… | Claude Code | Codex |
| --- | --- | --- |
| Ask in your own words | `/foreman:foreman` | the `foreman` skill |
| Set up a roadmap for a project (once) | `/foreman:init` | the `init` skill |
| Pick, add, correct or review work | `/foreman:roadmap` | the `roadmap` skill |
| Check the plan against your code | `/foreman:survey` | the `survey` skill |
| Write a one-off prompt with no roadmap entry | `/foreman:craft-prompt` | the `craft-prompt` skill |

## Get started

Foreman is one plugin for both assistants. Install it in the one you use; only the commands differ.

### Claude Code

Requirements: Node.js and Git (tested with Node.js 22). Foreman is built and tested against Claude Code 2.1.x.

Inside Claude Code:

```text
/plugin marketplace add V-Songbird/foundry
/plugin install foreman@foundry
```

Start a new session to load the plugin. Run `/foreman:init` once in the project.

### Codex

Requirements: Node.js and Git (tested with Node.js 22), and a Codex host with plugin support.

```text
codex plugin marketplace add V-Songbird/foundry
codex plugin add foreman@foundry
```

Review and trust its hooks with `/hooks`, then start a new Codex session. Ask Foreman to initialize the project, or select its installed `init` skill.

### Switching between them

Existing roadmap data can be reused. Both assistants read and write the same `ROADMAP.jsonl` and `.foreman/` files, so one project can move between them. Claude Code needs Foreman 2.7.0 or later to read entries that Codex wrote.

## Good to know

Foreman is for a solo developer. It does not become a team tracker, code-review service, unattended scheduler or workflow server. Your project keeps its own data. The optional ledger is off until requested; disabling it deletes no existing notes.

### Differences between hosts

Foreman does the same job in both assistants. The host — the assistant Foreman runs inside — decides which events and tools Foreman can use, so a few things work differently:

| | Claude Code | Codex |
| --- | --- | --- |
| Starting a tracked task | A hook opens the roadmap entry when Foreman's prompt becomes a task | The prompt opens the entry with an explicit start command |
| Reminder when a task ends with its entry still open (`taskCloseGate`) | The first attempt to finish stops until the entry is closed | After an explicit check finds the entry still open, Foreman asks Codex for one more turn |
| Direct edits of the roadmap file are blocked for | `Edit` and `Write` | `apply_patch`, `Edit` and `Write` |
| Lessons appear when a file is touched with | `Read`, `Edit` and `Write` | `apply_patch`, `Read`, `Edit` and `Write` |
| Offering untracked work Foreman noticed | After a commit | After a commit, in every handoff and before reporting completion |
| Advice based on how full the session is | When your auto-compact window is set ([settings](settings.md)) | Not available: Codex does not report it |
| Stopping for your approval after each result of a task | Not available in Claude Code yet | On explicit request |
| Model recorded when a task closes | Family name, such as `sonnet` | Exact model id |

On both hosts, a shell command can still write the roadmap file, and reading a file through the shell shows no lessons. A prompt copied out of one assistant carries that assistant's script paths, so craft it again in the other. [Foreman in Codex](CODEX.md) covers the Codex side in detail.

## The numbers

Each result belongs to the named model and recorded run. Measurements belong to the model and setup that produced them, so each host keeps its own table. Missing measurements remain marked as unmeasured.

### Claude Code results

<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Sonnet (proof-sn2)","Claude Opus (proof-op2)"],"source":"docs/foreman/research/foreman-proof-axes-2026-08-29.md","date":"2026-08-29"} -->
| Model | Setup | Correct tasks | Mean session cost |
| --- | --- | --- | --- |
| Claude Sonnet (proof-sn2) | Written task paragraph | 100% | $0.0757 |
| Claude Sonnet (proof-sn2) | Foreman | 100% | $0.0820 |
| Claude Opus (proof-op2) | Written task paragraph | 100% | $0.1627 |
| Claude Opus (proof-op2) | Foreman | 100% | $0.1746 |

Foreman tied the well-written paragraph on correctness and cost more: 8.3% on Sonnet and 7.3% on Opus. These are historical comparisons, not a claim about the current release or another model.

### Codex results

<!-- foundry:evidence {"platform":"Codex","status":"pending","reason":"Functional Codex validation exists; equivalent paired performance measurements are not available."} -->
| Model | Setup | Correct tasks | Mean session cost |
| --- | --- | --- | --- |
| Not measured | Without plugin | Not measured | Not measured |
| Not measured | foreman | Not measured | Not measured |

Codex functional tests establish specific behaviors, not a speed, cost or correctness advantage over a baseline. Comparative performance remains unmeasured.

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

[How it works](HOW-IT-WORKS.md) · [Settings](settings.md) · [Roadmap schema](roadmap-schema.md) · [Ledger](ledger.md) · [Foreman in Codex](CODEX.md) · [Codex handoff prompting](CODEX-PROMPTING.md)

[Research and validation](https://github.com/V-Songbird/foundry/tree/main/docs/foreman) · [Benchmark instruments and retained evidence](https://github.com/V-Songbird/foundry/tree/main/benchmarks/foreman) · [Foundry](https://github.com/V-Songbird/foundry)

## License

MIT — see [LICENSE](LICENSE).
