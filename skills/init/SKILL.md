---
name: init
description: Bootstraps a project's ROADMAP.jsonl and .foreman/config.json. Asks three things — what the project is, its near-term goals, and whether the drafted roadmap looks right — then writes and commits both files using safe defaults for every optional behavior. Discovery, decision notes, model advice, and checkpoint policy are never asked here; each one is asked the first time it could actually matter.
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
beyond what's obvious from the names (`why`/`what`/`depends_on`/`planned_touches`).

If args were provided, treat them as the project description seed and skip
asking for it in Call 1.

---

## Pre-check

If `ROADMAP.jsonl` already exists at the project root, ask before doing
anything else:

**Q1** — "ROADMAP.jsonl already exists. What do you want to do?"
Options: `Overwrite it (start fresh — discards done entries and their
accumulated notes)`, `Keep it, just add to it`, `Cancel`

- Overwrite → continue to Call 1, the draft phase replaces the file.
- Keep, add to it → skip straight to the draft phase, append new entries
  instead of replacing, don't touch `.foreman/config.json` if it already
  exists (write the defaults below only if the config file is missing).
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

## Defaults — written, never asked

There is no policy interview. Everything except the project, its goals, and
the draft approval is a safe default, written verbatim:

| Key | Value | Why this is the safe reading |
| --- | --- | --- |
| `requireVerification` | `true` | a commit that looks like it finishes a task isn't evidence the task holds up — the entry lands in `awaiting_acceptance` and waits for the user |
| `taskCloseGate` | `"off"` | nothing blocks on a roadmap entry being closed |
| `usePersona` | `true` | the prompt template's own default |
| `omitSections` | `[]` | the same |
| `fableEnabled` | `false` | most plans can't run Fable 5 |

`discoverySuggestions`, `decisionLog`, and `modelSuggestions` are
deliberately **not written**. An absent key already reads as off
everywhere, and its absence is also the record that the user was never
asked — so each gets asked once, the first time it could matter, and the
answer is written then: discovery by the post-commit hook after a commit
that discovery would have run on, decision notes by `foreman:roadmap` when
the first `kind: "decision"` entry is added, checkpoint policy at the first
split run, and model advice whenever the user asks for it. Writing any of
those three here would spend a question now *and* silence the later ask.

Any of the defaults above can be changed by hand later — see
[`settings.md`](../../settings.md).

---

## Draft phase (no AskUserQuestion)

From the Call 1 answers, draft 3–8 initial `ROADMAP.jsonl` lines following
the schema exactly:
- `source: "user"` for every entry (nothing Claude-suggested exists yet —
  these came from the user's own stated goals).
- `status: "planned"`, `depends_on` filled in only where one task is
  obviously sequential to another (don't invent dependencies that aren't
  there).
- `planned_touches` as a best-guess area hint per task, or `[]` if genuinely
  unknown (a brand-new project has no files to point at yet — that's fine).
  It is a prediction; what the work actually reaches gets recorded separately
  at close, so a wrong guess costs nothing and `correct` can replace it.
- ids `"001"` through `"00N"` (or continuing past the existing max, if
  appending to an existing file per the pre-check).

Present the draft as readable text, one task per line — `title` plus `why`
— not a raw JSON dump. The user should be able to skim it in a few seconds.

---

## Call 2 — approval

Before asking, add one line saying what the config will be: verification
confirmation on, every optional behavior off and asked about the first time
it matters. The user is approving both files here, not just the roadmap.

**Q1** — "Draft roadmap ready above. Proceed?"
Options: `Looks good, write it`, `Let me adjust it first`

If adjust: gather free-text revisions (add/remove/reword tasks), re-present
the updated draft, ask again. Repeat until approved.

---

## Write phase

1. If the pre-check chose Overwrite: snapshot the existing file into git
   before clearing it, so the discarded history is recoverable —
   `Bash`: `git commit -m "chore: snapshot roadmap before foreman re-init" -- ROADMAP.jsonl`.
   Use that pathspec form, never `git add` + commit: this branch runs in an
   established project where unrelated staged work is likely, and a broad
   `git add` would sweep it into a commit titled "snapshot roadmap".

   **If the snapshot fails, stop before clearing anything.** A non-zero
   exit is common (no repo, nothing to commit, a rejecting pre-commit
   hook) and it is the difference between "your old roadmap is in git" and
   "it is gone" — so it is the user's call, not a line in the report-back.
   Ask one AskUserQuestion — "Snapshotting the existing roadmap failed:
   <exit reason>. How do you want to proceed?" — with exactly these four
   options:
   - `Retry the snapshot` — the user fixes git (commits or stashes the
     unrelated work, repairs the hook), then run the same command again.
     Fails again → ask again.
   - `Save a timestamped backup instead` — `Bash`:
     `cp ROADMAP.jsonl "ROADMAP.jsonl.backup-$(date +%Y%m%d-%H%M%S)"`, and
     if `.foreman/config.json` exists,
     `cp .foreman/config.json ".foreman/config.json.backup-$(date +%Y%m%d-%H%M%S)"`.
     Those exact destinations — never invent a folder or another name. The
     backups stay untracked, since init stages only the two files it
     writes; say where they landed and that they are temporary — the user
     deletes them once satisfied with the new roadmap. If the copy itself
     fails, ask again instead of clearing.
   - `Continue without a snapshot — the old roadmap is lost` — proceed
     only when the user picks this option explicitly. Never infer it from
     an earlier answer or from the failure looking expected.
   - `Cancel` — stop here, change nothing, and say the roadmap is
     untouched.

   Clear the file only after a snapshot that exited 0, a backup that
   copied, or that explicit continue — `Bash`: `> ROADMAP.jsonl` (or
   delete it). `roadmap.js add` always appends, so a fresh file means ids
   start at `001` again.
2. For each drafted task, call `add` with its fields as JSON over stdin:
   ```
   echo '{"title":"...","why":"...","what":"...","source":"user","depends_on":[],"planned_touches":[]}' \
     | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js add
   ```
   The script computes the id, sets `status:"planned"`, stamps
   `created_at`/`updated_at`, and validates the file after every write —
   no manual parsing, no hand-computed ids. A drafted task may only
   `depends_on` a task drafted above it: entries are written in this
   order, and `add` rejects an id that doesn't exist yet. If any call
   returns `warnings`, mention them once at the end rather than per entry.
3. Write `.foreman/config.json` —
   `{"usePersona": true, "omitSections": [], "requireVerification": true, "taskCloseGate": "off", "fableEnabled": false}`
   — those five keys exactly, at those values, from the defaults table
   above (skip this file write if the pre-check "keep, add to it" branch
   found an existing config already).
   **If the file already exists, `Read` it first and set those five keys on
   the parsed object — any other key present must survive untouched.** This
   applies whenever the file exists, not only on the Overwrite branch: the
   pre-check only fires when `ROADMAP.jsonl` exists, so a project with a
   config but no roadmap is never asked anything and would otherwise have
   its config replaced silently. Today the keys at risk are
   `discoverySuggestions`, `decisionLog`, `modelSuggestions`,
   `customSections`, `targetModel`, and `checkpoints` — init writes none of
   them, and the first three are answers to first-relevant asks that a
   re-init must not throw away — but the rule is "everything else
   survives", not a list, so the next key is covered without another edit.
   If the file exists but won't parse, write the five keys alone and say
   so in the report-back.
4. Stage and commit just these two files:
   `git add ROADMAP.jsonl .foreman/config.json && git commit -m "chore: init foreman roadmap"`
   (Only the files this skill wrote — never a broader `git add`.)

Report back: task count, one line that everything optional is off and gets
asked about when it first matters, and point the user at
`/foreman:roadmap` to pick up the first task.
