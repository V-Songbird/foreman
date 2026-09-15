# Foreman in Codex

Foreman is one plugin for Claude Code and Codex. This page covers what is
specific to Codex: how Codex loads the plugin, how Foreman's behavior maps onto
Codex's events and tools, and where that mapping stops. The behavior both hosts
share is described in [how Foreman works](HOW-IT-WORKS.md).

## How Codex loads Foreman

Codex reads `.codex-plugin/plugin.json`. Its `skills` field points at the same
`skills/` tree Claude Code uses. Its `hooks` field names
`hooks/codex-hooks.json`, and a manifest `hooks` field replaces the default
`hooks/hooks.json` — the file that holds Claude Code's registrations — so each
host loads only its own hooks. This loading behavior was checked against the
Codex CLI 0.154.0 source on 2026-09-15. Codex's plugin-creator validator does
not accept the `hooks` field yet, although Codex itself reads it.

Codex runs a plugin's hooks only after you review and trust them with `/hooks`.
Foreman 3.1.0 moved its Codex registrations into `hooks/codex-hooks.json`, so if
you used Foreman in Codex before, review and trust the hooks again after
updating.

Each hook command loads its script through `process.env.PLUGIN_ROOT` inside
Node, so it needs no Bash, PowerShell or cmd variable interpolation. The hooks
need `node`. On Windows, the `commandWindows` form is a PowerShell launcher,
built from `hooks/windows-launcher.ps1`, that uses `node` from PATH or, when it
is not there, from a configured fnm default. The hook logic is the same on
every platform.

## Runtime baseline

The Codex port was first written against `codex-cli 0.145.0`. It uses only the
synchronous command hooks available there — `SessionStart`, `PreToolUse`,
`PostToolUse`, `Stop` and `SubagentStop` — and does not depend on asynchronous
hook commands, MCP hook actions or newer event types that current online
documentation also describes.

The reviewed-increment behavior tests on 2026-09-08 used the Codex CLI bundled
with the Codex app, version 0.153.4. The global CLI 0.145.0 refused the
configured `gpt-6-astra` model as needing a newer CLI, so the tests used the
app executable without changing model or effort. This is the observed
environment, not a model recommendation.

References checked for this implementation:

- [Official plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [Official Codex hook contracts](https://developers.openai.com/codex/hooks)
- [Codex 0.145.0 hook types](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/hooks/src/lib.rs)
- [Codex 0.145.0 hook discovery](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/hooks/src/engine/discovery.rs)

## Feature mapping

Handoff wording is checked against official prompting guidance and the shipped
Codex instruction template. See [Codex handoff prompting](CODEX-PROMPTING.md)
for the source mapping, the Foreman policies kept, and the validation limits.

| Foreman behavior | Claude Code | Codex | Boundary in Codex |
| --- | --- | --- | --- |
| Five skills and the plain-language entrance | Skills called as `/foreman:<skill>` | Skills with Codex metadata (`agents/openai.yaml`) and linked runtime guidance | Load installed skills in a new session; tool availability varies by host |
| Interactive choices | `AskUserQuestion` | The available Codex question tool, with a plain-text fallback | A pending question is not an answer; explicit scope and acceptance are preserved |
| Background agents and split task rows | Background `Agent`; `TaskCreate` tasks | Native Codex subagents with bounded ownership and coordinator verification | Shared-tree bookkeeping is serialized; a separate sidebar task needs an explicit request |
| Opening a task | `TaskCreated` hook | `hooks/codex-task.js start` with readiness and status guards | Exporting a prompt never starts the task |
| Optional close gate | `TaskCompleted` hook | Explicit `check` plus a scoped `Stop`/`SubagentStop` reminder | A normal turn ending or a clarification does not count as task completion |
| Fresh-session reminders | `SessionStart` on startup and clear | The same | Hooks must be trusted and enabled |
| Direct roadmap write guard | `PreToolUse` on `Edit` and `Write` | `PreToolUse` on `apply_patch`, `Edit` and `Write` | Covers add, update, delete and move destinations; shell writes are outside this guard on both hosts |
| Successful-commit bookkeeping | `PostToolUse` on `Bash` and `PowerShell` | `PostToolUse` on canonical `Bash` (including Codex shell execution) and compatibility `PowerShell` | Native payloads may omit the exit status; confirm the command succeeded before using the hint. Reminders never write the roadmap |
| File, decision and lesson recall | Prompt-time recall plus `PostToolUse` on `Read`, `Edit` and `Write` | Prompt-time recall plus `PostToolUse` on `apply_patch`, `Read`, `Edit` and `Write` | Shell commands such as `rg`, `cat` or `Get-Content` are not parsed into reliable file-read events, on either host |
| Session-size advice for the destination | From the configured auto-compact window | Unknown when Codex supplies no reliable measurement | Foreman does not read Claude Code settings or treat Claude Code usage as Codex usage |
| Roadmap, ledger, archive, health and trials | Shared Node.js core | The same | Format 2 and optional legacy settings are kept |
| Model and effort history | Family label such as `sonnet` | Exact model identifier and actual effort | Runtime defaults are inherited; a valid value says nothing about availability |
| Script paths in handoffs | `${CLAUDE_PLUGIN_ROOT}`, filled in by Claude Code | Verified installed paths, quoted | A prompt crafted on one host is crafted again for the other |
| Review between increments | Not available yet | On explicit request | See [validation and limits](#validation-and-limits) |

Codex 0.145.0 does not guarantee a shell exit code in `PostToolUse`. Structured
adapter exit codes are honored when present; a missing code does not prove
that the observed HEAD belongs to a successful new commit. The hook asks for a
check against the actual tool result before evidence is recorded. See the
upstream [exit-status issue](https://github.com/openai/codex/issues/34289).

`hooks/task-created.js` and `hooks/task-completed.js` are Claude Code's task
hooks. Codex emits no `TaskCreated` or `TaskCompleted` event, so
`hooks/codex-hooks.json` does not register them. It does not register
`hooks/context-fill.js` either, because Codex offers no trustworthy
context-fill signal.

## Explicit lifecycle

Codex has no event for a finished task, so discovery is part of the work
itself. Generated handoffs and the `start`/`check` results carry the policy in
`skills/foreman/discovery.md`. The executing session reviews out-of-scope
findings it observed before reporting completion, including investigations and
uncommitted work; subagents return candidates to their coordinator.
`discoverySuggestions: false` disables the workflow. Duplicate checking comes
before any proposal, and the user chooses Add, Execute here, Execute with a
background subagent, or Reject before new work is recorded or performed.

The commit hook in Codex carries the same policy, including evidence-based
opportunities and acceptance for separately implemented work, and it stays
advisory: a commit made inside a helper script need not be recognized for the
completion review to run. No experimental environment switch changes the
discovery threshold. Local tests verify that the policy is delivered, not that a
model will identify every useful finding. Claude Code keeps its own
commit-time discovery prompt, which asks with `AskUserQuestion` and skips
suggestions in a background agent that has no user to ask.

From the project directory, using the actual installed plugin path:

```sh
node /absolute/path/to/foreman/hooks/codex-task.js start --id 001
node /absolute/path/to/foreman/hooks/codex-task.js check --id 001
```

Quote paths containing spaces. `--root` explicitly selects the project. The
helper uses host session and thread identifiers when available; `--session` and
`--agent` can identify an explicit hook scope. Without a usable session
identity, the CLI checkpoint still works, but a later `Stop` cannot be scoped
automatically.

`start` must report a ready `in_progress` entry before execution. `check`
returns nonzero while a scoped entry remains planned or in progress, and only
that explicit attempt arms the optional `taskCloseGate: "block"` reminder. The
hook consumes the attempt once, honors `stop_hook_active`, and leaves
acceptance decisions to the user. A completed implementation awaiting
acceptance passes the close check.

## Existing projects

- Keep `ROADMAP.jsonl`, `.foreman/config.json`, `.foreman/archive.jsonl` and
  `.foreman/notes.jsonl`. Do not reinitialize them to switch hosts.
- Format 2 is unchanged. Older entries still read in memory through the
  existing migrations; writes use the usual backup-and-migrate path.
- `source` has three current values: `user` for explicit requests,
  `claude-suggested` for Claude Code's suggestions and `codex-suggested` for
  Codex's. `model` holds a family label when Claude Code closes an entry and an
  exact model id when Codex does; both are valid. A Claude Code install older
  than Foreman 2.7.0 cannot read the values Codex writes.
- Existing `decisionLog`/`areaNotes` aliases, verification defaults, checkpoint
  finish preferences and trial privacy rules remain.
- Scripts and hooks choose the project as described in
  [settings](settings.md#which-project-foreman-works-on). In Codex, a hook
  follows the directory its event reports. A Codex commit hook still records
  work in a parent roadmap that `CLAUDE_PROJECT_DIR` names when the commit
  happened inside that parent.
- Handoffs contain verified installed script paths. If the plugin is
  reinstalled elsewhere, resolve its scripts from the newly loaded skill before
  running an old exported prompt. Never invent a plugin-root environment
  variable.

## Branches and releases

Foreman lives in the Foundry submodule backed by
`https://github.com/V-Songbird/foreman.git`. From 3.1.0, `main` holds the one
package for both hosts. Both plugin manifests carry the same version, and
Foundry's Claude Code and Codex catalogs pin the same `main` commit without a
version of their own. The `Codex` branch keeps the last separate Codex release,
3.0.4-codex.1, and the `Claude` branch keeps the last separate Claude Code
release, 2.7.0. Neither takes new work.

## Validation and limits

The reviewed-increment protocol is implemented for Codex only and is not
available in Claude Code yet: the shared prompt builder accepts review rows on
both hosts, but Claude Code's skills do not offer the protocol, and its
behavior there has not been established. Its preparation, wait, recovery and
integrated-close instructions live in
[`prepare-increments.md`](skills/roadmap/prepare-increments.md),
[`increment-review.md`](skills/roadmap/increment-review.md),
[`resume-increments.md`](skills/roadmap/resume-increments.md), and
[`close-increments.md`](skills/roadmap/close-increments.md). It reuses format
2, existing parent notes and safe checkpoints. No persistent increment state,
new configuration, universal client enforcement or automatic exact recovery is
promised. Older clients may read the data without following the review
protocol. The contract behind it is
[incremental acceptance](docs/adr/NANOTASKS-RECONCILED.md).

The test suite exercises the runtime directly in temporary repositories,
including old data, task selection, locks, correction guards, staged closes,
commit ownership, grounding, Windows commands, Codex patch payloads and explicit
lifecycle behavior. Plugin and skill validators check package shape and
metadata.

These tests do not establish end-to-end behavior in every installed Codex host.
Earlier bounded native-subagent smoke exercises checked generated investigation
and implementation briefs in disposable projects: the research task reported an
existing failing check without editing files; the implementation changed only
its authorized source and passed the existing check. These are behavioral smoke
checks, not a performance benchmark. No Claude Code benchmark result is
presented as Codex evidence. After a local installation, a new-session smoke
test should cover init, pick and export, start, commit evidence, acceptance,
and enabled hooks in a disposable project.

The 2026-09-08 validation of reviewed increments — automated tests plus
controlled headless cases covering waiting, feedback, pause, recovery, final
acceptance, omissions and a failed required check — is recorded with its
limits in [the evidence report](https://github.com/V-Songbird/foundry/blob/main/docs/foreman/validation/NANOTASKS-DOGFOOD.md).
Separate ephemeral executions recovered from notes and files; this does not
establish `codex exec resume` against a persisted session.

## Use reviewed increments after installing

Install or update `foreman@foundry`, then start a **new Codex task**.
Reinstalling does not replace instructions already loaded in an existing
conversation. In the target project, ask Foreman to run a selected task in
increments and wait for approval after each result. For example:

> Foreman, run task 123 here in increments and wait for my approval between results.

No new configuration field, roadmap migration or reinitialization is needed.
The explicit request enables review for that run; an ordinary split does not.
An already chosen destination is kept. Background delivery needs a coordinator
able to relay the review, and a copied prompt carries the protocol even for a
single row.

Inspect the active package with `codex plugin list --marketplace foundry --json`.
A fresh-session evaluation by the user is a separate step from installing the
package. To try the workflow from a source checkout without installing
anything, see
[trying reviewed increments from source](CONTRIBUTING.md#trying-reviewed-increments-from-source).
