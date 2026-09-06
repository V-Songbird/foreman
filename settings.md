# Foreman settings

Optional project settings live in `.foreman/config.json`. Initialization starts
with `{}` unless you request particular options. Existing configuration and
legacy ledger aliases remain readable.

## Settings

| Setting | Behavior |
| --- | --- |
| `requireVerification` | Default `true`. Record implementation evidence and hold the entry at `awaiting_acceptance` until you accept it. `false` allows the ordinary evidence-backed close without a separate acceptance hold. |
| `discoverySuggestions` | Default `true`. After a successful commit, offer newly discovered work. Suggestions do not authorize adding unrelated work. |
| `checkpoints` | `{baseBranch, branch, onFinish}`. Split execution uses a work branch (normally `foreman/<slug>`), local checkpoints, and a user-selected finish action: squash, merge, PR, or keep. A dirty starting tree disables automated commits. Existing branch restrictions still apply; no protected branch is chosen implicitly. |
| `usePersona` | Default `true`. Include a brief role sentence in a handoff; `false` uses domain framing. This never selects the executing model. |
| `omitSections` | Optional list drawn from `tone`, `example`, `background`, `output_format`. Required grounding and acceptance constraints remain. |
| `ledger` | `{enabled, dir}`. Off by default. Store useful lessons and recall them with freshness labels. `dir` locates existing decision documents (default `docs/foreman`); Foreman reads those documents, it does not author them. Disabling the ledger deletes nothing. Legacy `decisionLog` and `areaNotes` still work; `decisionLog.gate` is ignored. |
| `taskCloseGate` | `"off"` by default; `"block"` enables a scoped Codex `Stop`/`SubagentStop` reminder after an explicit unresolved `codex-task.js check`. The hook consumes that attempt once and respects `stop_hook_active`. It never blocks an entry awaiting acceptance or unrelated work in the roadmap. |
| `trialLog` | Off by default. Keeps `.foreman/trial-log.jsonl` locally with bounded counts, booleans and enum values; no task titles, paths, entry IDs, or user text. See [TRIALS.md](TRIALS.md). |

The checkpoint finish preference is requested when it first matters. The ledger
is offered once when a pick would benefit from previously completed overlapping
work. A declined ledger offer is remembered.

## Context and runtime

The destination choice retains Foreman's context-capacity signal when a host
actually supplies it. Codex 0.145.0 hook payloads do not supply a reliable current
context-fill measurement, so this port makes no estimate and does not read
Claude settings/transcripts for Codex events. Use the native Codex context
indicator or a fresh task when needed; unknown capacity is not treated as zero.

CLI project resolution is `FOREMAN_PROJECT_DIR`, then optional `CODEX_CWD`, then
legacy `CLAUDE_PROJECT_DIR`, then the current working directory. Run from your
target project or set the first variable explicitly. Plugin hooks resolve paths
from Codex's `PLUGIN_ROOT`; skills resolve their installed resource paths from
the loaded skill's location.

## Sharing a session with another plugin

To leave the persona and presentation voice to another plugin:

```json
{
  "usePersona": false,
  "omitSections": ["tone", "output_format"]
}
```

Foreman does not detect other plugins or rewrite your Codex configuration.
