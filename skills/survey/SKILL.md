---
name: survey
description: "Advanced surface, normally reached through the `foreman` entrance's Reconcile and pick mode, which hands it a near-term set of ids to scope the pass to. Ground-truths the roadmap's near-term candidates against the actual codebase — a read-only investigation checks whether each candidate's planned_touches/depends_on still match reality, then proposes a concrete, evidence-backed repair for every finding (hidden dependency, already-done, stale description or planned files), applies only the ones you approve, and persists them back into ROADMAP.jsonl so future sessions pick them up automatically. It costs materially more than a plain pick, which is why it is explicit: a fast pick or old roadmap alone does not trigger it."
when_to_use: "Reached through the `foreman` entrance for Reconcile and pick; trigger directly when a power user explicitly asks to reconcile, audit, double-check, or verify the roadmap's ordering — 'survey the roadmap', 'audit the next tasks', 'double-check what's next', 'is the roadmap still accurate', or invokes /foreman:survey. Never trigger automatically from foreman:roadmap's pick-next-task flow, a commit, or any other implicit signal."
argument-hint: "<optional — a task id or two to focus on, otherwise surveys the top unblocked candidates>"
allowed-tools: AskUserQuestion, Read, Bash, PowerShell, Agent
---

# foreman:survey — ground-truth the roadmap's near-term candidates

Foreman runs in Claude Code, Codex and Antigravity. Every step applies to every host unless it names one. Read [the shared runtime](../foreman/runtime.md) first: it covers plugin paths, JSON payloads, questions and authorization for every host.

This is the advanced code investigation flow, the one Foreman flow that
investigates the codebase against the roadmap. Fast pick does not run it: it
reads more code and costs more than ranking stored tasks, so it runs only when
someone asks for it.

Use `${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js` for all roadmap reads and
mutations — never read or edit `ROADMAP.jsonl` directly — and run it as
`roadmap.js <subcommand> --help` (for example `roadmap.js list --help`) for
that subcommand's shape. Read the **Fields** section of
[roadmap-schema.md](../../roadmap-schema.md)
(`${CLAUDE_PLUGIN_ROOT}/roadmap-schema.md`) for field semantics.

**Pre-check**: if `ROADMAP.jsonl` doesn't exist at the project root, offer
to set up the roadmap first (`/foreman:init` in Claude Code; in
Codex, [the init skill](../init/SKILL.md); `/init` in Antigravity) and stop
here.

---

## 1. Pick the scope

Read [scope.md](scope.md) (`${CLAUDE_PLUGIN_ROOT}/skills/survey/scope.md`) and follow it.

---

## 2. Investigate each candidate in parallel

Read [investigate.md](investigate.md) (`${CLAUDE_PLUGIN_ROOT}/skills/survey/investigate.md`) and follow it.

---

## 3. Confirm before writing anything

Read [confirm.md](confirm.md) (`${CLAUDE_PLUGIN_ROOT}/skills/survey/confirm.md`) and follow it.

---

## 4. Report

Short summary: candidates surveyed (and how many were left unsurveyed, if
any), verdicts, what got written. Separate
the three outcomes in one line each: corrections applied, findings left
unconfirmed as breadcrumbs, and proposals declined (declined ones exist only
here — nothing about them was written). If no writes happened, say the
roadmap is unchanged — this skill running is not itself news. For
**Reconcile and pick**, return these results to the pick flow before it
refreshes its menu; do not quietly continue on the old ranking.

---

<!-- [Foreman: 209] -->
## Trial log

After each question interaction the user actually sees in this flow, one
silent line:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js question_asked '{"flow":"survey"}'
```

One event per interaction, never one per question: one `AskUserQuestion` call
in Claude Code, however many questions it batches; one picker call or one
plain-text question in Codex; one `ask_question` call in Antigravity.
A skipped question is never logged. A valid call records nothing unless the
project set `trialLog`, so it needs no check first; a malformed one fails in
every project. Either way it never blocks the flow.
