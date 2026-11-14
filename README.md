# Foreman

**Your plan stays next to your code. The next task arrives with its context checked.**

Available on [Claude Code](#claude-code), the primary host, and on two compatibility hosts: [Codex](#codex) and [Antigravity](#antigravity).

[Get started](#install) · [What is this?](#what-is-this) · [How it works](#how-it-works) · [What you can do](#what-you-can-do) · [Evidence](#the-numbers)

## What is this?

You finish a session with a fix, a side request and an issue still waiting. Next time, you need to know which one comes first and why. Foreman keeps that context in a roadmap beside your code.

Ask "what's next?" and it recommends a task with its reason and a prompt checked against the project's files. Completed work brings evidence back into the plan; acceptance stays a separate decision.

## Why you'd want it

- Resume where the last session stopped.
- Keep the task, its reason and its constraints together.
- Check stale plans against the code before acting.
- Keep acceptance of finished work separate from a successful test run.

## How it works

Foreman keeps your plan in `ROADMAP.jsonl`, an ordinary text file in your project with one task per line. You can read it with Foreman switched off, keep it in version control and open it in any editor. Its settings and archive sit beside it in `.foreman/`.

Don't edit the roadmap by hand; tell Foreman what is wrong and it fixes the entry, checking the whole file before and after each write. A hook stops the assistant's file-editing tools from changing the file directly, but a shell command is not stopped on any host.

| Moment | What happens |
| --- | --- |
| You ask "what's next?" | Foreman sorts the roadmap: what is finished, what waits on something else, and what would put two jobs in the same files. It recommends one and writes the prompt. You still choose |
| You describe new work | It goes on the roadmap. Foreman asks first only when it looks like something already tracked |
| You commit | If a task looks finished, Foreman asks you to confirm. It also offers new work it noticed along the way, unless you switch that off |
| You start a new session | Foreman mentions tasks still in progress or waiting for your acceptance, and offers to archive finished entries once many have piled up |

### Two ways to get a task

- **Fast pick** is the default. Foreman sorts the roadmap it already has and recommends one task. It reads no code. Its own instructions still add roughly 9,000 to 11,000 tokens to the session, depending on the host.
- **Reconcile and pick** reads your code first, finds where the plan has gone stale, and offers you each fix before recommending anything. It does everything Fast pick does and reads code on top, so it always costs more. Foreman never starts it on its own; you have to ask.

### The prompt is checked before you see it

Foreman opens the files a task expects to touch before handing you a prompt. A moved or renamed file is caught here, a file the task will create is marked as new, a path outside your project is refused, and a name in the task that matches nothing in those files is flagged. Names are read from JavaScript, TypeScript, Python and Kotlin files; other types get the path checks alone, with a warning. The prompt itself is checked too, for a missing step or a verification command that cannot run. An investigation asks for findings with evidence, not fixes; a decision asks for a choice and its reason.

### Finished is not the same as accepted

A task whose work is committed and checked waits for you, marked `awaiting_acceptance`. Your yes closes it; "not ready" sends it back with what you said. Passing tests are evidence, not acceptance, and so is a background worker's report that it succeeded.

### Big tasks get split

A task with several separate checks can be handed off in pieces, each with its own check. Every finished piece is committed on a work branch, so nothing is lost if you stop halfway, and at the end you decide what happens to that branch. Only the last piece closes the roadmap entry. Foreman's commits carry only the task's own files, and a run that starts with uncommitted changes in your working tree makes no automated commits at all.

### Where a task can go

When a prompt is ready, Foreman asks where it should run: here, here split by check, with a background worker, or copied for another session. It recommends one from how full the session is, other work in flight, the number of checks and whether your tree is clean; the choice stays yours. In Codex and Antigravity, the session that sent a background worker checks its result and makes the roadmap changes itself.

### Task numbers in your history

Every commit Foreman makes ends with a line like `Foreman: 019`, so `git log` traces any change to its task. When a task names a function, the prompt lists the earlier tasks that changed it, as history, and a `[Foreman: 019]` comment next to code names the task that settled it.

### The roadmap pane

Claude Code only; Codex and Antigravity have no pane. It is made for the Claude Code desktop app; the terminal draws a plainer version of the same pane, which has not been tried in a live terminal. In a project that has a `ROADMAP.jsonl`, a **Roadmap** button joins the mode labels at the right of the prompt footer. It opens a side pane with the open tasks in four sections: in progress, ready, blocked and deferred. Press a task to see its card: its status, who made it and when, what it depended on, up to three planned files and its reason. A search box filters by number, title or reason. A project with no `ROADMAP.jsonl` shows no button.

The pane only reads the file; it never writes it. On a card, **Start**, **Resume** or **Accept** sends Foreman a plain request such as "Resume roadmap entry 12 with Foreman", sent as your next prompt, so the change still goes through Foreman. **To prompt** puts that sentence in the prompt box instead, ahead of anything you already typed, so you can add a hint before sending. The pane speaks Spanish when Claude Code's `language` setting names Spanish. A roadmap over 4 MiB is not shown; ask Foreman to archive the finished tasks.

### Review between increments

Codex only; Claude Code and Antigravity do not offer it. You can ask Foreman to run one roadmap task in increments, results you can look at and try, and wait for your decision after each one. Start a new Codex task after installing or updating, then ask plainly, for example: "Foreman, run this task here in increments and wait for my approval after each result." Only that explicit request turns it on, for that one run; it is not a setting.

After each increment, the session shows the result, its limits, the evidence and what to look at, then offers **Accept / Request changes / Pause** and waits for a real answer before any dependent work. Passing tests and time passing are not answers. With no person or coordinator to answer, the result stays pending and the run stops: a subagent returns its result to the session that sent it, and running in the background never supplies an answer. After two failed fix attempts the session reports and pauses. Accepting one increment keeps the task open; the usual close rules apply once every increment is done. Nothing is skipped automatically: a check you explicitly let go is recorded as `unverified:`, never as accepted, and stays open until later evidence for that same result resolves it; accepting another result does not clear it. Recovery after an interruption is assisted, not automatic: the session rereads the notes and the work, and asks again when they no longer agree.

A paused review can continue later from a new process with `codex exec resume <session id> -`, which reads your decision from standard input; end it with Ctrl+D in a POSIX shell or Ctrl+Z and Enter in PowerShell or cmd. To keep Codex's reply in a file, run `codex exec resume -o <file> <session id> -`; in one run, Git Bash's window closed right after Ctrl+D and the reply was not on screen. If you decline the command when a pick offers it, Foreman does not offer it again, and a session Codex no longer knows falls back to recovery from the notes and files.

## What you can do

| You want to | Outcome |
| --- | --- |
| Add work to the roadmap | Requested work recorded with its reason and boundaries |
| See where things stand | Status, blockers and work waiting for acceptance |
| Choose the next task | A recommended task and a choice of where to run it |
| Check whether the plan still matches the code | A grounded review before choosing work |
| Get a prompt for one-off work | A checked handoff without requiring a roadmap entry |

### How to ask

Plain sentences work in every assistant: "add this to the roadmap", "where are we?", "what's next?", "check whether the plan still matches the code" or "craft a prompt for this". If you would rather call Foreman by name, each assistant has its own way. In Codex, mention a skill with its plugin prefix, such as `$foreman:roadmap`, and Codex attaches that skill's instructions to your message. A bare `$roadmap` is not attached; Codex leaves it to the model to find the skill.

| You want to… | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- |
| Ask in your own words | `/foreman:foreman` | the `foreman` skill, or `$foreman:foreman` in a prompt | `/foreman` |
| Set up a roadmap for a project (once) | `/foreman:init` | the `init` skill, or `$foreman:init` in a prompt | `/init` |
| Pick, add, correct or review work | `/foreman:roadmap` | the `roadmap` skill, or `$foreman:roadmap` in a prompt | `/roadmap` |
| Check the plan against your code | `/foreman:survey` | the `survey` skill, or `$foreman:survey` in a prompt | `/survey` |
| Write a one-off prompt with no roadmap entry | `/foreman:craft-prompt` | the `craft-prompt` skill, or `$foreman:craft-prompt` in a prompt | `/craft-prompt` |

### Settings

Settings live in `.foreman/config.json`, one file for every host. Init writes it as `{}` and leaves an existing file alone, because every setting has a safe default; most projects never open it. A missing key means the default.

| Setting | Values | Effect |
| --- | --- | --- |
| `requireVerification` | `true` (default) or `false` | `true` holds a committed task at `awaiting_acceptance` until you confirm it; `false` closes it as soon as its commit lands. It never cancels reviews you asked for |
| `discoverySuggestions` | `true` (default) or `false` | Offers work Foreman noticed that the roadmap does not track, and asks before anything is added; [Differences between hosts](#differences-between-hosts) says when each host offers it. The roadmap is never pasted into the commit's context |
| `checkpoints` | An object with `baseBranch` (a branch name), `branch` (`true` or `false`) and `onFinish` (`ask`, `squash`, `merge`, `pr` or `keep`); absent by default | How a split run saves its work. A missing key reads as `branch` `true`, `onFinish` `ask` and a base branch detected from `origin/HEAD`, or `main`: on the base branch the run commits on a new `foreman/<slug>` branch, elsewhere on the current one, and at the end of the first split run Foreman asks what to do with the branch and writes your answer here. `branch: false` creates no branch and commits on the current one. Checkpoint commits stay local; existing branch restrictions still apply, and Foreman never picks a protected branch on its own |
| `usePersona` | `true` (default) or `false` | Whether handoff prompts open with a "You are a…" role sentence or plain domain framing. It never chooses the model |
| `omitSections` | A list of `tone`, `example`, `background`, `output_format`; default none | Prompt sections to leave out. The grounding and acceptance rules always stay, and so do a Codex or Antigravity prompt's host instructions |
| `taskCloseGate` | `"off"` (default) or `"block"` | What happens when a tracked task finishes with its entry still open: `"block"` asks for the entry to be closed first, in the way [Differences between hosts](#differences-between-hosts) describes for each host. An entry waiting for your acceptance is never held back |
| `delegatedAcceptance` | `{"orchestrator": "<name>", "sessions": ["<session id>", ...]}`; off by default | Hands acceptance to an orchestrator session that runs other sessions on the roadmap. The list holds the orchestrator's own session and each worker's, by the id each host gives its sessions: in Claude Code the transcript file's name without `.jsonl` (`CLAUDE_CODE_SESSION_ID`), in Codex `CODEX_SESSION_ID` or `CODEX_THREAD_ID`, in Antigravity `ANTIGRAVITY_CONVERSATION_ID`. A listed worker records its commit, moves the entry to `awaiting_acceptance` even with `requireVerification` off, and reports to the orchestrator instead of asking you; the orchestrator's own session closes entries and adds the work they found without asking. A handoff copied to the clipboard keeps the usual close, and unlisted sessions keep the usual prompts. The orchestrator writes the key when its run starts, adds each worker as it starts it and removes the key when the run ends, so you do not manage session ids by hand. `roadmap.js doctor` reports a malformed value |
| `trialLog` | `true` or `false` (default) | Keeps a local log of how Foreman is used, in `.foreman/trial-log.jsonl`. It records counts, booleans, menu ranks, dates without times and names from a closed list, never a task title, file path, entry id or anything you typed. It never leaves your machine, and you can delete it at any moment. From the project folder, `node <plugin>/scripts/health/roadmap-health.js --roadmap ROADMAP.jsonl --trial-log .foreman/trial-log.jsonl` and the same flags on `attention-cost.js`, where `<plugin>` is the installed plugin's folder, turn it into rates. The recommendation, question and interruption rates need at least 30 days and 20 recorded decisions, a recovery rate needs more than 10 attempts of one kind, and time to the first task is one sample per project; below that, only the raw counts mean anything |

Three switches live outside that file:

| Switch | Values | Effect |
| --- | --- | --- |
| `FOREMAN_PROJECT_DIR` environment variable | A folder | Names the project root, the folder that holds `ROADMAP.jsonl`, and wins over everything else. Without it, hooks use the project their host reports and a script you run uses the host's project variable or the current folder |
| `FOREMAN_HOST` environment variable | `claude`, `codex` or `antigravity` | Tells Foreman which host it runs in. Without it, Foreman reads each host's own environment variables, and a script run by hand in a terminal counts as Claude Code |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` environment variable, or `autoCompactWindow` in your Claude Code `settings.json` | 100000 to 1000000 tokens | The point your Claude Code session compacts at. With it, "How do you want to run this?" can steer a filling session to the clipboard; without it, the question says nothing about context |

If your file still has `ledger`, `decisionLog` or `areaNotes`, Foreman no longer reads them; keep them or delete them. When another plugin already sets the session persona and voice, `{"usePersona": false, "omitSections": ["tone", "output_format"]}` keeps Foreman out of those lanes.

## Install

Foreman is one plugin for the three assistants. Install it in the one you use; only the commands differ.

### Claude Code

Requirements: Node.js and Git 2.25 or later (tested with Node.js 22), and Claude Code 2.1.323 or later.

Inside Claude Code:

```text
/plugin marketplace add V-Songbird/foundry
/plugin install foreman@foundry
```

Start a new session to load the plugin. Run `/foreman:init` once in the project.

### Codex

Requirements: Node.js and Git 2.25 or later (tested with Node.js 22), and a Codex host with plugin support.

```text
codex plugin marketplace add V-Songbird/foundry
codex plugin add foreman@foundry
```

Review and trust its hooks with `/hooks`; Foreman's hooks do nothing until you do. Then start a new Codex session. `codex plugin list --marketplace foundry` shows the catalog's plugins and their status. Ask Foreman to initialize the project, or select its installed `init` skill. You can also type `$foreman:init` in a prompt.

### Antigravity

Requirements: Node.js and Git 2.25 or later (tested with Node.js 22), and the Antigravity CLI. Antigravity has no marketplace for third-party plugins, so install the `foreman` folder of a clone of the [foundry repository](https://github.com/V-Songbird/foundry), a submodule pinned at the current release. Do not install from a direct clone of the foreman repository: its branches can hold unreleased work. Replace `<path-to-foundry>` with the clone's directory:

```shell
git clone --recurse-submodules https://github.com/V-Songbird/foundry.git
agy plugin install "<path-to-foundry>/foreman"
agy plugin list
```

The list should name `foreman`. Start a new conversation, then run `/init` once in the project. The install is a copy of that checkout, so it changes only when you install again.

### Update

In Claude Code, refresh the catalog, update the plugin, then start a new session:

```text
/plugin marketplace update foundry
/plugin update foreman@foundry
```

In Codex, refresh the catalog, add the plugin again, then start a new session. If a release changed Foreman's hook registrations, those hooks stay off until you review and trust them again in `/hooks`.

```text
codex plugin marketplace upgrade
codex plugin add foreman@foundry
```

In Antigravity, update the clone, then replace the copy and start a new conversation:

```shell
git -C "<path-to-foundry>" pull
git -C "<path-to-foundry>" submodule update --init foreman
agy plugin uninstall foreman
agy plugin install "<path-to-foundry>/foreman"
```

## Good to know

Foreman is for a solo developer. It does not become a team tracker, code-review service, unattended scheduler or workflow server. Your project keeps its own data, and Foreman needs no server or account.

### Switching between assistants

Existing roadmap data can be reused. Every assistant reads and writes the same `ROADMAP.jsonl` and `.foreman/` files, so one project can move between them; keep the files as they are and do not reinitialize. An install older than the current release may not read entries another host wrote, so update it first.

### Differences between hosts

Each host offers Foreman different events and tools, so a few things work differently:

| | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- |
| Starting a tracked task | A hook opens the roadmap entry when Foreman's prompt becomes a task | The prompt opens the entry with an explicit start command | The same explicit start command |
| Reminder when a task ends with its entry still open (`taskCloseGate`) | Once per task, the first attempt to finish is stopped with instructions to close the entry; the retry passes | After an explicit check finds the entry still open, Foreman asks Codex for one more turn | Not available: Antigravity has no task or stop event Foreman can use |
| A new session's reminder of open entries | On startup and clear, not when a session resumes | The same | At the first model call of a conversation |
| Offering untracked work Foreman noticed | After a commit | After a commit, in every handoff and before reporting completion | After a commit, at the next model call, in every handoff and before reporting completion |
| Advice based on how full the session is | When your auto-compact window is set ([settings](#settings)) | Not available: Codex does not report it | Not available: Antigravity does not report it |
| Roadmap pane ([The roadmap pane](#the-roadmap-pane)) | A footer button, made for the desktop app | Not available | Not available |
| Model recorded when a task closes | Family name, such as `sonnet` | Exact model id | Exact model id |

A prompt carries the script paths of the assistant and install that crafted it, so craft it again in another assistant, or after reinstalling the plugin elsewhere; an Antigravity session gets the Codex form of the prompt, run with its own tools. A copied prompt's file stays in the project's `tmp/` folder when the copy fails or you ask for the file only; move it out or delete it before a task runs in the project, because an untracked file makes the tree look changed.

### Host limits

- **Claude Code.** Built and tested against Claude Code 2.1.x. Foreman cannot tell when a host stops sending an event it relies on; its automatic help just goes quiet. Asking `/foreman:roadmap` to check the roadmap lists the hook events Foreman depends on in each host, and every command keeps working by hand.
- **Codex.** In the Codex desktop app's default permission mode on Windows, Git writes need your approval to leave the sandbox, and on Windows the CLI's `workspace-write` sandbox cannot write to `.git` either. A subagent whose `task_name` is `foreman` or starts with `foreman_` is refused unless it is exactly `foreman_<id>` of an entry in `ROADMAP.jsonl`; a handoff spawned under another name runs, but its finish is not tied to its entry. Removing the plugin leaves its hook trust entries in Codex's `config.toml`.
- **Codex, what was checked.** Live runs used Codex CLI 0.157.1 on Windows 11. The resume runs used a short probe prompt. The one live run in the Codex app 26.924.51851, on Windows 11, used Foreman 3.3.0: it made no automatic task commit, because the app's sandbox refused Git with `spawnSync git EPERM`, and it did not show which shell tool name the app reports. The file fallback that later releases use for that refusal has not been run live in the app. Not verified: a full reviewed-increment handoff paused and resumed live; a model following that wording on its own; the close gate after a resumed subagent's finish; resume in the Codex app or TUI; a subagent spawned by another subagent, covered by tests only; a first app install with no earlier hook trust; the app's full-access permission mode; reviewed increments or background subagents in the app; the app on macOS; and Codex on Linux or macOS.
- **Antigravity.** Checked in live `agy` 1.2.9 sessions on Windows: `/init`, a `/roadmap` pick copied to the clipboard, a commit, and a direct write to `ROADMAP.jsonl`, which the host refused. Beyond those four actions, hook behavior rests on the host's documentation and the test suite. What Foreman says after a commit reaches only the model's next call; later calls no longer see it. Antigravity started from a Claude Code shell inherits `CLAUDECODE` and counts as Claude Code; remove it first, with `env -u CLAUDECODE agy` in Bash or `Remove-Item Env:CLAUDECODE` in PowerShell, or start `agy` with `FOREMAN_HOST=antigravity`, which then makes any Claude Code started inside that session count as Antigravity too.

### Ids a committed roadmap publishes

A paused Codex review writes its Codex session id into the entry's notes. The session id stays in the roadmap on purpose, so a later pick on the same machine can offer the resume command; it resumes something only under the `CODEX_HOME` directory of the machine that ran it. Still, when a project commits `ROADMAP.jsonl`, the commit publishes the id, along with the background agent and subagent ids that dispatch notes record, and a committed `.foreman/config.json` publishes the ids in `delegatedAcceptance`. A project that must not publish such ids keeps those files out of Git.

## The numbers

Each result belongs to the named model and recorded run. Measurements belong to the model and setup that produced them, so each host keeps its own table. Missing measurements remain marked as unmeasured.

### Claude Code results

<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Sonnet 5","Claude Opus 5"],"date":"2026-08-29","reviewedAt":"2026-10-12","revision":"not recorded","revisionReason":"No public record names the Foreman revision the 2026-08-29 run measured."} -->
| Model | Setup | Correct tasks | Mean session cost |
| --- | --- | --- | --- |
| Claude Sonnet 5 | Written task paragraph | 100% | $0.0757 |
| Claude Sonnet 5 | Foreman | 100% | $0.0820 |
| Claude Opus 5 | Written task paragraph | 100% | $0.1627 |
| Claude Opus 5 | Foreman | 100% | $0.1746 |

Measured on 2026-08-29 with Claude Sonnet 5 and Claude Opus 5, Foreman tied the well-written paragraph on correctness and cost more: 8.3% on Sonnet and 7.3% on Opus. The sample size was not recorded, and neither was the Foreman revision measured. These are historical comparisons, not a claim about the current release or another model.

*Results can vary between runs.*

### Codex results

<!-- foundry:evidence {"platform":"Codex","status":"pending","reason":"Functional Codex validation exists; equivalent paired performance measurements are not available."} -->
| Model | Setup | Correct tasks | Mean session cost |
| --- | --- | --- | --- |
| Not measured | Without plugin | Not measured | Not measured |
| Not measured | foreman | Not measured | Not measured |

Codex functional tests establish specific behaviors, not a speed, cost or correctness advantage over a baseline. Comparative performance remains unmeasured. No Claude Code result is presented as Codex evidence.

### Antigravity results

<!-- foundry:evidence {"platform":"Antigravity","status":"pending","reason":"No Antigravity performance measurements are available."} -->
| Model | Setup | Correct tasks | Mean session cost |
| --- | --- | --- | --- |
| Not measured | Not measured | Not measured | Not measured |

The benchmark instruments and research records behind the numbers are kept outside this repository and are not distributed with the plugin.

## What changed

Release notes for every version are on the [releases page](https://github.com/V-Songbird/foreman/releases).

## License

MIT — see [LICENSE](LICENSE).
