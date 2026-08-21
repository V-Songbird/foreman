# Foreman settings

Foreman keeps optional project settings in `.foreman/config.json`.
`/foreman:init` writes that file empty, because every setting below already
has a safe default in the code that reads it. Most projects never open it.

## The ones you might change

| Setting | What it does |
| --- | --- |
| `requireVerification` | Hold off marking a task done after a commit until you confirm it's verified. The task waits on you, with its commit recorded. Your confirmation closes it, and "not ready" sends it back. On by default. Set `false` to close a task as soon as its commit lands. |
| `discoverySuggestions` | After each commit, offer new roadmap entries Claude spotted in the work. Off by default. The roadmap itself is never pasted into the commit's context. |
| `checkpoints` | How a split run saves its work: `{baseBranch, branch, onFinish}`. By default it uses a `foreman/<slug>` branch and asks once, at the end of the first run, what to do with it — squash, merge, PR, or keep. Your answer is remembered here. Checkpoint commits stay local, and a run that starts on a dirty tree makes **no** automated commits at all. |
| `usePersona` | Whether handoff prompts open with a "You are a…" role sentence (default `true`), or plain domain framing. |
| `omitSections` | Prompt sections to leave out entirely: `tone`, `example`, `background`, `output_format`. Default none. |
| `ledger` **[Beta]** | The one record of what finished tasks learned, described in [`ledger.md`](ledger.md): `{enabled, dir}`. Off by default, and the youngest setting here — expect rough edges. A close can leave one sentence about the code it touched; a later task planning to touch those files gets it back, and so does anyone who opens one of them. Stored in `.foreman/notes.jsonl`, append-only, written only by the CLI. Every quoted line says how stale it is. A lesson that proved wrong is retired during a survey, and never quoted again. `dir` is only read: it says where an `[Foreman: <id>]` anchor looks for a document your project already keeps. Turning it back off changes nothing already recorded. The older `decisionLog` and `areaNotes` keys still work, and `decisionLog.gate` no longer does anything. |

Three of them are asked for you, once, at the moment they first matter:
`discoverySuggestions` at the first commit discovery would have run on,
`checkpoints` at the end of the first split run, and `ledger` at the first
pick where a finished task already touched the files this one plans to. A
missing key is off, and its absence is also how Foreman knows the question
was never put to you.

## Everything else

`taskCloseGate` decides what happens when a tracked task finishes with its
roadmap entry still open — `"off"` (default) says nothing, `"block"` stops
the first completion attempt with instructions to close the entry; the
retry then passes.

`fableEnabled` declares that this project can run Fable 5. It defaults to
`false`, and setting it `true` only adds Fable to the list of models a
handoff can be dispatched to.

`trialLog` keeps a local log of how Foreman is used, so its own health
numbers can be measured. Off by default. It records counts, booleans, and
Foreman's own branch names — never a task title, a file path, an id, or
anything you typed. The file is `.foreman/trial-log.jsonl`, it never leaves
your machine, and deleting it at any moment is supported. See
[`TRIALS.md`](TRIALS.md).

## Sharing a session with another plugin

When another plugin already supplies the session persona and output voice,
Foreman can stay out of those lanes:

```json
{
  "usePersona": false,
  "omitSections": ["tone", "output_format"]
}
```

Foreman does not detect other plugins. This works with any persona or
output-style plugin.
