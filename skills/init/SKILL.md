---
name: init
description: "Bootstraps a project's ROADMAP.jsonl and .foreman/config.json from the user's goals and the repository, or appends to an existing roadmap. Asks only what the request leaves open — what the project is, its near-term goals, and whether an inferred draft looks right — then writes and commits only the files it changes, leaving every optional behavior at its built-in default. Checkpoint policy is never asked here; it is asked the first time it could actually matter. Use for Foreman setup or an explicitly requested reinitialization; existing history and settings are preserved unless replacement was authorized."
when_to_use: "Trigger when the user wants to set up Foreman's roadmap for a project, says \"init foreman\", \"set up the roadmap\", \"initialize foreman\", \"start a roadmap\", or invokes /foreman:init. Usually a one-time-per-project action."
argument-hint: "<project description — optional seed>"
allowed-tools: AskUserQuestion, Read, Write, Bash, PowerShell
---

# foreman:init — bootstrap a project roadmap

Foreman runs in Claude Code, Codex and Antigravity. Every step applies to every host unless it names one. Read [the shared runtime](../foreman/runtime.md) first: it covers plugin paths, JSON payloads, questions and authorization for every host.

Creates `ROADMAP.jsonl` and `.foreman/config.json` at the project root. Both
are committed to git — they're a shared project artifact, not personal
state — unless the project git-ignores them to keep a private roadmap; then
init writes both and commits neither (step 4 of the write phase). All
reads/writes go through
`${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js` (see "Write phase" below) — it
enforces the write invariants (id computation, parse-before/after-write)
mechanically, so you don't have to. Run it as
`roadmap.js <subcommand> --help` (for example `roadmap.js add --help`) for
that subcommand's shape; read the **Fields** section of [the schema](../../roadmap-schema.md)
(`${CLAUDE_PLUGIN_ROOT}/roadmap-schema.md`) if you need field semantics
beyond what's obvious from the names (`why`/`what`/`depends_on`/`planned_touches`).

---

<!-- [Foreman: 209] -->
**Trial log.** Setup is one of the flows no script can see from outside, so
these lines are the only record it left. A valid call records nothing unless
the project set `trialLog`, so it needs no check first; a malformed one fails
in every project. Either way it never blocks the flow.

At the **first question actually put to the user** — or as the write phase
starts, when no question is asked — one line:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js init_started '{}'
```

and, after each question interaction the user actually sees — one
`AskUserQuestion` call in Claude Code, however many questions it batches;
one picker call or one plain-text question in Codex; one `ask_question` call
in Antigravity — one event:

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

Read [call-1.md](call-1.md) (`${CLAUDE_PLUGIN_ROOT}/skills/init/call-1.md`) and follow it.

---

## Defaults — never asked, never written

There is no policy interview, and there is no settings file to compose.
Every optional behavior already has a safe default in the code that reads
it, so init writes `.foreman/config.json` as an empty object `{}` and lets
those defaults stand: finished work waits for the user's confirmation,
nothing blocks a task's completion, handoffs open with a persona sentence,
and no prompt section is omitted.

Writing those values out would only create a second copy that can drift
from the readers. Checkpoint policy stays absent for a second reason too:
an absent key is the record that the user was never asked, so it gets asked
once, the first time it could matter, at the first split run.

Any of it can be set by hand later — see
[`settings.md`](../../settings.md).

---

## Draft phase (no question)

Read [draft.md](draft.md) (`${CLAUDE_PLUGIN_ROOT}/skills/init/draft.md`) and follow it.

---

## Call 2 — approval

Read [call-2.md](call-2.md) (`${CLAUDE_PLUGIN_ROOT}/skills/init/call-2.md`) and follow it.

---

## Write phase

Read [write.md](write.md) (`${CLAUDE_PLUGIN_ROOT}/skills/init/write.md`) and follow it.
