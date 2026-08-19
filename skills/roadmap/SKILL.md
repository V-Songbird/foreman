---
name: roadmap
description: Ongoing entry point for a project's ROADMAP.jsonl. Pick the next task to work on (ranks candidates deterministically by dependencies and file-touch collisions, shows why each is where it is, then crafts a self-contained handoff prompt), add a new task, correct a stale one, review roadmap status, or check the roadmap's structural health.
when_to_use: Trigger when the user asks what to work on next, wants to add something to the roadmap, wants to fix or reword an entry that already exists, wants to see roadmap status, thinks the roadmap file itself is broken, says "what's next", "pick a task", "add to the roadmap", "that task's description is wrong", "roadmap status", "my roadmap is broken", or invokes /foreman:roadmap.
argument-hint: "<optional — a task description to add, or a hint about what to pick next>"
allowed-tools: AskUserQuestion, Read, Write, Bash, PowerShell, TaskCreate, TaskUpdate, Agent, SendMessage
---

# foreman:roadmap — pick, add to, correct, review, or check the project roadmap

All reads/writes to `ROADMAP.jsonl` at the project root go through
`${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js` — never `Read`/`Edit` the file
directly, the script enforces id computation and parse-before/after-write
mechanically — run it with `--help` for the command shapes. Read the
**Fields** section of `${CLAUDE_PLUGIN_ROOT}/roadmap-schema.md` if you need
field semantics beyond what's obvious from the names.

**Pre-check**: if `ROADMAP.jsonl` doesn't exist at the project root, tell
the user to run `/foreman:init` first and stop here.

---

## Call 1 — menu

**Q1** — "What do you need?"
Options:
- `Pick the next task` — read the roadmap, reason about what to work on
  next, craft a handoff prompt for it.
- `Add a task` — append a new entry to the roadmap.
- `Correct a task` — fix a stale title, why, what, kind, or planned files
  on an entry that already exists.
- `Review status` — read-only summary of where every task stands.

`AskUserQuestion` takes four options at most, so the structural doctor is
reached by asking for it rather than from this menu — the routing just
below carries the phrasings that get there.

If args were provided and read like a task description rather than a
question, treat it as a seed for "Add a task" and skip this call. If they
read like a pick request or a hint about what to pick ("what's next on
auth", "something quick I can finish today"), go straight to "Pick the
next task" with the hint in hand — that branch says what to do with it.
If they name an entry that already exists and say what's wrong with it
("003's what is out of date", "retarget 007 at the proxy"), that's
"Correct a task". If they say the roadmap itself looks broken ("my
roadmap is broken", "is the roadmap file healthy"), go straight to
"Check the roadmap".

If they ask to clear out or archive finished work ("archive the finished
tasks", "get the done ones out of the way"), skip the menu: run `list
--status done,dropped,rejected --summary`, show those ids, and ask **one**
`AskUserQuestion` (`Archive them` / `Leave them`). On yes, `echo
'{"ids":["001","002"]}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js
archive` — one call, all the ids, nothing else moves. `restore` with the
same shape is the way back if one has to change again.

---

## Branch: Pick the next task

Read `${CLAUDE_PLUGIN_ROOT}/skills/roadmap/pick.md` and follow it.

---

## Branch: Add a task

Read `${CLAUDE_PLUGIN_ROOT}/skills/roadmap/add.md` and follow it.

---

## Branch: Correct a task

Read `${CLAUDE_PLUGIN_ROOT}/skills/roadmap/correct.md` and follow it.

---

## Branch: Review status

Read `${CLAUDE_PLUGIN_ROOT}/skills/roadmap/status.md` and follow it.

---

## Branch: Check the roadmap

Read `${CLAUDE_PLUGIN_ROOT}/skills/roadmap/doctor.md` and follow it.

---

<!-- [Foreman: 209] -->
## Trial log

This file's own `AskUserQuestion` calls — Call 1's menu and the
archive-finished-work ask — belong to the branch the user ends up in, not to
a branch of their own. Record each with that branch's flow:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js question_asked '{"flow":"pick"}'
```

`pick`, `add`, `correct`, `status` or `survey`, whichever the routing lands
on. The structural doctor has no flow and records nothing. One event per
call. It is a no-op unless the project set `trialLog`, so it needs no check
first and never blocks the flow.
