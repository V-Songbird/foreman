# Codex compatibility and migration

This is a Codex-first port of Foreman 2.6.0. It changes the runtime integration
while preserving Foreman's roadmap, confidence modes, handoff choices, evidence,
acceptance and optional local ledger. It is not a promise of simultaneous Claude
Code support. Historical records and the dependency-free core remain compatible.

## Runtime baseline

The local CLI inspected during this port reports `codex-cli 0.145.0`. The adapter
uses synchronous command hooks available in that version. Current online docs
also describe newer features, so this port does not depend on asynchronous hook
commands, MCP hook actions or newer event types.

Codex discovers `.codex-plugin/plugin.json`, `skills/`, and `hooks/hooks.json`.
The hook manifest uses the default discovery location; no unsupported `hooks`
field is needed in the plugin manifest. Launchers read `process.env.PLUGIN_ROOT`
inside Node, so they work without Bash/PowerShell/cmd variable interpolation.
Node.js must be on the Codex host's PATH.

References checked for this implementation:

- [Official plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [Official Codex hook contracts](https://developers.openai.com/codex/hooks)
- [Codex 0.145.0 hook types](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/hooks/src/lib.rs)
- [Codex 0.145.0 hook discovery](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/hooks/src/engine/discovery.rs)

## Feature mapping

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

The copied workspace originally contained a stale submodule `.git` pointer.
Its Git history was copied locally into independent metadata, HEAD was moved to
`codex/port` before project edits, and the upstream remote was preserved as
`https://github.com/V-Songbird/foreman.git`. Neither Foundry nor its original
Foreman checkout was edited. No branch is pushed by this conversion.

## Validation and limits

The test suite exercises the runtime directly in temporary repositories,
including old data, task selection, locks, correction guards, staged closes,
commit ownership, grounding, Windows commands, Codex patch payloads and explicit
lifecycle behavior. Plugin and skill validators check package shape and metadata.

These tests do not establish end-to-end behavior in every installed Codex host.
No model-backed Codex session has been launched as a benchmark for this port, and
no original Claude benchmark result is presented as Codex evidence. After local
installation, a new-session smoke test should cover init, pick/export, start,
commit evidence, acceptance, and enabled hooks in a disposable project.
