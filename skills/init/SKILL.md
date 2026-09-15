---
name: init
description: "Bootstraps a project's ROADMAP.jsonl and .foreman/config.json from the user's goals and the repository, or appends to an existing roadmap. Asks only what the request leaves open — what the project is, its near-term goals, and whether an inferred draft looks right — then writes and commits only the files it changes, leaving every optional behavior at its built-in default. The ledger and checkpoint policy are never asked here; each is asked the first time it could actually matter. Use for Foreman setup or an explicitly requested reinitialization; existing history and settings are preserved unless replacement was authorized."
when_to_use: "Trigger when the user wants to set up Foreman's roadmap for a project, says \"init foreman\", \"set up the roadmap\", \"initialize foreman\", \"start a roadmap\", or invokes /foreman:init. Usually a one-time-per-project action."
argument-hint: "<brief project description — optional seed>"
allowed-tools: AskUserQuestion, Read, Write, Bash, PowerShell
---

# foreman:init — bootstrap a project roadmap

Foreman runs in Claude Code and in Codex. Every step applies to both unless it names a host. Read [the shared runtime](../foreman/runtime.md) first: it covers plugin paths, JSON payloads, questions and authorization for both hosts.

Creates `ROADMAP.jsonl` and `.foreman/config.json` at the project root. Both
are committed to git — they're a shared project artifact, not personal
state. All reads/writes go through
`${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js` (see "Write phase" below) — it
enforces the write invariants (id computation, parse-before/after-write)
mechanically, so you don't have to. Run it with `--help` for the command
shapes; read the **Fields** section of [the schema](../../roadmap-schema.md)
(`${CLAUDE_PLUGIN_ROOT}/roadmap-schema.md`) if you need field semantics
beyond what's obvious from the names (`why`/`what`/`depends_on`/`planned_touches`).

---

<!-- [Foreman: 209] -->
**Trial log.** Setup is one of the flows no script can see from outside, so
these lines are the only record it left. Each is a no-op unless the project
set `trialLog`, so none needs a check first and it never blocks the flow.

At the **first question actually put to the user** — or as the write phase
starts, when no question is asked — one line:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js init_started '{}'
```

and, after each question interaction the user actually sees — one
`AskUserQuestion` call in Claude Code, however many questions it batches;
one picker call or one plain-text question in Codex — one event:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js question_asked '{"flow":"init"}'
```

A skipped question is never logged. A cancelled or blocked setup leaves an
`init_started` with no `init_completed`. That is the correct record of an
unfinished setup, not a gap to paper over.

---

## Pre-check

If `ROADMAP.jsonl` already exists at the project root, an explicit user
instruction to append or to replace selects that branch. Otherwise ask
before doing anything else — `AskUserQuestion` in Claude Code; in Codex, the
picker in [questions.md](../foreman/questions.md). With no usable question
tool, ask each question in this skill as one self-contained plain-text
question.

**Q1** — "ROADMAP.jsonl already exists. What do you want to do?"
Options: `Overwrite it (start fresh — discards done entries and their
accumulated notes)`, `Keep it, just add to it`, `Cancel`

- Overwrite → continue to Call 1; the write phase snapshots the old file
  before replacing it.
- Keep, add to it → continue to Call 1 and append new entries instead of
  replacing; don't touch `.foreman/config.json` if it already exists.
- Cancel → stop here and change nothing.

---

## Call 1 — project and goals

Use a project description or goals the request already gives (including
the skill's arguments) and skip that question. Ask the rest in one
`AskUserQuestion` call in Claude Code; in Codex, one picker at a time from
[questions.md](../foreman/questions.md).

**Q1** — "What is this project?"
Options: `I'll describe it`, `Read the repo and work it out`
`I'll describe it` asks for a short description — what it does, what stack,
new or existing codebase.

**Q2** — "What are the near-term goals for the roadmap?"
Options: `I'll describe them`, `Propose some from the code`
`I'll describe them` asks for 2-5 concrete things they want to get done
soon.

In Claude Code, both `I'll describe` options nudge the user into Other.

On either read-the-code answer, ground the draft in what is actually
there — the README, the manifest, the entry points, `git log` — and say in
the draft which parts came from the repo rather than from the user. Call 2
is where they correct it. If the repo is empty or unreadable, say so and
ask the question again rather than drafting from nothing.

---

## Defaults — never asked, never written

There is no policy interview, and there is no settings file to compose.
Every optional behavior already has a safe default in the code that reads
it, so init writes `.foreman/config.json` as an empty object `{}` and lets
those defaults stand: finished work waits for the user's confirmation,
nothing blocks a task's completion, handoffs open with a persona sentence,
and no prompt section is omitted.

Writing those values out would only create a second copy that can drift
from the readers. `ledger` stays absent for a second reason too: an absent
key is the record that the user was never asked, so it gets asked once, the
first time it could matter — by the roadmap skill at the first pick whose
files a finished task already touched. Checkpoint policy is asked the same
way, at the first split run.

Any of it can be set by hand later — see
[`settings.md`](../../settings.md).

---

## Draft phase (no question)

From the Call 1 answers, draft 3–8 initial `ROADMAP.jsonl` lines following
the schema exactly, fewer when the user's scope calls for fewer:
- `status: "planned"`, `depends_on` filled in only where one task is
  obviously sequential to another (don't invent dependencies that aren't
  there).
- `planned_touches` as a best-guess area hint per task, or `[]` if genuinely
  unknown (a brand-new project has no files to point at yet — that's fine).
  It is a prediction; what the work actually reaches gets recorded separately
  at close, so a wrong guess costs nothing and `correct` can replace it.
- A task that settles an open question rather than building something is a
  decision task: say so in the draft and add `"kind":"decision"` to its
  payload.
- ids `"001"` through `"00N"` (or continuing past the old highest id, when
  appending or replacing per the pre-check).

Present the draft as readable text, one task per line — `title` plus `why`
— not a raw JSON dump. The user should be able to skim it in a few seconds.

---

## Call 2 — approval

Skip this question only when the user spelled out the tasks themselves —
that request authorizes creating them. Any goal or task you inferred or
proposed needs it.

Before asking, add one line saying what the config will be: verification
confirmation on, every optional behavior off and asked about the first time
it matters. The user is approving both files here, not just the roadmap.
Ask with `AskUserQuestion` in Claude Code; in Codex, the picker in
[questions.md](../foreman/questions.md).

**Q1** — "Draft roadmap ready above. Proceed?"
Options: `Looks good, write it`, `Let me adjust it first`

If adjust: gather free-text revisions (add/remove/reword tasks), re-present
the updated draft, ask again. Repeat until approved.

---

## Write phase

Respect any branch restriction the user gave. Never switch, merge or commit
on a protected branch (one the user said not to modify, or one the host or
repository marks as protected); when a writable branch is needed, create a
descriptive branch first (`codex/<descriptive-name>` in Codex).

1. If replacing an existing roadmap: snapshot it into git before clearing
   it, so the discarded history is recoverable —
   `git commit -m "chore: snapshot roadmap before foreman re-init" -- ROADMAP.jsonl`.
   Use that pathspec form: unrelated staged work is likely in an
   established project, and a commit without the pathspec would sweep it
   into a commit titled "snapshot roadmap". A roadmap already committed
   with no changes counts as snapshotted once you verify its bytes match
   `HEAD:ROADMAP.jsonl` and name that revision.

   **If the snapshot fails, stop before clearing anything.** Whether the old
   roadmap stays recoverable is the user's call, not a line in the
   report-back. Ask one question — "Snapshotting the existing roadmap
   failed: <exit reason>. How do you want to proceed?" — with exactly these
   four options (`AskUserQuestion` in Claude Code; in Codex, the picker in
   [questions.md](../foreman/questions.md), or one plain-text question when
   the picker cannot show all four):
   - `Retry the snapshot` — the user fixes git (commits or stashes the
     unrelated work, repairs the hook), then run the same command again.
     Fails again → ask again.
   - `Save a timestamped backup instead` — copy `ROADMAP.jsonl` to
     `ROADMAP.jsonl.backup-YYYYMMDD-HHMMSS` and, if `.foreman/config.json`
     exists, that file to `.foreman/config.json.backup-YYYYMMDD-HHMMSS`,
     with the actual current stamp. Bash:
     `cp ROADMAP.jsonl "ROADMAP.jsonl.backup-$(date +%Y%m%d-%H%M%S)"` and
     `cp .foreman/config.json ".foreman/config.json.backup-$(date +%Y%m%d-%H%M%S)"`.
     PowerShell:
     `Copy-Item -LiteralPath ROADMAP.jsonl -Destination "ROADMAP.jsonl.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"` and
     `Copy-Item -LiteralPath .foreman/config.json -Destination ".foreman/config.json.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"`.
     Those exact destinations — never invent a folder or another name.
     Before clearing, verify both copies. The backups stay untracked, since
     init commits only the files it writes; say where they landed and that
     they are temporary — the user deletes them once satisfied with the new
     roadmap. If a copy fails, ask again instead of clearing.
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

   Clear the file only after a verified snapshot, a verified backup, or that
   explicit continue — and before clearing, record the old highest id,
   including archive history: `Foreman: <id>` commit trailers and
   `[Foreman: <id>]` anchors from the old generation persist in git
   history, so the new file must not reuse those ids. Then empty the file
   (truncate or delete it) and pass that highest id as
   `"ids_after":"<old max>"` on the FIRST `add` call in step 2 below;
   numbering continues past it and every later add follows on from there.
2. For each drafted task, call `add` with its fields as JSON over stdin. The
   `echo` form shows the payload's shape; pass user-written text the way
   [the shared runtime](../foreman/runtime.md) says:
   ```
   echo '{"title":"...","why":"...","what":"...","source":"user","depends_on":[],"planned_touches":[]}' \
     | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js add
   ```
   `source` is `"user"` only for work the user stated. Work you proposed,
   including goals drafted from the repository, takes the host's value:
   `"claude-suggested"` in Claude Code, `"codex-suggested"` in Codex.
   The script computes the id, sets `status:"planned"`, stamps
   `created_at`/`updated_at`, and validates the file after every write —
   no manual parsing, no hand-computed ids. A drafted task may only
   `depends_on` a task drafted above it: entries are written in this
   order, and `add` rejects an id that doesn't exist yet. If any call
   returns `warnings`, mention them once at the end rather than per entry.
   If a later `add` fails, preserve every successful partial add and report
   which tasks were written.
3. Write `.foreman/config.json` as `{}` only if missing — an empty object,
   per the defaults section above.
   **If the file already exists, leave it exactly as it is.** There is
   nothing for init to put in it, and everything already in it is either a
   deliberate hand edit or the recorded answer to a first-relevant ask
   (`ledger`, `checkpoints`) that a re-init
   must not throw away. If the file exists but won't parse, say so in the
   report-back and change nothing.
4. Commit only the files this flow wrote, by pathspec, so unrelated staged
   work stays out of the commit:
   `git add -- ROADMAP.jsonl .foreman/config.json && git commit -m "chore: init foreman roadmap" -- ROADMAP.jsonl .foreman/config.json`
   Drop `.foreman/config.json` from both halves when step 3 left an existing
   config in place: never stage or commit an existing config this flow did
   not change, and never a broader `git add`. If the commit is blocked,
   report the written files and the reason; never claim setup was committed
   or completed when it was not.

<!-- [Foreman: 209] -->
5. **Trial log** — after step 4's commit lands, one line:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js init_completed '{"tasks":<how many add calls succeeded>}'
   ```
   `tasks` is how many `add` calls actually succeeded, never how many were
   drafted. Record it only once the files this flow wrote are committed: an
   init that never reached the commit did not complete.

Report back: task count, one line that everything optional is off and gets
asked about when it first matters, and point the user at the first pick —
`/foreman:roadmap` in Claude Code, the roadmap skill in Codex.
