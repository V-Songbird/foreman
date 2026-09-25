---
name: roadmap
description: "Ongoing entry point for a project's ROADMAP.jsonl. Pick the next task to work on (ranks candidates deterministically by dependencies and file-touch collisions, shows why each is where it is, then crafts a self-contained handoff prompt), add a new task, correct a stale one, accept, resume, defer, archive, or restore work, review roadmap status, or check the roadmap's structural health."
when_to_use: "Trigger when the user asks what to work on next, wants to add something to the roadmap, wants to fix or reword an entry that already exists, wants to see roadmap status, thinks the roadmap file itself is broken, says \"what's next\", \"pick a task\", \"add to the roadmap\", \"that task's description is wrong\", \"roadmap status\", \"my roadmap is broken\", or invokes /foreman:roadmap."
argument-hint: "<optional — a task description to add, or a hint about what to pick next>"
allowed-tools: AskUserQuestion, Read, Write, Bash, PowerShell, TaskCreate, TaskUpdate, Agent, SendMessage
---

# foreman:roadmap — pick, add to, correct, review, or check the project roadmap

Foreman runs in Claude Code, Codex and Antigravity. Every step applies to every host unless it names one. Read [the shared runtime](../foreman/runtime.md) first: it covers plugin paths, JSON payloads, questions and authorization for every host.

All reads/writes to `ROADMAP.jsonl` at the project root go through
`${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js` — never read or edit the file
directly, the script enforces id computation and parse-before/after-write
mechanically — run it as `roadmap.js <subcommand> --help` (for example
`roadmap.js list --help`) for that subcommand's shape. Read the
**Fields** section of [roadmap-schema.md](../../roadmap-schema.md)
(`${CLAUDE_PLUGIN_ROOT}/roadmap-schema.md`) if you need field semantics beyond
what's obvious from the names.

**Pre-check**: if `ROADMAP.jsonl` doesn't exist at the project root, offer to
set the project up with [init](../init/SKILL.md) (`/foreman:init` in Claude
Code) and stop here. When the user's request already includes setup, run init
directly instead.

A request the `foreman` entrance routed here names its branch: go straight to
that branch below. A direct `/foreman:roadmap` call, or a request handed over
without a branch, reads [menu.md](menu.md)
(`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/menu.md`) first: it holds the menu, the
phrasings that pick a branch without it, requests to archive or restore
finished work, and how its questions are logged.

---

## Branch: Pick the next task

Read [pick.md](pick.md) (`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/pick.md`) and follow it.

---

## Branch: Add a task

Read [add.md](add.md) (`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/add.md`) and follow it.

---

## Branch: Correct a task

Read [correct.md](correct.md) (`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/correct.md`) and follow it.

---

## Branch: Review status

Read [status.md](status.md) (`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/status.md`) and follow it.

---

## Branch: Check the roadmap

Read [doctor.md](doctor.md) (`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/doctor.md`) and follow it.

