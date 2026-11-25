---
type: knowledge
summary: "Every current limit of Foreman in full: hand edits, the cost of a pick, moving between assistants, copied prompts, how Claude Code, Codex and Antigravity differ, and what was checked live on each host; read before relying on Foreman's automatic help on a host, and before changing a hook."
related_files:
  - README.md
  - docs/knowledge/how-it-works.md
---

# Foreman limits

This page states each limit of Foreman in full. The README names each one in a line, under [Good to know](../../README.md#good-to-know).

Foreman is for a solo developer. It is no team tracker, code-review service, unattended scheduler or workflow server.

## General limits

| Limit | What it means |
| --- | --- |
| Built for one developer | Foreman is no team tracker, code-review service, unattended scheduler or workflow server. Your project keeps its own data, and Foreman needs no server or account |
| Antigravity installs | Install only from a Foundry copy. A direct clone of the Foreman repository can hold unreleased work. The install is a copy, so it changes only when you install again |
| Hand edits | A hook stops the assistant's file-editing tools from changing `ROADMAP.jsonl` directly. A shell command is not stopped on any host |
| Cost of a pick | **Fast pick**, the default, reads no code, but Foreman's own instructions still add roughly 10,000 to 16,000 tokens to the session. The low end is Claude Code when you already said how to run the work; the high end is Codex. **Reconcile and pick** reads your code first, so it always costs more; Foreman never starts it on its own |
| Switching between assistants | Every assistant reads and writes the same `ROADMAP.jsonl` and `.foreman/` files, so one project can move between them. Keep the files as they are and do not reinitialize |
| Copied prompts | A prompt carries the script paths of the assistant and install that crafted it. Craft it again in another assistant, or after reinstalling the plugin elsewhere. An Antigravity session gets the Codex form of the prompt, run with its own tools |
| Prompt file left behind | A copied prompt's file stays in the project's `tmp/` folder when the copy fails or you ask for the file only. Move it out or delete it before a task runs in the project, because an untracked file makes the tree look changed |

## Differences between hosts

Each host offers Foreman different events and tools, so a few things work differently:

| | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- |
| Starting a tracked task | A hook opens the roadmap entry when Foreman's prompt becomes a task | The prompt opens the entry with an explicit start command | The same explicit start command |
| Reminder when a task ends with its entry still open (`taskCloseGate`) | Once per task, the first attempt to finish is stopped with instructions to close the entry; the retry passes | After an explicit check finds the entry still open, Foreman asks Codex for one more turn | Not available: Antigravity has no task or stop event Foreman can use |
| A new session's reminder of open entries | On startup and clear, not when a session resumes | The same | At the first model call of a conversation |
| Offering untracked work Foreman noticed | After a commit | After a commit, in every handoff and before reporting completion | After a commit, at the next model call, in every handoff and before reporting completion |
| Advice based on how full the session is | When your auto-compact window is set ([settings](settings.md#environment-variables)) | Not available: Codex does not report it | Not available: Antigravity does not report it |
| Roadmap pane ([The roadmap pane](how-it-works.md#the-roadmap-pane)) | A footer button in the terminal and the desktop app | Not available | Not available |
| Model recorded when a task closes | Family name, such as `sonnet` | Exact model id | Exact model id |

## Host limits

| Host | Limit |
| --- | --- |
| Claude Code | Built and tested against Claude Code 2.1.x. Foreman cannot tell when a host stops sending an event it relies on; its automatic help just goes quiet. Asking `/foreman:roadmap` to check the roadmap lists the hook events Foreman depends on in each host, and every command keeps working by hand |
| Codex | In the Codex desktop app's default permission mode on Windows, Git writes need your approval to leave the sandbox, and on Windows the CLI's `workspace-write` sandbox cannot write to `.git` either. A subagent whose `task_name` is `foreman` or starts with `foreman_` is refused unless it is exactly `foreman_<id>` of an entry in `ROADMAP.jsonl`; a handoff spawned under another name runs, but its finish is not tied to its entry. Removing the plugin leaves its hook trust entries in Codex's `config.toml` |
| Codex, what was checked | Live runs used Codex CLI 0.157.1 on Windows 11. The resume runs used a short probe prompt. The one live run in the Codex app 26.924.51851, on Windows 11, made no automatic task commit, because the app's sandbox refused Git with `spawnSync git EPERM`. Foreman's file fallback for that refusal has not been run live in the app. Not verified: a full reviewed-increment handoff paused and resumed live; a model following that wording on its own; the close gate after a resumed subagent's finish; resume in the Codex app or TUI; a subagent spawned by another subagent, covered by tests only; a first app install with no earlier hook trust; the app's full-access permission mode; reviewed increments or background subagents in the app; the app on macOS; and Codex on Linux or macOS |
| Antigravity | Checked in live `agy` 1.2.9 sessions on Windows: `/init`, a `/roadmap` pick copied to the clipboard, a commit, and a direct write to `ROADMAP.jsonl`, which the host refused. Beyond those four actions, hook behavior rests on the host's documentation and the test suite. What Foreman says after a commit reaches only the model's next call; later calls no longer see it. Antigravity started from a Claude Code shell inherits `CLAUDECODE` and counts as Claude Code. Remove it first, with `env -u CLAUDECODE agy` in Bash or `Remove-Item Env:CLAUDECODE` in PowerShell, or start `agy` with `FOREMAN_HOST=antigravity`, which then makes any Claude Code started inside that session count as Antigravity too |
