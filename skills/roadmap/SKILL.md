---
name: roadmap
description: "Ongoing entry point for a project's ROADMAP.jsonl. Pick the next task to work on (ranks candidates deterministically by dependencies and file-touch collisions, shows why each is where it is, then crafts a self-contained handoff prompt), add a new task, correct a stale one, accept, resume, defer, archive, or restore work, review roadmap status, or check the roadmap's structural health."
when_to_use: "Trigger when the user asks what to work on next, wants to add something to the roadmap, wants to fix or reword an entry that already exists, wants to see roadmap status, thinks the roadmap file itself is broken, says \"what's next\", \"pick a task\", \"add to the roadmap\", \"that task's description is wrong\", \"roadmap status\", \"my roadmap is broken\", or invokes /foreman:roadmap."
argument-hint: "<optional — a task description to add, or a hint about what to pick next>"
allowed-tools: AskUserQuestion, Read, Write, Bash, PowerShell, TaskCreate, TaskUpdate, Agent, SendMessage
---

# foreman:roadmap — pick, add to, correct, review, or check the project roadmap

Foreman runs in Claude Code and in Codex. Every step applies to both unless it names a host. Read [the shared runtime](../foreman/runtime.md) first: it covers plugin paths, JSON payloads, questions and authorization for both hosts.

All reads/writes to `ROADMAP.jsonl` at the project root go through
`${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js` — never read or edit the file
directly, the script enforces id computation and parse-before/after-write
mechanically — run it with `--help` for the command shapes. Read the
**Fields** section of [roadmap-schema.md](../../roadmap-schema.md)
(`${CLAUDE_PLUGIN_ROOT}/roadmap-schema.md`) if you need field semantics beyond
what's obvious from the names.

**Pre-check**: if `ROADMAP.jsonl` doesn't exist at the project root, offer to
set the project up with [init](../init/SKILL.md) (`/foreman:init` in Claude
Code) and stop here. When the user's request already includes setup, run init
directly instead.

---

## Call 1 — menu

**Q1** — "What do you need?" — `AskUserQuestion` in Claude Code, the picker in
[questions.md](../foreman/questions.md) in Codex.
Options:
- `Pick the next task` — read the roadmap, reason about what to work on
  next, craft a handoff prompt for it.
- `Add a task` — append a new entry to the roadmap.
- `Correct a task` — fix a stale title, why, what, kind, or planned files
  on an entry that already exists.
- `Review status` — read-only summary of where every task stands.

The menu holds four options because `AskUserQuestion` takes four at most, so
the structural doctor is reached by asking for it rather than from this menu —
the routing just below carries the phrasings that get there.

Skip this call whenever the request already says what the user needs. If args
were provided and read like a task description rather than a question, treat it
as a seed for "Add a task". If they read like a pick request or a hint about
what to pick ("what's next on auth", "something quick I can finish today"), go
straight to "Pick the next task" with the hint in hand — that branch says what
to do with it. If they name an entry that already exists and say what's wrong
with it ("003's what is out of date", "retarget 007 at the proxy"), that's
"Correct a task". If they say the roadmap itself looks broken ("my roadmap is
broken", "is the roadmap file healthy"), go straight to "Check the roadmap".

If they ask to clear out or archive finished work ("archive the finished
tasks", "get the done ones out of the way"), skip the menu: run `list
--status done,dropped,rejected --summary` and resolve the ids they mean. An
explicit request for all finished work authorizes that listed set — archive it
and report which ids moved. When the intended subset is ambiguous, show those
ids and ask **one** question (`Archive them` / `Leave them`). Archive with
`echo '{"ids":["001","002"]}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js
archive` — one call, all the ids, nothing else moves. Only terminal entries
archive; archiving preserves history and dependency resolution, and never
reuses ids. `restore` with the same shape is the way back if one has to change
again; `list --archived --summary` finds it.

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

---

<!-- [Foreman: 209] -->
## Trial log

This file's own questions — Call 1's menu and the archive-finished-work ask —
belong to the branch the user ends up in, not to a branch of their own. Record
each one the user actually saw with that branch's flow:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js question_asked '{"flow":"pick"}'
```

`pick`, `add`, `correct`, `status` or `survey`, whichever the routing lands
on. The structural doctor has no flow and records nothing. One event per
question interaction, as the runtime defines it. It is a no-op unless the
project set `trialLog`, so it needs no check first and never blocks the flow.
