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

Don't edit the roadmap by hand; tell Foreman what is wrong and it fixes the entry. Every change goes through one small script that checks ids and dependencies, lets one change run at a time, refuses a correction written against an older copy of the entry, and checks the whole file before and after writing. A hook stops the assistant's file-editing tools from changing the file directly. A shell command is not stopped on any host, which is one more reason to ask Foreman instead.

| Moment | What happens |
| --- | --- |
| You ask "what's next?" | Foreman sorts the roadmap: what is finished, what waits on something else, and what would put two jobs in the same files. It recommends one and writes the prompt. You still choose |
| You describe new work | It goes on the roadmap. Foreman asks first only when it looks like something already tracked |
| You commit | If a task looks finished, Foreman asks you to confirm. It also offers new work it noticed along the way, unless you switch that off |
| Work is about to be reported as finished | In Codex and Antigravity, Foreman first offers anything untracked it noticed, even after an investigation that committed nothing |
| You think the plan has gone stale | It reads the code, finds what no longer matches, and offers you each fix |
| You start a new session | Foreman mentions tasks still in progress or waiting for your acceptance, and offers to archive finished entries once many have piled up |

### Two ways to get a task

- **Fast pick** is the default. Foreman sorts the roadmap it already has and recommends one task. It reads no code. Its own instructions still add roughly 9,000 to 11,000 tokens to the session, depending on the host.
- **Reconcile and pick** reads your code first, finds where the plan has gone stale, and offers you each fix before recommending anything. It does everything Fast pick does and reads code on top, so it always costs more. Foreman never starts it on its own; you have to ask.

### The prompt is checked before you see it

A task names the files it expects to touch, and Foreman opens them before handing you a prompt. A file that moved or was renamed is caught here, not by whoever does the work. A file the task will create is expected to be missing, and the prompt says so. A path outside your project is refused. A name in the task description that matches nothing in those files is flagged, so an invented function name does not travel into the work. Names are read from JavaScript, TypeScript, Python and Kotlin files; other file types get the path checks alone, with a warning.

The same check runs over the prompt itself: a missing step, or a verification command that cannot run, is caught before delivery. The prompt also says what kind of work it is. An investigation asks for findings with evidence, and a failing check is something to report, not to fix. A decision asks for a choice and the reason it wins.

### Finished is not the same as accepted

A task whose work is committed and checked waits for you, marked `awaiting_acceptance`. Your yes closes it; "not ready" sends it back with what you said. Passing tests are evidence, not acceptance, and so is a background worker's report that it succeeded. The `requireVerification` setting turns this hold off.

### Big tasks get split

A task with several separate checks can be handed off in pieces, each with its own check. Every finished piece is committed on a work branch, so nothing is lost if you stop halfway, and at the end you decide what happens to that branch. Only the last piece closes the roadmap entry. Foreman's commits carry only the task's own files, and a run that starts with uncommitted changes in your working tree makes no automated commits at all.

### Where a task can go

When a prompt is ready, Foreman asks where it should run: here in this session, here split by check, with a background worker, or copied so you can paste it into another session. It recommends one based on how full the session is, whether other work is in flight, how many checks the task has, and whether your working tree is clean. A poor fit is marked, never hidden; the choice stays yours. A Codex or Antigravity background worker is a subagent with a bounded job, and the session that sent it checks what comes back and makes the roadmap changes itself.

### Task numbers in your history

Every commit Foreman makes ends with a line like `Foreman: 019`, the task number, so plain `git log` traces any change back to its job. Foreman reads those lines back: when a task names a function, the prompt says which earlier tasks created and changed it, offered as history, not instructions. A `[Foreman: 019]` comment next to code tells anyone handed work on that file which task settled it.

### Review between increments

Codex only; Claude Code and Antigravity do not offer it. In Codex you can ask Foreman to run one roadmap task in increments, results you can look at and try, and wait for your decision after each one. Start a new Codex task after installing or updating, then ask plainly, for example: "Foreman, run this task here in increments and wait for my approval after each result." Only an explicit request turns it on, for that one run.

After each increment, the session shows the result, its limits, the evidence and what to look at, then offers **Accept / Request changes / Pause** and waits for a real answer before any dependent work. Passing tests and time passing are not answers. After two failed fix attempts it reports and pauses. Accepting one increment keeps the task open; the usual close rules apply once every increment is done. Decisions are written to the entry's notes, and a check you explicitly skip is recorded as `unverified:`, never as `accepted:`. Recovery after an interruption is assisted, not automatic: the session rereads the notes and the work, and asks again when they no longer agree.

A paused review can continue later from a new process with `codex exec resume <session id> -`. The `-` makes Codex read your decision from standard input; end it with Ctrl+D in a POSIX shell or Ctrl+Z and Enter in PowerShell or cmd. Add `-o <file>` to keep Codex's reply.

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
| `checkpoints` | `{"baseBranch": "<branch>", "branch": true, "onFinish": "ask"}`; `onFinish` is `ask`, `squash`, `merge`, `pr` or `keep` | How a split run saves its work. By default it commits on a `foreman/<slug>` branch and asks once, at the end of the first split run, what to do with it; your answer is written here. Checkpoint commits stay local, and Foreman never picks a protected branch on its own |
| `usePersona` | `true` (default) or `false` | Whether handoff prompts open with a "You are a…" role sentence or plain domain framing. It never chooses the model |
| `omitSections` | A list of `tone`, `example`, `background`, `output_format`; default none | Prompt sections to leave out. The grounding and acceptance rules always stay, and so does the block that points a Codex or Antigravity session at its host instructions |
| `taskCloseGate` | `"off"` (default) or `"block"` | What happens when a tracked task finishes with its entry still open: `"block"` asks for the entry to be closed first, in the way [Differences between hosts](#differences-between-hosts) describes for each host. An entry waiting for your acceptance is never held back |
| `delegatedAcceptance` | `{"orchestrator": "<name>", "sessions": ["<session id>", ...]}`; off by default | Hands acceptance to an orchestrator session that runs other sessions on the roadmap. A listed session records its commit, moves the entry to `awaiting_acceptance` even with `requireVerification` off, and reports to the orchestrator instead of asking you. Every unlisted session keeps the usual prompts. The orchestrator writes the key when its run starts and removes it when the run ends |
| `trialLog` | `true` or `false` (default) | Keeps a local log of how Foreman is used, in `.foreman/trial-log.jsonl`, so its health numbers can be measured. It records counts, booleans, ranks, elapsed seconds, dates without times and names from a closed list, never a task title, file path, entry id or anything you typed. It never leaves your machine, and you can delete it at any moment |

Three switches live outside that file:

| Switch | Values | Effect |
| --- | --- | --- |
| `FOREMAN_PROJECT_DIR` environment variable | A folder | Names the project root, the folder that holds `ROADMAP.jsonl`, and wins over everything else. Without it, scripts use `CODEX_CWD`, then `CLAUDE_PROJECT_DIR`, then the current directory, and hooks use the project their host reports |
| `FOREMAN_HOST` environment variable | `claude`, `codex` or `antigravity` | Tells Foreman which host it runs in. Without it, Codex's markers mean Codex, `CLAUDECODE` means Claude Code, Antigravity's markers mean Antigravity, and anything else, a script run by hand included, counts as Claude Code |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` environment variable, or `autoCompactWindow` in your Claude Code `settings.json` | 100000 to 1000000 tokens | The point your Claude Code session compacts at. With it, "How do you want to run this?" can steer a filling session to the clipboard; without it, the question says nothing about context |

Two notes. `reviewEachIncrement` is not a setting: the prompt builder receives it only for a run where you ask to approve each result, so do not put it in the file. And if your file still has `ledger`, `decisionLog` or `areaNotes`, Foreman no longer reads them; keep them or delete them. When another plugin already sets the session persona and voice, `{"usePersona": false, "omitSections": ["tone", "output_format"]}` keeps Foreman out of those lanes.

## Install

Foreman is one plugin for the three assistants. Install it in the one you use; only the commands differ.

### Claude Code

Requirements: Node.js and Git 2.25 or later (tested with Node.js 22). In Claude Code, Foreman needs version 2.1.323 or later.

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

Review and trust its hooks with `/hooks`, then start a new Codex session. Ask Foreman to initialize the project, or select its installed `init` skill. You can also type `$foreman:init` in a prompt.

### Antigravity

Requirements: Node.js and Git 2.25 or later (tested with Node.js 22), and the Antigravity CLI. Antigravity has no marketplace for third-party plugins, so install from a clone of the [foundry repository](https://github.com/V-Songbird/foundry). Its `foreman` folder is a submodule checked out at the commit Foundry pins for the current release. Clone it with its submodules, then install that folder. Replace `<path-to-foundry>` with the clone's directory:

```shell
git clone --recurse-submodules https://github.com/V-Songbird/foundry.git
agy plugin install "<path-to-foundry>/foreman"
agy plugin list
```

The list should name `foreman`. Start a new conversation to load the plugin, then run `/init` once in the project. The install is a copy of that checkout, so install from the pinned commit, not from a clone of this repository, whose branches can hold unreleased work.

### Update

In Claude Code, refresh the catalog, update the plugin, then start a new session:

```text
/plugin marketplace update foundry
/plugin update foreman@foundry
```

In Codex, refresh the catalog, add the plugin again, then start a new session. If a release changed Foreman's hook registrations, those hooks stay off until you review and trust them again in `/hooks`.

```text
codex plugin marketplace upgrade foundry
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

Existing roadmap data can be reused. Every assistant reads and writes the same `ROADMAP.jsonl` and `.foreman/` files, so one project can move between them; keep the files as they are and do not reinitialize. Claude Code needs Foreman 2.7.0 or later to read entries that Codex wrote, and 3.2.0 or later for entries Antigravity wrote.

### Differences between hosts

Foreman does the same job in every assistant. The host — the assistant Foreman runs inside — decides which events and tools Foreman can use, so a few things work differently:

| | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- |
| Starting a tracked task | A hook opens the roadmap entry when Foreman's prompt becomes a task | The prompt opens the entry with an explicit start command | The same explicit start command |
| Reminder when a task ends with its entry still open (`taskCloseGate`) | Once per task, the first attempt to finish is stopped with instructions to close the entry; the retry passes | After an explicit check finds the entry still open, Foreman asks Codex for one more turn | Not available: Antigravity has no task or stop event Foreman can use |
| Direct edits of the roadmap file are blocked for | `Edit` and `Write` | `apply_patch`, `Edit` and `Write` | `write_to_file`, `replace_file_content` and `multi_replace_file_content` |
| Offering untracked work Foreman noticed | After a commit | After a commit, in every handoff and before reporting completion | After a commit, at the next model call, in every handoff and before reporting completion |
| Advice based on how full the session is | When your auto-compact window is set ([settings](#settings)) | Not available: Codex does not report it | Not available: Antigravity does not report it |
| Stopping for your approval after each result of a task | Not offered: reviewed increments are Codex only | On explicit request | Not offered: reviewed increments are Codex only |
| Model recorded when a task closes | Family name, such as `sonnet` | Exact model id | Exact model id |

A prompt copied out of one assistant carries that assistant's script paths, so craft it again in the other; an Antigravity session gets the Codex form of the prompt, run with its own tools.

### Host limits

- **Claude Code.** Built and tested against Claude Code 2.1.x. Foreman cannot tell when a host stops sending an event it relies on; its automatic help just goes quiet. Asking `/foreman:roadmap` to check the roadmap lists the hook events Foreman depends on in each host, and every command keeps working by hand.
- **Codex.** Hooks run only after you trust them with `/hooks`. In the Codex desktop app's default permission mode on Windows, Git writes need your approval to leave the sandbox, and on Windows the CLI's `workspace-write` sandbox cannot write to `.git` either. The Codex side was last checked live with Codex CLI 0.157.1 on Windows 11 and the Codex app 26.924.51851; not checked: the app on macOS, reviewed increments or background subagents in the app, and Linux or macOS for a resumed review.
- **Antigravity.** Checked in live `agy` 1.2.9 sessions on Windows: `/init`, a `/roadmap` pick copied to the clipboard, a commit, and a direct write to `ROADMAP.jsonl`, which the host refused. Antigravity started from a Claude Code shell inherits `CLAUDECODE` and counts as Claude Code; remove it first, with `env -u CLAUDECODE agy` in Bash or `Remove-Item Env:CLAUDECODE` in PowerShell, or start `agy` with `FOREMAN_HOST=antigravity`.

### Ids a committed roadmap publishes

A paused Codex review adds `Codex session <session id>` to the entry's notes. The session id stays in the roadmap on purpose, so a later pick on the same machine can offer the resume command. Codex keeps that conversation under the `CODEX_HOME` directory of the machine that ran it, so elsewhere the id resumes nothing. It is still a local identifier: when a project commits `ROADMAP.jsonl`, the commit publishes the id in the project's history, along with the background agent and subagent ids that dispatch notes record. The session ids in `delegatedAcceptance` are published the same way when `.foreman/config.json` is committed. A project that must not publish such ids keeps those files out of Git.

## The numbers

Each result belongs to the named model and recorded run. Measurements belong to the model and setup that produced them, so each host keeps its own table. Missing measurements remain marked as unmeasured.

### Claude Code results

<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Sonnet 5","Claude Opus 5"],"date":"2026-08-29","reviewedAt":"2026-10-12"} -->
| Model | Setup | Correct tasks | Mean session cost |
| --- | --- | --- | --- |
| Claude Sonnet 5 | Written task paragraph | 100% | $0.0757 |
| Claude Sonnet 5 | Foreman | 100% | $0.0820 |
| Claude Opus 5 | Written task paragraph | 100% | $0.1627 |
| Claude Opus 5 | Foreman | 100% | $0.1746 |

Measured on 2026-08-29 with Claude Sonnet 5 and Claude Opus 5, Foreman tied the well-written paragraph on correctness and cost more: 8.3% on Sonnet and 7.3% on Opus. These are historical comparisons, not a claim about the current release or another model.

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
