# Foreman settings

Foreman stores optional project settings in `.foreman/config.json`.
`/foreman:init` asks about the common choices and writes the file, so manual
configuration is normally unnecessary.

| Setting | What it does |
| --- | --- |
| `discoverySuggestions` | After each commit, offer new roadmap entries Claude spotted in the work. Off by default; set `true` to enable. The roadmap itself is never pasted into the commit's context — each candidate suggestion is checked against existing entries with one compact `check-duplicate` call instead. |
| `usePersona` | Whether handoff prompts open with a "You are a…" role sentence (default `true`), or plain domain framing. |
| `omitSections` | Prompt sections to leave out entirely (`tone`, `example`, `background`, `output_format`). Default none. |
| `customSections` | Extra sections to add to crafted prompts, each `{tag, content}` rendered as an inline `<tag>` block. Tags reserved by the template are rejected. Default none. |
| `requireVerification` | Hold off marking a task done after a commit until you confirm it's verified — the task moves to `awaiting_acceptance` (finished, waiting on you) instead, with its commit recorded; your confirmation closes it, and "not ready" sends it back to `in_progress`. On by default; set `false` to close a task as soon as its commit lands. |
| `taskCloseGate` | When a tracked task finishes with its roadmap entry still open: `off` (default) says nothing, `block` holds the completion until you close the entry. |
| `decisionLog` | The why-notes described in [`decision-log.md`](decision-log.md): `{enabled, dir, gate}`. Disabled by default. |
| `checkpoints` | How task-split runs save their work. Optional keys set the base branch, whether to use a `foreman/<slug>` branch, and what to do at the end — `squash`, `merge`, `pr`, or `keep`. Default: ask. Checkpoint commits stay local. A run that starts on a dirty tree makes **no** automated checkpoint commits at all — it says so once and leaves every change for you to commit, rather than sweeping your work into a checkpoint. |
| `modelSuggestions` | Whether each handoff suggests a model and reasoning effort. Off by default. |
| `targetModel` | How much detail a prompt spells out. Default `inherit`; a concrete model tunes the handoff for that target. |
| `fableEnabled` | Whether this project can run Fable 5. Asked once during initialization; default `false`. |

When another plugin already supplies the session persona and output voice,
Foreman can stay out of those lanes:

```json
{
  "usePersona": false,
  "omitSections": ["tone", "output_format"]
}
```

Foreman does not detect other plugins. This configuration works with any
persona or output-style plugin.
