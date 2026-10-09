---
name: craft-prompt
description: "Advanced surface, separate from Foreman's core roadmap job — a standalone prompt builder for work that has no roadmap entry behind it. Use on an explicit prompt-crafting request. Builds or refines a self-contained prompt for a fresh session following Foreman's template: asks which optional sections to include, gathers the missing intent, grounds paths and checks, assembles the XML, then runs it here as one or several tracked tasks, hands it to a background agent, or copies it to the clipboard."
when_to_use: "Trigger only on an explicit request to build or refine a standalone prompt — \"craft a prompt\", \"build a prompt\", \"write me a prompt\", \"refine this prompt\", \"foreman prompt\", or invokes /foreman:craft-prompt. An ordinary work request is not one of those: wanting something built, tracked, or handed to a background Agent is roadmap work — it goes to the `foreman` entrance, which picks or adds the entry and builds the handoff itself."
argument-hint: "<task description — optional seed>"
allowed-tools: AskUserQuestion, TaskCreate, TaskUpdate, Agent, Read, Write, Bash, PowerShell
---

# foreman:craft-prompt — interactive prompt builder

Foreman runs in Claude Code, Codex and Antigravity. Every step applies to every host unless it names one. Read [the shared runtime](../foreman/runtime.md) first: it covers plugin paths, JSON payloads, questions and authorization for every host.

Advanced tool, separate from Foreman's core job. An ordinary
implementation request does not call for a prompt-crafting interview: it
goes through [the `foreman` entrance](../foreman/SKILL.md), which builds
its own handoff out of the roadmap entry. This skill is for the case with
no roadmap entry behind it: a standalone prompt, asked for explicitly.
Write for a destination with no memory of this conversation — every field
must be filled so it can act cold.

Ask each call's questions together — `AskUserQuestion` in Claude Code; in
Codex, the picker in [questions.md](../foreman/questions.md), within its
limits. With no usable question tool, ask one self-contained plain-text
question. Ask directly: never say Foreman requires the question or cite a
skill as the reason. Text supplied with the request (in Claude Code, the
skill's args) seeds the task description; skip a question only when the
user's own words already answer it.

Each step below lives in its own file beside this one. Read it when the
interview reaches that step and follow it; a step this file skips is never
read.

---

## Call 1 — task type, optional sections, starting point, and flavor

Read [call-1.md](call-1.md) (`${CLAUDE_PLUGIN_ROOT}/skills/craft-prompt/call-1.md`) and follow it.

---

## Ground the file options (one read-only pass, before Call 2)

Read [ground-files.md](ground-files.md) (`${CLAUDE_PLUGIN_ROOT}/skills/craft-prompt/ground-files.md`) and follow it.

---

## Call 2 — required fields (batch all 4)

Read [call-2.md](call-2.md) (`${CLAUDE_PLUGIN_ROOT}/skills/craft-prompt/call-2.md`) and follow it.

---

## Call 3 — verification (conditional)

Skip this call only if the task type is pure research/investigation with no code changes.

Otherwise read [call-3.md](call-3.md) (`${CLAUDE_PLUGIN_ROOT}/skills/craft-prompt/call-3.md`) and follow it.

---

## Call 4-N — optional section details

When Call 1 Q2 selected any optional section, or Call 1 Q4 answered `Yes`,
read [call-4.md](call-4.md) (`${CLAUDE_PLUGIN_ROOT}/skills/craft-prompt/call-4.md`) and follow it.

---

## When an answer is "I don't know"

When any answer comes back as a don't-know, or Call 2 Q3 comes back as
`I can only name the area` or names no file, read [dont-know.md](dont-know.md) (`${CLAUDE_PLUGIN_ROOT}/skills/craft-prompt/dont-know.md`) and follow it.

---

## Resolve the named files (craft-time, once)

Read [resolve-files.md](resolve-files.md) (`${CLAUDE_PLUGIN_ROOT}/skills/craft-prompt/resolve-files.md`) and follow it.

---

## Call 5 — how to run it

Honor a destination the user already stated. Otherwise read
[destination-question.md](../roadmap/destination-question.md)
(`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/destination-question.md`) now and
do exactly what it says. Call 3 already gathered the verification, so the
count is known here — it never removes an option, it decides which one
carries a caution. Foreman never asks which model runs the work and never
sets one: a background agent inherits this session's model, and a pasted
prompt runs wherever the user pastes it.

---

## Assemble the handoff — one call to craft-handoff.js

Read [assemble.md](assemble.md) (`${CLAUDE_PLUGIN_ROOT}/skills/craft-prompt/assemble.md`) and follow it.

---

## Deliver

Read [deliver.md](deliver.md) (`${CLAUDE_PLUGIN_ROOT}/skills/craft-prompt/deliver.md`) and follow it.
