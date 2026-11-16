---
type: knowledge
summary: "Every switch a Foreman user can set: the keys of .foreman/config.json, the three environment variables, the keys Foreman no longer reads and the persona advice; read before adding, renaming or documenting a setting."
related_files:
  - README.md
  - roadmap-schema.md
  - scripts/health/roadmap-health.js
  - scripts/health/attention-cost.js
---

# Foreman settings

This page lists everything you can set in Foreman. Most projects never open the settings file. The short form is in the README, under [Settings](../../README.md#settings).

## Contents

- [The settings file](#the-settings-file)
- [Environment variables](#environment-variables)
- [Keys Foreman no longer reads](#keys-foreman-no-longer-reads)
- [Staying out of another plugin's lanes](#staying-out-of-another-plugins-lanes)

## The settings file

Settings live in `.foreman/config.json`, one file for every host. Init writes it as `{}` and leaves an existing file alone, because every setting has a safe default. A missing key means the default.

| Setting | Values | Effect |
| --- | --- | --- |
| `requireVerification` | `true` (default) or `false` | `true` holds a committed task at `awaiting_acceptance` until you confirm it; `false` closes it as soon as its commit lands. It never cancels reviews you asked for |
| `discoverySuggestions` | `true` (default) or `false` | Offers work Foreman noticed that the roadmap does not track, and asks before anything is added; [Differences between hosts](limits.md#differences-between-hosts) says when each host offers it. The roadmap is never pasted into the commit's context |
| `checkpoints` | An object with `baseBranch` (a branch name), `branch` (`true` or `false`) and `onFinish` (`ask`, `squash`, `merge`, `pr` or `keep`); absent by default | How a split run saves its work. A missing key reads as `branch` `true`, `onFinish` `ask` and a base branch detected from `origin/HEAD`, or `main`: on the base branch the run commits on a new `foreman/<slug>` branch, elsewhere on the current one, and at the end of the first split run Foreman asks what to do with the branch and writes your answer here. `branch: false` creates no branch and commits on the current one. Checkpoint commits stay local; existing branch restrictions still apply, and Foreman never picks a protected branch on its own |
| `usePersona` | `true` (default) or `false` | Whether handoff prompts open with a "You are a…" role sentence or plain domain framing. It never chooses the model |
| `omitSections` | A list of `tone`, `example`, `background`, `output_format`; default none | Prompt sections to leave out. The grounding and acceptance rules always stay, and so do a Codex or Antigravity prompt's host instructions |
| `taskCloseGate` | `"off"` (default) or `"block"` | What happens when a tracked task finishes with its entry still open: `"block"` asks for the entry to be closed first, in the way [Differences between hosts](limits.md#differences-between-hosts) describes for each host. An entry waiting for your acceptance is never held back |
| `delegatedAcceptance` | `{"orchestrator": "<name>", "sessions": ["<session id>", ...]}`; off by default | Hands acceptance to an orchestrator session that runs other sessions on the roadmap. The list holds the orchestrator's own session and each worker's, by the id each host gives its sessions: in Claude Code the transcript file's name without `.jsonl` (`CLAUDE_CODE_SESSION_ID`), in Codex `CODEX_SESSION_ID` or `CODEX_THREAD_ID`, in Antigravity `ANTIGRAVITY_CONVERSATION_ID`. A listed worker records its commit, moves the entry to `awaiting_acceptance` even with `requireVerification` off, and reports to the orchestrator instead of asking you; the orchestrator's own session closes entries and adds the work they found without asking. A handoff copied to the clipboard keeps the usual close, and unlisted sessions keep the usual prompts. The orchestrator writes the key when its run starts, adds each worker as it starts it and removes the key when the run ends, so you do not manage session ids by hand. `roadmap.js doctor` reports a malformed value |
| `trialLog` | `true` or `false` (default) | Keeps a local log of how Foreman is used, in `.foreman/trial-log.jsonl`. It records counts, booleans, menu ranks, dates without times and names from a closed list, never a task title, file path, entry id or anything you typed. It never leaves your machine, and you can delete it at any moment. From the project folder, `node <plugin>/scripts/health/roadmap-health.js --roadmap ROADMAP.jsonl --trial-log .foreman/trial-log.jsonl` and the same flags on `attention-cost.js`, where `<plugin>` is the installed plugin's folder, turn it into rates. The recommendation, question and interruption rates need at least 30 days and 20 recorded decisions, a recovery rate needs more than 10 attempts of one kind, and time to the first task is one sample per project; below that, only the raw counts mean anything |

## Environment variables

Three switches live outside the settings file:

| Switch | Values | Effect |
| --- | --- | --- |
| `FOREMAN_PROJECT_DIR` environment variable | A folder | Names the project root, the folder that holds `ROADMAP.jsonl`, and wins over everything else. Without it, hooks use the project their host reports and a script you run uses the host's project variable or the current folder |
| `FOREMAN_HOST` environment variable | `claude`, `codex` or `antigravity` | Tells Foreman which host it runs in. Without it, Foreman reads each host's own environment variables, and a script run by hand in a terminal counts as Claude Code |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` environment variable, or `autoCompactWindow` in your Claude Code `settings.json` | 100000 to 1000000 tokens | The point your Claude Code session compacts at. With it, "How do you want to run this?" can steer a filling session to the clipboard; without it, the question says nothing about context |

## Keys Foreman no longer reads

If your file still has `ledger`, `decisionLog` or `areaNotes`, Foreman no longer reads them. Keep them or delete them.

## Staying out of another plugin's lanes

When another plugin already sets the session persona and voice, this setting keeps Foreman out of those lanes:

```json
{"usePersona": false, "omitSections": ["tone", "output_format"]}
```
