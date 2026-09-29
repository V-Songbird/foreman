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
need `node`. On Windows, the `commandWindows` form starts `node` from PATH
through cmd. It never runs a `node.exe` from the project folder. When PATH has
no `node`, it runs a PowerShell launcher, built from
`hooks/windows-launcher.ps1`, that uses a configured fnm default. The hook logic
is the same on every platform.

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

### Capabilities built after the 0.157.1 probe

Three capabilities were deferred because an earlier probe, on Codex CLI
0.144.6, found no event that could support them. A probe on 2026-09-28 with
Codex CLI 0.157.1 on Windows 11 found that each one can now be built, and all
three are now built. Tying a subagent's finish to its roadmap entry is
described in [Subagent finish and its entry](#subagent-finish-and-its-entry).
Detached resume is described in
[Resume a paused review](#resume-a-paused-review). The decision-anchor hook is
described in [Decision anchors in shell output](#decision-anchors-in-shell-output).
The probe used `codex exec` in a disposable repository with one logging hook
on every event, trusted through `/hooks`.

| Capability | Status on Codex CLI 0.157.1 | What the probe showed |
| --- | --- | --- |
| Detached resume: continue a session and its subagent from a new process | Built for reviewed increments, as instructions; see [Resume a paused review](#resume-a-paused-review) | `codex exec resume` kept the session id, and `SessionStart` reported `source` `resume`. `collaborationfollowup_task` reached the same subagent, with the same `agent_id`. `SubagentStart` did not fire again for it |
| Decision-anchor hook: recall the decisions a file's `[Foreman: <id>]` anchors name when Codex reads it | Built for anchors; lessons stay out. See [Decision anchors in shell output](#decision-anchors-in-shell-output) | Codex read files through `Bash`, not a file-read tool. `PostToolUse` on `Bash` carries the command output in `tool_response`, where the anchor text appears. The file path is not a separate field, so lessons recalled by path stay out of reach |

Tool names in Codex 0.157.1 events join the namespace and the tool:
`collaborationspawn_agent`, `collaborationwait_agent` and
`collaborationfollowup_task`. Hook processes received no `CODEX_THREAD_ID`
environment variable; the ids arrive in the event itself. The model's shell
commands, where `codex-task.js` reads that variable, do receive it. In the
probe (2 main-session shells, 1 subagent shell), `CODEX_THREAD_ID` equaled
`CODEX_SESSION_ID` in the main session. In the subagent's shell it equaled that
subagent's `agent_id`, and `CODEX_SESSION_ID` still equaled the parent's session
id. Resumed and nested subagents were not checked.

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
| Optional close gate | `TaskCompleted` hook | Explicit `check`, or the finish of a `foreman_<id>` subagent, plus a scoped `Stop`/`SubagentStop` reminder | A normal turn ending or a clarification does not count as task completion |
| Fresh-session reminders | `SessionStart` on startup and clear, as plain text | `SessionStart` on startup and clear, as JSON `additionalContext` | Hooks must be trusted and enabled. Codex drops plain hook output that starts with `[`, so the notice goes to Codex as JSON (see [Validation and limits](#validation-and-limits)) |
| Direct roadmap write guard | `PreToolUse` on `Edit` and `Write` | `PreToolUse` on `apply_patch`, `Edit` and `Write` | Covers add, update, delete and move destinations; shell writes are outside this guard on both hosts |
| Successful-commit bookkeeping | `PostToolUse` on `Bash` and `PowerShell` | `PostToolUse` on canonical `Bash` (including Codex shell execution) and compatibility `PowerShell` | Native payloads may omit the exit status; confirm the command succeeded before using the hint. Reminders never write the roadmap |
| File, decision and lesson recall | Prompt-time recall plus `PostToolUse` on `Read`, `Edit` and `Write` | Prompt-time recall plus `PostToolUse` on `apply_patch`, `Read`, `Edit` and `Write`; decision anchors also from `Bash` output | Shell commands such as `rg`, `cat` or `Get-Content` are not parsed into reliable file-read events, on either host. In Codex, the decision docs that anchors in `Bash` output name are recalled, but no lessons |
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
commit-time discovery prompt, which asks with `AskUserQuestion`; a background
agent with no user to ask returns its candidates and their evidence in its
final report instead.

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
acceptance passes the close check. An explicit `check` on an `in_progress`
entry blocks once even when its latest note is `paused:` or
`review pending:`; only a subagent's finish passes on such a note.

### Subagent finish and its entry

A subagent that carries a roadmap entry's handoff is named with the
`task_name` `foreman_<id>`, for example `foreman_042`. Foreman's handoff
wording tells the spawning session to use that name. The name lets Foreman
tie the subagent's finish to its entry:

1. When the subagent stops, the `SubagentStop` hook reads the entry id from
   the subagent's name.
2. With `taskCloseGate: "block"`, the hook arms the close check for that entry
   only, in the scope of the session or subagent that spawned it. The
   coordinator owns the entry's close, so the subagent itself is not blocked.
3. The coordinator's next `Stop` blocks once while the entry is still
   `planned` or `in_progress`, as after an explicit `check`. An entry awaiting
   acceptance, or already closed, passes. An entry whose last note line
   is `paused:` or `review pending:` passes too, because a reviewed
   increment waits there for the reviewer's answer. Each
   `collaborationfollowup_task` to a subagent whose review is pending then
   does not block the coordinator again. Any note recorded after that line,
   such as a decision or new work, ends the pass.

The `PreToolUse` hook on `collaborationspawn_agent` guards the name. A
`task_name` that is `foreman` or starts with `foreman_` must be exactly
`foreman_<id>` and name an entry in `ROADMAP.jsonl`, or the spawn is denied
with the reason. For example, `foreman_042_review` and a `foreman_<id>` with
no such entry are denied. Every other name passes, including
`foremanship_review`.

Limits, observed with Codex CLI 0.157.1 on Windows 11:

- Codex hands the hook the spawn message encrypted, so the hook cannot tell a
  handoff from an ordinary helper. It checks only `foreman` and names that
  start with `foreman_`. A handoff spawned under another name runs normally, and its
  finish is not tied to its entry.
- Hook events after the spawn carry no `task_name`. The name is read from the
  first record of the subagent's transcript file, where Codex writes its
  `agent_path`, such as `/root/foreman_042`. That record is an internal Codex
  format, not a documented hook field. When it is missing or changes shape,
  nothing is mapped, and only explicit `check` calls arm the close check.
- Live runs confirmed the denied name, the mapping and the single block for a
  subagent spawned by the main session. A subagent spawned by another
  subagent is covered by tests only.

### Resume a paused review

A reviewed run in Codex can wait for a review longer than its process lives.
`codex exec` ends after one turn, so the review answer often comes later. The
same session can then continue from a new process, with its conversation and
its subagent intact. Foreman builds this as instructions in its reviewed-increment
protocol, not as a hook or a stored state:

1. When a review is paused or gets no answer, the main session adds
   `Codex session <session id>` to its `paused:` or `review pending:` note.
   The id comes from `CODEX_THREAD_ID` in the main session's shell; in a
   subagent's shell, that variable holds the subagent's own id. The main
   session ends its turn with the command that continues the session.
2. The person continues it with `codex exec resume <session id> -`. The
   `-` makes Codex read the decision from standard input, so the person
   types or pastes it, then ends input with Ctrl+D in a POSIX shell, Git
   Bash included, or Ctrl+Z and Enter in PowerShell or cmd. In one owner
   run, Git Bash's own window (mintty) closed right after Ctrl+D, and the
   reply was not on screen. This was seen once. To keep Codex's reply,
   add `-o <file>` to the command, for example
   `codex exec resume -o <file> <session id> -`. Keeping the
   decision out of the command line keeps quotes, `$` and backticks away
   from the shell, which parses them differently in PowerShell and POSIX
   shells. When the person declines this command at pick time, Foreman
   records the decline, and the re-crafted handoff does not offer it again.
3. When a `foreman_<id>` subagent produced the result, the resumed session
   continues it with `collaborationfollowup_task` targeting
   `/root/foreman_<id>`. It never spawns a new subagent for the same work.
4. A resume is not an answer. The session refreshes the entry's notes and
   compares the new message with the result it presented, as
   [`resume-increments.md`](skills/roadmap/resume-increments.md) says.

A new session that finds `Codex session <session id>` in the notes offers
that command before it crafts the work again. A session the host no longer
knows falls back to recovery from the notes and files.

The session id stays in the roadmap on purpose. It is the identifier Codex
gives one conversation, and Codex keeps that conversation under the
`CODEX_HOME` directory of the machine that ran it. On any other machine, or
after that directory is cleared, the id resumes nothing. It is still a local
identifier: when a project commits `ROADMAP.jsonl`, the commit publishes the
id in the project's history. Foreman keeps it there so a later pick on the
same machine can still offer the resume command, the same way it keeps the
background agent and subagent ids a dispatch note records. A project that must
not publish such ids keeps `ROADMAP.jsonl` out of Git. The same choice covers
the session ids in the `delegatedAcceptance.sessions` list of
`.foreman/config.json`, so that project keeps `.foreman/config.json` out of Git
too. It also covers any id you write into a free-text note: Foreman's own
markers are only some of the ids a roadmap holds.

The session notice does not fire on resume. Foreman's `SessionStart`
registration keeps its matcher `^(startup|clear)$`, for three reasons:

- A resumed session keeps its conversation, which already holds the notice
  from its start. The resume instructions refresh the entry with
  `roadmap.js list --ids <id>`.
- A changed matcher changes the hook's trust hash, so every Codex user would
  have to trust the hooks again in `/hooks`.
- Each time `session-start.js` runs, it records a new session in the trial
  log, when trials are on. A resume is not a new session.

Observed with Codex CLI 0.157.1 on Windows 11, in two live `codex exec`
runs on 2026-09-28, with Foreman's hooks trusted in `/hooks`:

- The model's shell `CODEX_THREAD_ID` equaled the hook `session_id` in the
  main session.
- `codex exec resume` from a new process kept the same session id, and
  `SessionStart` reported `source` `resume`. Foreman's `session-start.js`
  did not run.
- `collaborationfollowup_task` targeting `/root/foreman_001` reached the
  same subagent, with the same `agent_id`. Its `SubagentStop` mapped to
  entry `001` again. No new spawn happened.

Not verified: a full reviewed-increment handoff paused and resumed live, or
a model following this wording on its own. The runs used a short probe
prompt. Also not verified: the close gate after a resumed subagent's finish,
resume in the Codex app or TUI, nested subagents, and Linux or macOS.

### Decision anchors in shell output

Codex reads files through its shell, so Foreman also watches `Bash` for
decision anchors. When a command's output contains a `[Foreman: <id>]` anchor
and the decision documents folder has `<id>.md`, the `PostToolUse` hook on
`Bash` tells the model to read that document before changing what it
governs. The notice names the document path, such as `docs/foreman/019.md`.
It appears once per session for the same set of anchors.

Limits:

- The output names no file, so lessons recorded about a file are not
  recalled from shell output. They are still recalled when Codex uses
  `apply_patch`, `Read`, `Edit` or `Write` on the file.
- One notice names at most 20 decision documents. When more match, it says
  how many it left out, and the model can read the rest from the anchors.
- Codex hands the output to the hook as plain text. When a Codex version
  sends it in another shape, the hook stays silent.
- Claude Code keeps recall on `Read`, `Edit` and `Write` only. It reads files
  with its `Read` tool, which this hook already covers.

This change added `Bash` to the matcher of the recall hook in
`hooks/codex-hooks.json`. A changed matcher changes the hook's trust hash, so
after updating Foreman, trust its hooks again in `/hooks`. Until then, Codex
does not run the recall hook.

Observed with Codex CLI 0.157.1 on Windows 11, in one live `codex exec` run on
2026-09-28, with Foreman's hooks trusted in `/hooks`: the model ran
`cat notes.txt` on a file carrying `[Foreman: 019]`. Codex ran it in
PowerShell and still reported the tool as `Bash`. The hook named
`docs/foreman/019.md`, and the model reported that path from the context it
received. Not verified: the Codex app, Linux or macOS. The hook reads only the
first 524,288 characters of an output.

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
package for every host, and from 3.2.0 that includes Antigravity. The three
plugin manifests carry the same version, and Foundry's Claude Code and Codex
catalogs pin the same `main` commit without a version of their own. The
separate releases ended with 3.0.4-codex.1 for Codex and 2.7.0 for Claude
Code, and their `Codex` and `Claude` branches were deleted on 2026-09-15.

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
[incremental acceptance](docs/knowledge/incremental-acceptance.md).

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
presented as Codex evidence.

An installed-package smoke test on 2026-09-26 installed a 3.2.0 pre-release
build, at commit 05bc91a, from a local marketplace and exercised it in live
`codex exec` sessions. Its manifests still read 3.1.0. The run used Codex CLI
0.157.1 on Windows 11 with a disposable Codex home and project. The six
Foreman hooks were trusted through `/hooks`, without a trust bypass. On
Windows, Codex ran each hook through its `commandWindows` launcher.

| Step | Result |
| --- | --- |
| `codex plugin marketplace add`, then `codex plugin add` | Pass |
| Installed files compared with the source commit (SHA-256) | Pass: 169 of 169 identical |
| Init: two entries, then a commit | Pass |
| Pick and export to the clipboard | Pass: the entry stays `planned` |
| Start, change, commit with a `Foreman:` trailer, evidence, close check | Pass: `awaiting_acceptance`, check complete |
| Acceptance, then archive and restore | Pass |
| Edit guard: `apply_patch` of `ROADMAP.jsonl` | Pass: denied with the `roadmap.js` route |
| Session notice with an open entry | Fail: the hook printed the notice, but the model did not receive it. Pass in a rerun with the fix described below: the model named the open entry |
| `codex plugin remove` | Pass: the plugin cache is removed; the hook trust entries stay in `config.toml` |

In the `workspace-write` sandbox on Windows, Codex could not write to `.git`,
so `git commit` failed. The init, start and acceptance sessions therefore ran
with `danger-full-access`; pick and export and the edit guard ran in
`workspace-write`.

In that build the session notice was plain text that starts with `[Foreman]`.
Codex reads hook output that starts with `[` or `{` as JSON and discards it
when it does not parse. Hooks that return JSON, such as the commit notice and
the edit guard, reached the model in the same sessions. Foreman now sends the
notice to Codex as JSON `additionalContext`. A rerun on 2026-09-26 with that
change, in the same Codex home and project, delivered the notice to the model
as a developer message, and the model named the open entry.

For comparison, the same package passed in headless Claude Code 2.1.283
sessions (`claude -p`). The installed files were 169 of 169 identical. Init,
pick and export, a commit with evidence, acceptance, archive and restore, the
edit guard, the session notice and uninstall all passed. Headless Claude Code
has no task tools, so the session opened the entry with `roadmap.js`, and the
`TaskCreated` and `TaskCompleted` hooks were not exercised.

### The Codex desktop app

Foreman 3.3.0 works in the Codex desktop app, with the gaps listed below. The
owner ran one full lifecycle on 2026-09-29 in the Codex app 26.924.51851, whose
bundled CLI is 0.158.0-alpha.2.1. The run used Windows 11, the app's default
permission mode, and a disposable project that was its own Git repository.

| Step | Result |
| --- | --- |
| Install `foreman@foundry` from the app's plugin UI | Pass |
| Hook trust | No prompt appeared. The trust entries from an earlier install stayed in `config.toml`, and Codex keys them on the plugin's hooks, not on the project |
| Init | Pass: one entry. The commit needed approval to leave the sandbox |
| Pick and copy to the clipboard | Pass: the question showed as clickable options, and `Set-Clipboard` copied the prompt |
| Execute the pasted prompt | Pass: `awaiting_acceptance`, close check complete, no commit |
| Acceptance, then archive | Pass: `done`, then moved to `.foreman/archive.jsonl` |

The app hands the model one code-mode tool, `exec`. The model's scripts call
`exec_command` for shell commands and `apply_patch` for file edits. Foreman's
hooks still fired. The session notice and the commit notice reached the model,
because Codex reports those shell commands to hooks as `Bash`.

Gaps in the default permission mode:

- **No automatic task commit.** `safe-commit.js begin` returned `dirty:true`
  with `git_status_unavailable`, although `git status` typed in the same
  sandbox worked. Foreman then leaves the task's changes uncommitted, so
  commit them yourself after acceptance. The cause is not known yet.
- **Git writes need approval.** An in-sandbox `git add` failed with
  `Unable to create '.git/index.lock': Permission denied`. The app asks for
  approval to run `git commit` outside the sandbox, as the CLI's
  `workspace-write` sandbox does.
- **Leftover prompt file.** The clipboard step wrote its temporary prompt file
  to the project root and left it there, untracked. Delete it before you
  execute, or the next step sees a dirty tree.

Not verified: a first install with no earlier trust entries, the full-access
permission mode, reviewed increments or background subagents in the app, and
the app on macOS.

The 2026-09-08 validation of reviewed increments — automated tests plus
controlled headless cases covering waiting, feedback, pause, recovery, final
acceptance, omissions and a failed required check — is recorded with its
limits in the maintainer's validation records, which are kept outside this
repository.
Separate ephemeral executions recovered from notes and files; this does not
establish Foreman's recovery through `codex exec resume` against a persisted
session. Continuing a paused session is described under
[Resume a paused review](#resume-a-paused-review).

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
That command lists only installed plugins under `installed`, and `available`
stays empty unless you add `--available`. An empty list before
`codex plugin add` therefore means nothing is installed yet, not that the
marketplace failed to load; `codex plugin list --marketplace foundry` shows
every plugin in the catalog with its status.
A fresh-session evaluation by the user is a separate step from installing the
package. To try the workflow from a source checkout without installing
anything, see
[trying reviewed increments from source](CONTRIBUTING.md#trying-reviewed-increments-from-source).
