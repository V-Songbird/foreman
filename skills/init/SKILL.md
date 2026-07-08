---
name: init
description: Bootstraps a project's ROADMAP.jsonl and .foreman/config.json. Asks what the project is and its near-term goals, asks whether the roadmap should accept Claude-suggested entries after commits, drafts an initial set of roadmap tasks, gets approval, then writes and commits both files.
when_to_use: Trigger when the user wants to set up Foreman's roadmap for a project, says "init foreman", "set up the roadmap", "initialize foreman", "start a roadmap", or invokes /foreman:init. Usually a one-time-per-project action.
argument-hint: "<brief project description — optional seed>"
allowed-tools: AskUserQuestion, Read, Write, Bash
---

# foreman:init — bootstrap a project roadmap

Creates `ROADMAP.jsonl` and `.foreman/config.json` at the project root. Both
are committed to git — they're a shared project artifact, not personal
state. All reads/writes go through
`${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js` (see "Write phase" below) — it
enforces the write invariants (id computation, parse-before/after-write)
mechanically, so you don't have to. Skim
`${CLAUDE_PLUGIN_ROOT}/roadmap-schema.md` if you need field semantics
beyond what's obvious from the names (`why`/`what`/`depends_on`/`touches`).

If args were provided, treat them as the project description seed and skip
asking for it in Call 1.

---

## Pre-check

If `ROADMAP.jsonl` already exists at the project root, ask before doing
anything else:

**Q1** — "ROADMAP.jsonl already exists. What do you want to do?"
Options: `Overwrite it (start fresh)`, `Keep it, just add to it`, `Cancel`

- Overwrite → continue to Call 1, the draft phase replaces the file.
- Keep, add to it → skip straight to the draft phase, append new entries
  instead of replacing, don't touch `.foreman/config.json` if it already
  exists (ask its Call 2 question only if the config file is missing).
- Cancel → stop here.

---

## Call 1 — project and goals (batch 2)

**Q1** — "What is this project?"
Options: `I'll describe it` (nudge the user to use Other and give a short
description — what it does, what stack, new or existing codebase)

**Q2** — "What are the near-term goals for the roadmap?"
Options: `I'll describe them` (nudge toward Other — 2-5 concrete things
they want to get done soon)

---

## Call 2 — the policy toggle (single question, this is the key decision)

**Q1** — "Should the roadmap accept Claude-suggested entries after commits?"
Options:
- `Yes — ask me about opportunities found after each commit` — after every
  `git commit`, Foreman's hook will prompt Claude to scan for confirmed
  bugs/opportunities/ideas from that work and ask what to do with each one.
- `No — the roadmap only grows from what I add myself` — the commit hook
  stays completely silent; nothing gets suggested, ever, until re-run.

Record the answer — it becomes `.foreman/config.json`'s `discoverySuggestions`
field verbatim.

---

## Draft phase (no AskUserQuestion)

From the Call 1 answers, draft 3–8 initial `ROADMAP.jsonl` lines following
the schema exactly:
- `source: "user"` for every entry (nothing Claude-suggested exists yet —
  these came from the user's own stated goals).
- `status: "planned"`, `depends_on` filled in only where one task is
  obviously sequential to another (don't invent dependencies that aren't
  there).
- `touches` as a best-guess area hint per task, or `[]` if genuinely
  unknown (a brand-new project has no files to point at yet — that's fine).
- ids `"001"` through `"00N"` (or continuing past the existing max, if
  appending to an existing file per the pre-check).

Present the draft as readable text, one task per line — `title` plus `why`
— not a raw JSON dump. The user should be able to skim it in a few seconds.

---

## Call 3 — approval

**Q1** — "Draft roadmap ready above. Proceed?"
Options: `Looks good, write it`, `Let me adjust it first`

If adjust: gather free-text revisions (add/remove/reword tasks), re-present
the updated draft, ask again. Repeat until approved.

---

## Write phase

1. If the pre-check chose Overwrite: clear any existing file first —
   `Bash`: `> ROADMAP.jsonl` (or delete it). `roadmap.js add` always
   appends, so a fresh file means ids start at `001` again.
2. For each drafted task, call `add` with its fields as JSON over stdin:
   ```
   echo '{"title":"...","why":"...","what":"...","source":"user","depends_on":[],"touches":[]}' \
     | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js add
   ```
   The script computes the id, sets `status:"planned"`, stamps
   `created_at`/`updated_at`, and validates the file after every write —
   no manual parsing, no hand-computed ids.
3. Write `.foreman/config.json` — `{"discoverySuggestions": <bool>}` (skip
   this file write if the pre-check "keep, add to it" branch found an
   existing config already).
4. Stage and commit just these two files:
   `git add ROADMAP.jsonl .foreman/config.json && git commit -m "chore: init foreman roadmap"`
   (Only the files this skill wrote — never a broader `git add`.)

Report back: task count, discovery-suggestions on/off, and point the user
at `/foreman:roadmap` to pick up the first task.
