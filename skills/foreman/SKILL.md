---
name: foreman
description: Keep a project's plan and task history with Foreman. Route requests to add work, review status, correct a task, check the roadmap, pick the next task, or reconcile the plan against code. Use for Foreman or roadmap requests, not ordinary implementation work.
---

# Foreman

Route the user's intent to the existing flow below. Read the linked skill and
the relevant branch; this entrance owns no flow and never reads or writes
`ROADMAP.jsonl` itself.

| Intent | Typical request | Read |
| --- | --- | --- |
| **add work** | "track this for later" | [roadmap](../roadmap/SKILL.md), then `add.md` |
| **show status** | "where are we?" | [roadmap](../roadmap/SKILL.md), then `status.md` |
| **correct work** | "003's description is wrong" | [roadmap](../roadmap/SKILL.md), then `correct.md` |
| **check the roadmap** | "is the roadmap file healthy?" | [roadmap](../roadmap/SKILL.md), then `doctor.md` |
| **pick work** | "what's next?" | [roadmap](../roadmap/SKILL.md), then `pick.md` |
| **reconcile and pick** | "check the plan against the code, then give me work" | [roadmap](../roadmap/SKILL.md), then `pick.md`'s reconcile path and [survey](../survey/SKILL.md) |

**Fast pick** is the default confidence mode. It ranks stored work and checks
the selected prompt mechanically; it does not audit the codebase.
**Reconcile and pick** investigates first and costs more. Run it only when
the user requests it; age alone does not authorize a survey.

When two intents fit and the distinction changes the work, ask one concise
question about those two. Skip routing questions when the intent is clear.
If the user names a specialized skill, go straight to it.

Other Foreman capabilities have their own entrance:

- Set up a project: [init](../init/SKILL.md).
- Explicitly build or refine a standalone prompt: [craft-prompt](../craft-prompt/SKILL.md).
- Accept, resume, defer, archive, and restore work: the roadmap flow.

Read [runtime.md](runtime.md) when executing a flow. It contains the shared
Codex capability, authorization, path, and bookkeeping rules.