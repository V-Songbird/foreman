---
name: foreman
description: "The one entrance to Foreman, which keeps a project's plan and task history. Say what you want in plain language and this routes it to one of the six things Foreman does to a project: add work, show status, correct work, check the roadmap, pick work, or reconcile and pick. It owns no flow of its own. Use for Foreman or roadmap requests, not ordinary implementation work."
when_to_use: "Trigger on any plain-language Foreman request that does not already name a command — \"what should I work on\", \"add this to the roadmap\", \"where does the project stand\", \"that entry's description is wrong\", \"my roadmap is broken\", \"is the roadmap file healthy\", \"check the roadmap's still right and then give me something\", \"foreman\" on its own, or invokes /foreman:foreman. Skip it when the user named the specialized skill they want (/foreman:roadmap, /foreman:survey, /foreman:init, /foreman:craft-prompt) — go straight there."
argument-hint: "<what you want, in plain language>"
allowed-tools: AskUserQuestion, Skill, Read
---

# foreman — the one entrance

Foreman runs in Claude Code and in Codex. Every step applies to both unless it names a host. Read [the shared runtime](runtime.md) first: it covers plugin paths, JSON payloads, questions and authorization for both hosts.

This skill routes. It does not add, pick, correct, or survey anything
itself, and it never reads or writes `ROADMAP.jsonl`. Every step
of every flow lives in the skill that owns it; duplicating any of it here
would give Foreman two versions of the same truth. Classify the request,
say in one short line which flow is taking it, then hand off and let that
skill run from its own first step.

## The six intents

| The user says something like… | Intent | Route to |
| --- | --- | --- |
| "add this", "put X on the roadmap", "we also need to…", "track this for later" | **add work** | `foreman:roadmap` → "Branch: Add a task" ([add.md](../roadmap/add.md)) |
| "where are we", "roadmap status", "what's left", "what's waiting on me" | **show status** | `foreman:roadmap` → "Branch: Review status" ([status.md](../roadmap/status.md)) |
| "that entry is wrong", "reword 003", "retarget 007 at the proxy", "its description is stale" | **correct work** | `foreman:roadmap` → "Branch: Correct a task" ([correct.md](../roadmap/correct.md)) |
| "my roadmap is broken", "check the roadmap", "is the roadmap file healthy" | **check the roadmap** | `foreman:roadmap` → "Branch: Check the roadmap" ([doctor.md](../roadmap/doctor.md)) |
| "what's next", "pick a task", "something quick on auth", "give me work" | **pick work** | `foreman:roadmap` → "Branch: Pick the next task" ([pick.md](../roadmap/pick.md)) |
| "is the roadmap still accurate — then give me something", "double-check the top tasks before I start", "audit it and pick" | **reconcile and pick** | `foreman:roadmap` → "Branch: Pick the next task", its reconcile path ([pick.md](../roadmap/pick.md), which runs [survey](../survey/SKILL.md) first) |

Each route reads [the roadmap skill](../roadmap/SKILL.md) and then the linked
branch file.

Notes that change how a route is handed over:

- **pick work** is **Fast pick**, the default confidence mode and the sense of
  a bare "what's next": that branch deliberately does not investigate the
  codebase. Don't promote it to **reconcile and pick** because the roadmap
  looks old — the user asks for that or it doesn't happen.
- **reconcile and pick** is the other confidence mode, **Reconcile and pick**
  — survey and pick in sequence, nothing new. The pick branch owns that
  sequence: it takes the near-term set from its own menu, hands it to
  `foreman:survey`, which ground-truths those entries and applies only the
  repairs the user authorizes, then picks from the repaired roadmap. Say up
  front that the reconcile half costs real tokens, since that is the whole
  difference from a plain pick.
- **check the roadmap** is a structural check — is the file itself well
  formed (duplicate ids, broken dependency edges, a stale schema version)
  — not a check against the codebase. That's the difference from
  **reconcile and pick**: this one never touches `foreman:survey` and never
  leads into a pick unless the user separately asks for one.
- Four of the five roadmap intents can also be reached by the user picking
  from `foreman:roadmap`'s own menu; **check the roadmap** is phrase-reached
  only. Route to the branch when the request already names one; hand over
  without a branch when it genuinely doesn't.

## When the request fits two intents

When two intents fit and the distinction changes the work, ask one concise
question naming the closest two intents in the user's own terms —
`AskUserQuestion` in Claude Code, the picker in [questions.md](questions.md) in
Codex. Never a menu of all six, and never a guess dressed up as a route. Then
hand off to the one they pick. Skip the question when the intent is clear.

The pairs worth expecting: "what's next" after describing new work (add
work vs. pick work), "the plan looks off" (correct work vs. reconcile and
pick), and "sort out what's next" (pick work vs. reconcile and pick).

## Anything else is out of scope here

This entrance covers those six intents and nothing else. When a request
falls outside them, name the skill that owns it in one line and stop —
don't stretch a route to fit. If the user names a specialized skill, go
straight to it.

- setting a project up for the first time, or re-initializing it —
  `foreman:init` ([init](../init/SKILL.md)).
- explicitly building or refining a handoff prompt for something that isn't a
  roadmap entry — `foreman:craft-prompt` ([craft-prompt](../craft-prompt/SKILL.md)).
- accepting, resuming, deferring, archiving, or restoring entries — those live
  inside `foreman:roadmap`'s branches above; route to the intent that carries
  them rather than describing the mechanics here.
- anything that isn't a Foreman request at all — this skill has no opinion
  on it and shouldn't have taken the turn.
