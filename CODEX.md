# Codex compatibility and migration

This is a Codex-first port of Foreman 2.6.0. It changes the runtime integration
while preserving Foreman's roadmap, confidence modes, handoff choices, evidence,
acceptance and optional local ledger. It is not a promise of simultaneous Claude
Code support. Historical records and the dependency-free core remain compatible.

## Runtime baseline

The initial port inspected `codex-cli 0.145.0`. The adapter
uses synchronous command hooks available in that baseline. Current online docs
also describe newer features, so this port does not depend on asynchronous hook
commands, MCP hook actions or newer event types.

Codex discovers `.codex-plugin/plugin.json`, `skills/`, and `hooks/hooks.json`.
The hook manifest uses the default discovery location; no unsupported `hooks`
field is needed in the plugin manifest. Launchers read `process.env.PLUGIN_ROOT`
inside Node, so they work without Bash/PowerShell/cmd variable interpolation.
The portable source hooks call `node`, so that executable must be available to
their launcher. The local Windows installation retains its fnm-managed Node path
in `commandWindows`; interactive shells still initialize fnm normally. Updating
the package must preserve this host adaptation rather than assuming a machine PATH.

Reviewed-increment behavioral tests used the app-bundled CLI **0.153.4**. The
global CLI 0.145.0 rejected the configured `gpt-6-astra` model as requiring a newer
CLI; the tests used the existing app executable without changing model or effort.
This is the observed environment, not a model recommendation.

References checked for this implementation:

- [Official plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [Official Codex hook contracts](https://developers.openai.com/codex/hooks)
- [Codex 0.145.0 hook types](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/hooks/src/lib.rs)
- [Codex 0.145.0 hook discovery](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/hooks/src/engine/discovery.rs)

## Feature mapping

Handoff wording is checked against official prompting guidance and the shipped
Codex instruction template. See [Codex handoff prompting](CODEX-PROMPTING.md) for
the source mapping, retained Foreman policies, and validation limits.

| Original behavior | Codex implementation | Boundary |
| --- | --- | --- |
| Five skills and plain-language entrance | Codex skill frontmatter, UI metadata, linked runtime guidance | Load installed skills in a new session; tool availability varies by host |
| Interactive choices | Available Codex question tool, with text fallback | A pending question is not an answer; explicit scope and acceptance are preserved |
| Background agents and split task rows | Native Codex subagents with bounded ownership and coordinator verification | Shared-tree bookkeeping is serialized; separate sidebar tasks require an explicit request |
| Task-created opening | `hooks/codex-task.js start` with readiness/CAS guards | Exporting a prompt never starts the task |
| Optional task-completed gate | Explicit `check` plus scoped `Stop`/`SubagentStop` | A normal turn ending or a clarification does not imply task completion |
| Fresh-session reminders | `SessionStart` on startup/clear | Hooks must be trusted and enabled |
| Direct roadmap write guard | `PreToolUse` for canonical `apply_patch` and file-tool aliases | Covers add/update/delete and move destinations; arbitrary shell writes are outside this guard |
| Successful-commit bookkeeping | `PostToolUse` for canonical `Bash` (including Codex shell execution) and compatibility `PowerShell` | Native payloads may omit exit status; confirm command success before using the hint. Reminders do not write the roadmap |
| File/decision/lesson recall | Prompt-time recall plus `PostToolUse` for patches and file-tool aliases | General shell commands such as `rg`, `cat`, or `Get-Content` are not parsed into reliable file-read events |
| Context-full destination advice | Unknown when Codex supplies no reliable measurement | Does not inspect Claude settings or interpret Claude usage as Codex usage |
| Roadmap/ledger/archive/health/trials | Existing local Node core | Format 2 and optional legacy settings are retained |
| Model/effort history | Exact known model identifier and actual effort | Inherit runtime defaults; storage validation is not availability detection |

Codex 0.145.0 does not guarantee a shell exit code in `PostToolUse`. Structured
adapter exit codes are honored when present; a missing code does not prove that
the observed HEAD belongs to a successful new commit. The hook requests a check
against the actual tool result before evidence is recorded. See the upstream
[exit-status issue](https://github.com/openai/codex/issues/34289).

The original `task-created.js` and `task-completed.js` adapters remain for legacy
fixtures and direct callers, but are not registered as Codex events. Legacy
context parsing is retained for old adapter callers only; it is not registered
in the Codex hook manifest, since it cannot supply a trustworthy native signal.

## Explicit lifecycle

Discovery is also an explicit execution responsibility. Generated handoffs and
the `start`/`check` results carry the policy in `skills/foreman/discovery.md`.
The executor reviews observed out-of-scope findings before reporting completion,
including investigations and uncommitted work; subagents return candidates to
their coordinator. `discoverySuggestions:false` disables the workflow. Duplicate
checking precedes proposals, and the user chooses Add, Execute here, Execute
with a background subagent, or Reject before new work is recorded or performed.

This preserves the choices from the original Foundry Foreman checkout at
`4eb352c` (`hooks/post-commit.js`, `discoveryBlock`) while extending its
commit-only trigger and replacing its instruction to discard background-agent
suggestions. The commit hook shares this same policy, including evidence-based opportunities
and acceptance for separately implemented work. No experimental environment
switch changes the discovery threshold. The commit hook remains advisory; commits inside helper scripts
need not be recognized for the explicit completion review to run. Local tests
verify policy delivery, not that a model will identify every useful finding.

From the project directory, using the actual installed plugin path:

```sh
node /absolute/path/to/foreman/hooks/codex-task.js start --id 001
node /absolute/path/to/foreman/hooks/codex-task.js check --id 001
```

Quote paths containing spaces. `--root` explicitly selects the project. The
helper uses host session/thread identifiers when available; `--session` and
`--agent` can identify an explicit hook scope. Without a usable session identity,
the CLI checkpoint still works but a later Stop cannot be scoped automatically.

`start` must report a ready `in_progress` entry before execution. `check` returns
nonzero while a scoped entry remains planned/in progress, and only that explicit
attempt arms the optional `taskCloseGate: "block"` reminder. The hook consumes the
attempt once, honors `stop_hook_active`, and leaves acceptance decisions to the
user. A completed implementation awaiting acceptance passes the close check.

## Existing projects

- Keep `ROADMAP.jsonl`, `.foreman/config.json`, `.foreman/archive.jsonl`, and
  `.foreman/notes.jsonl`. Do not reinitialize them to switch runtimes.
- Format 2 is unchanged. Older entries still read in memory through the existing
  migrations; writes use the original backup/migration path.
- `source: "claude-suggested"` and old model labels remain valid historical data.
  New Codex proposals use `codex-suggested`; explicit requests use `user`.
- Existing `decisionLog`/`areaNotes` aliases, verification defaults, checkpoint
  finish preferences, and trial privacy rules remain.
- CLI project selection is `FOREMAN_PROJECT_DIR`, then optional `CODEX_CWD`, then
  legacy `CLAUDE_PROJECT_DIR`, then cwd. Hook payload cwd identifies the session;
  explicit configured project roots preserve parent-roadmap commit handling.
- Handoffs contain verified installed script paths. If a plugin is reinstalled
  elsewhere, resolve its scripts from the newly loaded skill before executing
  an old exported prompt. Never invent a plugin-root environment variable.

Foreman lives in the Foundry submodule backed by
`https://github.com/V-Songbird/foreman.git`. The `Codex` branch contains this
implementation, `Claude` contains the Claude Code version, and `main` is the
platform front page. The Foundry catalogs select their own branch and pinned
commit independently of the local submodule checkout.

## Validation and limits

The reviewed-increment protocol is implemented for Codex only. Its preparation,
wait, recovery and integrated-close instructions live in
[`prepare-increments.md`](skills/roadmap/prepare-increments.md),
[`increment-review.md`](skills/roadmap/increment-review.md),
[`resume-increments.md`](skills/roadmap/resume-increments.md), and
[`close-increments.md`](skills/roadmap/close-increments.md). It reuses format 2,
existing parent notes and safe checkpoints. No persistent increment state,
new configuration, universal client enforcement or automatic exact recovery is
promised. Older clients may read the data without following the review protocol;
Claude behavior has not been established by this Codex implementation.

The test suite exercises the runtime directly in temporary repositories,
including old data, task selection, locks, correction guards, staged closes,
commit ownership, grounding, Windows commands, Codex patch payloads and explicit
lifecycle behavior. Plugin and skill validators check package shape and metadata.

These tests do not establish end-to-end behavior in every installed Codex host.
Earlier bounded native-subagent smoke exercises checked generated investigation and
implementation briefs in disposable projects: the research task reported an
existing failing check without editing files; the implementation changed only
its authorized source and passed the existing check. These are behavioral smoke
checks, not a performance benchmark. No original Claude benchmark result is
presented as Codex evidence. After local
installation, a new-session smoke test should cover init, pick/export, start,
commit evidence, acceptance, and enabled hooks in a disposable project.

Reviewed increments were validated with **1,359 automated tests and 11 controlled
headless cases**, including waiting, feedback, pause, recovery, final acceptance,
omissions and a failed required check. Separate ephemeral executions recovered
from notes and files; this does not establish `codex exec resume` against a
persisted session. See [the evidence report](https://github.com/V-Songbird/foundry/blob/main/docs/foreman/validation/NANOTASKS-DOGFOOD.md).

## Use reviewed increments after installing

Install or update this version of `foreman@foundry`, then start a **new Codex
task**. Reinstalling does not replace instructions already loaded in an existing
conversation. In the target project, ask Foreman to execute a selected task by
increments and wait for approval after each result. For example:

> Foreman, ejecuta la tarea 123 aquí por incrementos y espera mi aprobación entre resultados.

No new configuration field, roadmap migration or reinitialization is needed.
The explicit request enables review for that run; an ordinary split does not.
An already chosen destination is kept. Background delivery needs a coordinator
able to relay the review, and a copied prompt carries the protocol even for one row.

Inspect the active package with `codex plugin list --marketplace foundry --json`.
The local installation and cache smoke check are recorded in
[the deployment record](https://github.com/V-Songbird/foundry/blob/main/docs/foreman/validation/NANOTASKS-DOGFOOD.md#instalación-local-posterior).
Fresh-session user evaluation remains distinct from package installation.

## Evaluate reviewed increments from source

Use this worktree's scripts and protocol references explicitly, rather than
assuming an installed plugin cache contains them. This evaluation does not
require installation, marketplace edits or publication.

1. Read the [workflow and complete payload](HOW-IT-WORKS.md#review-between-increments).
   Save the JSON example as a UTF-8 file in a temporary location. From this
   checkout, use `Get-Content -Raw '<payload-file>' | node ./scripts/craft-handoff.js`
   in PowerShell, or `node ./scripts/craft-handoff.js < '<payload-file>'` in a
   POSIX shell. On Windows with fnm, first initialize the current console with
   `fnm env --use-on-cd | Out-String | Invoke-Expression`.
2. Inspect the returned `ok`, `gate`, `warnings` and `prompt`. Assembly validates
   the payload and generates text; it does not implement the example, place it
   on the clipboard, or demonstrate a real wait. The embedded script paths refer
   to this source checkout. For another project, explicitly set
   `FOREMAN_PROJECT_DIR` and adjust the example's files and checks to real ones.
3. Run `node --test tests/*.test.js` from this checkout for runtime regressions.
   Keep any behavioral exercise in a disposable project with its own files and
   roadmap. Execute the generated prompt only when intending to start that
   work, retaining its review protocol and actual source paths.
4. Observe a real pause before dependent work, supply a real decision, then
   resume. Exercise Request changes and Pause deliberately, and identify those
   exercises as rehearsals. Interrupt and resume once with sufficient evidence
   and once with an ambiguous or changed artifact; the latter must request
   revalidation. A run without a human channel must leave review pending.

Separate automated regressions, headless behavioral observations, deliberate
rehearsals and actual user acceptance in the evidence. Generated wording or a
passing structural check alone does not prove that an executor waited. An
explicit waiver for one evaluation run records omitted review and does not
change the product default or establish human acceptance of the feature.
