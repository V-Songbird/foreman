# Foreman settings

Foreman stores optional project settings in `.foreman/config.json`.

`/foreman:init` asks three things — what the project is, its near-term
goals, and whether the drafted roadmap looks right — and writes the file
with safe defaults for everything else: `requireVerification: true`,
`taskCloseGate: "off"`, and the prompt template's own defaults
(`usePersona: true`, `omitSections: []`, `fableEnabled: false`). No policy
questions, so nothing optional has to be understood before the first task.

`discoverySuggestions`, `decisionLog`, and `modelSuggestions` are not
written at init at all. A missing key is off — and it is also how Foreman
knows the question was never put to you, so each is asked once at the first
moment it could matter, and the answer is written then:

| Setting | Asked at |
| --- | --- |
| `discoverySuggestions` | the first commit discovery would have run on |
| `decisionLog` | the first `kind: "decision"` task added |
| `checkpoints` | the first split run (`onFinish` already defaults to asking) |
| `modelSuggestions` | never automatically — set it when you want the advice |

Any of them can also just be set in the file by hand.

| Setting | What it does |
| --- | --- |
| `discoverySuggestions` | After each commit, offer new roadmap entries Claude spotted in the work. Off by default; set `true` to enable. The roadmap itself is never pasted into the commit's context — each candidate suggestion is checked against existing entries with one compact `check-duplicate` call instead. |
| `usePersona` | Whether handoff prompts open with a "You are a…" role sentence (default `true`), or plain domain framing. |
| `omitSections` | Prompt sections to leave out entirely (`tone`, `example`, `background`, `output_format`). Default none. |
| `customSections` | Extra sections to add to crafted prompts, each `{tag, content}` rendered as an inline `<tag>` block. Tags reserved by the template are rejected. Default none. |
| `requireVerification` | Hold off marking a task done after a commit until you confirm it's verified — the task moves to `awaiting_acceptance` (finished, waiting on you) instead, with its commit recorded; your confirmation closes it, and "not ready" sends it back to `in_progress`. On by default; set `false` to close a task as soon as its commit lands. |
| `taskCloseGate` | When a tracked task finishes with its roadmap entry still open: `off` (default) says nothing, `block` holds the completion until you close the entry. |
| `decisionLog` | The why-notes described in [`decision-log.md`](decision-log.md): `{enabled, dir, gate}`. Disabled by default. Applies to `kind: "decision"` tasks only — ordinary implementation work is never asked for a decision note, whatever this is set to. |
| `checkpoints` | How task-split runs save their work. Optional keys set the base branch, whether to use a `foreman/<slug>` branch, and what to do at the end — `squash`, `merge`, `pr`, or `keep`. Default: ask. Checkpoint commits stay local. A run that starts on a dirty tree makes **no** automated checkpoint commits at all — it says so once and leaves every change for you to commit, rather than sweeping your work into a checkpoint. |
| `modelSuggestions` | Whether each handoff suggests a model and reasoning effort. Off by default and never asked about — set it to `true` here the day you want the advice, which keeps it out of both setup and the common path until then. |
| `targetModel` | How much detail a prompt spells out. Default `inherit`; a concrete model tunes the handoff for that target. |
| `fableEnabled` | Whether this project can run Fable 5. Init writes `false`; set it to `true` by hand when your plan can run Fable 5. |
| `trialLog` | Whether this project keeps a local log of how Foreman is used, so its own health numbers can be measured. Off by default and never asked about. It records counts, booleans, and Foreman's own branch names — never a task title, a file path, an id, or anything you typed. The file is `.foreman/trial-log.jsonl`, it never leaves your machine, and deleting it at any moment is a supported thing to do. See [`benchmarks/health/TRIALS.md`](benchmarks/health/TRIALS.md). |

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
