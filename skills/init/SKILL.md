---
name: init
description: Bootstraps a project's ROADMAP.jsonl and .foreman/config.json. Asks three things — what the project is, its near-term goals, and whether the drafted roadmap looks right — then writes and commits both files, leaving every optional behavior at its built-in default. Discovery, decision notes, and checkpoint policy are never asked here; each one is asked the first time it could actually matter.
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
mechanically, so you don't have to. Run it with `--help` for the command
shapes; read the **Fields** section of
`${CLAUDE_PLUGIN_ROOT}/roadmap-schema.md` if you need field semantics
beyond what's obvious from the names (`why`/`what`/`depends_on`/`planned_touches`).

If args were provided, treat them as the project description seed and skip
asking for it in Call 1.

---

<!-- [Foreman: 209] -->
**Trial log.** Setup is one of the flows no script can see from outside, so
these lines are the only record it left. Each is a no-op unless the project
set `trialLog`, so none needs a check first and it never blocks the flow.

At the **first question actually put to the user** — the Pre-check's Q1 below
on a project that already has a roadmap, Call 1's Q1 otherwise — one line:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js init_started '{}'
```

and, after every `AskUserQuestion` call in this skill, one event per call:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js question_asked '{"flow":"init"}'
```

A Pre-check `Cancel` therefore leaves an `init_started` with no
`init_completed`. That is the correct record of an abandoned setup, not a
gap to paper over.

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
Options: `I'll describe it`, `Read the repo and work it out`
`I'll describe it` nudges the user into Other for a short description —
what it does, what stack, new or existing codebase.

**Q2** — "What are the near-term goals for the roadmap?"
Options: `I'll describe them`, `Propose some from the code`
`I'll describe them` nudges toward Other — 2-5 concrete things they want
to get done soon.

On either read-the-code answer, ground the draft in what is actually
there — the README, the manifest, the entry points, `git log` — and say in
the draft which parts came from the repo rather than from the user. Call 2
is where they correct it, so a wrong guess costs one round trip. If the
repo is empty or unreadable, say so and ask the question again rather than
drafting from nothing.

---

## Defaults — never asked, never written

There is no policy interview, and there is no settings file to compose.
Every optional behavior already has a safe default in the code that reads
it, so init writes `.foreman/config.json` as an empty object `{}` and lets
those defaults stand: finished work waits for the user's confirmation,
nothing blocks a task's completion, handoffs open with a persona sentence,
no prompt section is omitted, and Fable 5 is assumed unavailable.

Writing those values out would only create a second copy that can drift
from the readers. `discoverySuggestions` and `decisionLog` stay absent for
a second reason too: an absent key is the record that the user was never
asked, so each gets asked once, the first time it could matter — discovery
by the post-commit hook after a commit it would have run on, decision notes
by `foreman:roadmap` when the first `kind: "decision"` entry is added, and
checkpoint policy at the first split run.

Any of it can be set by hand later — see
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

   <!-- [Foreman: 209] -->
   **Trial log** — once the four-option question above reaches a definite
   outcome, one line, one event per resolution rather than per retry:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js recovery_attempted '{"kind":"reinit-snapshot","success":<true|false>}'
   ```
   `true` for a retry that exited 0 or a backup that copied; `false` for
   `Continue without a snapshot` and for `Cancel`.

   Clear the file only after a snapshot that exited 0, a backup that
   copied, or that explicit continue — and before clearing, note the old
   roadmap's highest id: `Foreman: <id>` commit trailers and
   `[Foreman: <id>]` anchors from the old generation persist in git
   history, so the new file must not reuse those ids. Then clear —
   `Bash`: `> ROADMAP.jsonl` (or delete it) — and pass that highest id as
   `"ids_after":"<old max>"` on the FIRST `add` call in step 2 below;
   numbering continues past it and every later add follows on from there.
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
3. Write `.foreman/config.json` as `{}` — an empty object, per the defaults
   section above (skip this file write if the pre-check "keep, add to it"
   branch found an existing config already).
   **If the file already exists, leave it exactly as it is.** There is
   nothing for init to put in it, and everything already in it is either a
   deliberate hand edit or the recorded answer to a first-relevant ask
   (`discoverySuggestions`, `decisionLog`, `checkpoints`) that a re-init
   must not throw away. If the file exists but won't parse, say so in the
   report-back and change nothing.
4. Stage and commit just these two files:
   `git add ROADMAP.jsonl .foreman/config.json && git commit -m "chore: init foreman roadmap"`
   (Only the files this skill wrote — never a broader `git add`.)

<!-- [Foreman: 209] -->
5. **Trial log** — after step 4's commit lands, one line:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js init_completed '{"tasks":<how many add calls succeeded>}'
   ```
   `tasks` is how many `add` calls actually succeeded, never how many were
   drafted. Record it only once both files are committed: an init that never
   reached the commit did not complete.

Report back: task count, one line that everything optional is off and gets
asked about when it first matters, and point the user at
`/foreman:roadmap` to pick up the first task.
