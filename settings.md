# Foreman settings

Foreman keeps optional project settings in `.foreman/config.json`, and the
same file serves Claude Code and Codex. Initialization writes it as an empty
object, `{}`, when it is missing and leaves an existing file exactly as it is,
because every setting below already has a safe default in the code that reads
it. Most projects never open it.

## The ones you might change

| Setting | What it does |
| --- | --- |
| `requireVerification` | Hold off marking a task done after a commit until you confirm it's verified. The task waits on you, with its commit recorded. Your confirmation closes it, and "not ready" sends it back. On by default. Set `false` to close a task as soon as its commit lands. |
| `discoverySuggestions` | Offer work Foreman noticed that the roadmap does not track yet — a bug, a gap, an improvement — and ask you before anything is added. On by default. Set `false` to turn it off. In Claude Code the offer comes after each commit. In Codex it comes after each commit too, and every handoff carries it, so the session also looks before reporting completion; that covers investigations and work that was never committed. The roadmap itself is never pasted into the commit's context. |
| `checkpoints` | How a split run saves its work: `{baseBranch, branch, onFinish}`. By default it uses a `foreman/<slug>` branch and asks once, at the end of the first run, what to do with it — squash, merge, PR, or keep. Your answer is remembered here. Checkpoint commits stay local, and a run that starts on a dirty tree makes **no** automated commits at all. Existing branch restrictions still apply, and Foreman never picks a protected branch on its own. |
| `usePersona` | Whether handoff prompts open with a "You are a…" role sentence (default `true`), or plain domain framing. It never chooses which model runs the task. |
| `omitSections` | Prompt sections to leave out entirely: `tone`, `example`, `background`, `output_format`. Default none. The grounding and acceptance rules always stay, and so does the short block that points a Codex session at its own host instructions (`codex_runtime`). |
| `ledger` **[Beta]** | One place for what a finished task learned, described in [`ledger.md`](ledger.md): `{enabled, dir}`. Off by default, and the youngest setting here — expect rough edges. A finished task can leave one sentence about the code it touched. The next task that plans to touch those files is handed it, and so is anyone who opens one of them. Every sentence comes with a note saying whether that code has moved since, and one that turns out to be wrong can be retired so it stops being quoted. `dir` (default `docs/foreman`) says where a `[Foreman: 019]` comment should look for a written decision, if your project keeps one — Foreman only reads there, never writes. Turning it back off deletes nothing already recorded. If your settings still say `decisionLog` or `areaNotes`, leave them; both still work, and `decisionLog.gate` no longer does anything. |

Two of them are asked for you, once, at the moment they first matter:
`checkpoints` at the end of the first split run, and `ledger` at the first
pick where a finished task already touched the files this one plans to. A
missing key means off, and its absence is also how Foreman knows the
question was never put to you. Your answer is written here, so it is not
asked again: a no to the ledger is stored as `"ledger": {"enabled": false}`.

## Everything else

`taskCloseGate` decides what happens when a tracked task finishes with its
roadmap entry still open. `"off"` (default) says nothing. `"block"` works on
both hosts, each through its own hooks:

- **Claude Code** stops the first completion attempt with instructions to
  close the entry; the retry then passes.
- **Codex** has no task-completion event, so the reminder needs an explicit
  `hooks/codex-task.js check` that finds the entry still open. The next `Stop`
  or `SubagentStop` in that session or subagent then asks for one more turn to
  close it. Each check arms the reminder once, and a turn that is already
  continuing because of it is not stopped again.

Neither host holds back an entry that is waiting for your acceptance, or
anything unrelated to the task.

"How do you want to run this?" points a session that is filling up at the
clipboard, so the work starts in a fresh window instead of a crowded one. It
can only say that when it knows how much room your window has, and nothing
Foreman can read carries that by default. In Claude Code, two things tell it:
the `CLAUDE_CODE_AUTO_COMPACT_WINDOW` environment variable, or an
`autoCompactWindow` key in your Claude Code `settings.json` — the value is
the point your session compacts at, between 100000 and 1000000 tokens. With
neither set, the question stays quiet about context and recommends on
everything else. Codex does not report a trustworthy measure of how full a
session is, so in Codex the question always stays quiet about it. Foreman
never reads Claude Code settings for a Codex session and never treats an
unknown size as an empty one; Codex's own context indicator, or a fresh
session, is the way to judge it there.

`trialLog` keeps a local log of how Foreman is used, so its own health
numbers can be measured. Off by default. It records counts, booleans, ranks,
elapsed seconds and names from a closed list — never a task title, a file
path, an entry id, or anything you typed. The file is
`.foreman/trial-log.jsonl`, it never leaves your machine, and deleting it at
any moment is supported. See [`TRIALS.md`](TRIALS.md).

## Reviewed increments are not a setting

This applies to Codex only; Claude Code does not offer reviewed increments yet.

`reviewEachIncrement` is **not a setting and not a roadmap field**. The prompt
builder receives it only for a run where you explicitly ask to approve each
result before the next one is built — see
[review between increments](HOW-IT-WORKS.md#review-between-increments). Absent
or `false` keeps an ordinary split; `true` requires your review on every
increment, even when its tests pass. The builder never guesses this choice
from your wording. Do not put it in `.foreman/config.json`.

`requireVerification: false` does not cancel reviews you asked for. It keeps
its usual whole-task close behavior, and while final acceptance is required,
accepting one increment does not accept the task. An explicit instruction to
continue without a particular review is recorded as an omitted check
(`unverified:`), never as acceptance and never as a quiet settings change.

## Which project Foreman works on

Foreman's scripts and hooks act on one project root: the folder that holds
`ROADMAP.jsonl`. Usually that is simply where you are working. To name it
yourself, set `FOREMAN_PROJECT_DIR`; it wins everywhere.

- **Scripts you run** look at `FOREMAN_PROJECT_DIR`, then `CODEX_CWD`, then
  `CLAUDE_PROJECT_DIR`, then the current directory.
- **Hooks in Claude Code** look at `FOREMAN_PROJECT_DIR`, then
  `CLAUDE_PROJECT_DIR`, which Claude Code sets to the session's project, then
  the directory the hook event reports. The session's project comes first
  because a session can move into a subfolder.
- **Hooks in Codex** look at `FOREMAN_PROJECT_DIR`, then the directory the
  hook event reports, then `CODEX_CWD`, then `CLAUDE_PROJECT_DIR`. The event
  comes first because a `CLAUDE_PROJECT_DIR` that Codex inherited belongs to
  some other session.

Foreman tells the hosts apart the same way everywhere: `FOREMAN_HOST`
(`claude` or `codex`) wins when it is set; otherwise `PLUGIN_ROOT`,
`CODEX_THREAD_ID` or `CODEX_SESSION_ID` means Codex, and anything else —
including running a script by hand in a terminal — counts as Claude Code.

## Using both hosts on one project

Claude Code and Codex read this same file, and every setting means the same
thing in both, so keep the file as it is when you switch. What differs is when
a few settings act: `discoverySuggestions` and `taskCloseGate` run through
each host's own hooks, advice about session size exists only in Claude Code,
and reviewed increments exist only in Codex. The roadmap, its archive and the
ledger are shared the same way — see [`roadmap-schema.md`](roadmap-schema.md).

## Sharing a session with another plugin

When another plugin already supplies the session persona and output voice,
Foreman can stay out of those lanes:

```json
{
  "usePersona": false,
  "omitSections": ["tone", "output_format"]
}
```

Foreman does not detect other plugins and does not change your host's
configuration. This works with any plugin that sets a persona or a response
style.
