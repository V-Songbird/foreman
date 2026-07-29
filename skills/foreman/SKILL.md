---
name: foreman
description: The one entrance to Foreman — say what you want in plain language and this routes it. Covers the seven things Foreman does to a project: add work, show status, correct work, check the roadmap, pick work, reconcile and pick, or run a short batch. It owns no flow of its own; each intent is handed to the skill that already implements it, so there is nothing here to learn beyond describing what you want.
when_to_use: Trigger on any plain-language Foreman request that does not already name a command — "what should I work on", "add this to the roadmap", "where does the project stand", "that entry's description is wrong", "my roadmap is broken", "is the roadmap file healthy", "check the roadmap's still right and then give me something", "knock out the next few tasks", "foreman" on its own, or invokes /foreman:foreman. Skip it when the user named the specialized skill they want (/foreman:roadmap, /foreman:survey, /foreman:sprint, /foreman:init, /foreman:craft-prompt) — go straight there.
argument-hint: "<what you want, in plain language>"
allowed-tools: AskUserQuestion, Skill
---

# foreman — the one entrance

This skill routes. It does not add, pick, correct, survey, or batch
anything itself, and it never reads or writes `ROADMAP.jsonl`. Every step
of every flow lives in the skill that owns it; duplicating any of it here
would give Foreman two versions of the same truth. Classify the request,
say in one short line which flow is taking it, then hand off and let that
skill run from its own first step.

## The seven intents

| The user says something like… | Intent | Route to |
| --- | --- | --- |
| "add this", "put X on the roadmap", "we also need to…", "track this for later" | **add work** | `foreman:roadmap` → "Branch: Add a task" |
| "where are we", "roadmap status", "what's left", "what's waiting on me" | **show status** | `foreman:roadmap` → "Branch: Review status" |
| "that entry is wrong", "reword 003", "retarget 007 at the proxy", "its description is stale" | **correct work** | `foreman:roadmap` → "Branch: Correct a task" |
| "my roadmap is broken", "check the roadmap", "is the roadmap file healthy" | **check the roadmap** | `foreman:roadmap` → "Branch: Check the roadmap" |
| "what's next", "pick a task", "something quick on auth", "give me work" | **pick work** | `foreman:roadmap` → "Branch: Pick the next task" |
| "is the roadmap still accurate — then give me something", "double-check the top tasks before I start", "audit it and pick" | **reconcile and pick** | `foreman:survey` first, then `foreman:roadmap` → "Branch: Pick the next task" |
| "work through the next few", "run a small sprint", "knock out three tasks" | **run a short batch** | `foreman:sprint` (experimental) |

Notes that change how a route is handed over:

- **pick work** is **Fast pick**, the default confidence mode and the sense of
  a bare "what's next": that branch deliberately does not investigate the
  codebase. Don't
  promote it to **reconcile and pick** because the roadmap looks old — the
  user asks for that or it doesn't happen.
- **reconcile and pick** is the other confidence mode, **Reconcile and pick**
  — those two flows in sequence, nothing new:
  `foreman:survey` ground-truths the near-term candidates and applies only
  the repairs the user approves, one finding at a time, and then the pick
  branch runs on the repaired roadmap. Hand off to the survey skill first
  and let it finish — including its own report — before the pick starts.
  Say up front that the reconcile half costs real tokens, since that is the
  whole difference from a plain pick.
- **run a short batch** is experimental — say so in the same line that
  names the route, before `foreman:sprint` takes over, so the user can fall
  back to picking one task instead.
- **check the roadmap** is a structural check — is the file itself well
  formed (duplicate ids, broken dependency edges, a stale schema version)
  — not a check against the codebase. That's the difference from
  **reconcile and pick**: this one never touches `foreman:survey` and never
  leads into a pick unless the user separately asks for one.
- Any of the five roadmap intents can also be reached by the user picking
  from `foreman:roadmap`'s own menu. Route to the branch when the request
  already names one; hand over without a branch when it genuinely doesn't.

## When the request fits two intents

Ask **one** `AskUserQuestion` naming the closest two intents in the user's
own terms — never a menu of all seven, and never a guess dressed up as a
route. Then hand off to the one they pick.

The pairs worth expecting: "what's next" after describing new work (add
work vs. pick work), "the plan looks off" (correct work vs. reconcile and
pick), "sort out what's next" (pick work vs. reconcile and pick), and "get
through the backlog" (pick work vs. run a short batch).

## Anything else is out of scope here

This entrance covers those seven intents and nothing else. When a request
falls outside them, name the skill that owns it in one line and stop —
don't stretch a route to fit:

- setting a project up for the first time, or re-initializing it —
  `foreman:init`.
- building a handoff prompt for something that isn't a roadmap entry —
  `foreman:craft-prompt`.
- accepting, resuming, deferring, or archiving entries — those live inside
  `foreman:roadmap`'s branches above; route to the intent that carries them
  rather than describing the mechanics here.
- anything that isn't a Foreman request at all — this skill has no opinion
  on it and shouldn't have taken the turn.
