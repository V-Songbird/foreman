---
name: roadmap
description: Pick, add, correct, accept, resume, defer, archive, or review tasks in a project's Foreman roadmap; also check its structural health. Use when the user asks to manage ROADMAP.jsonl or choose tracked work.
---

# Foreman roadmap

Read [the shared runtime](../foreman/runtime.md) before executing. All roadmap
reads and writes use `scripts/roadmap.js` resolved from this plugin's location.
If the project has no roadmap, offer [init](../init/SKILL.md); run it directly
when the user's request already includes setup.

Route a clear request directly to its branch. With no intent, ask what the
user needs rather than guessing. Read only the relevant resource:

- [Pick the next task](pick.md): fast selection, acceptance, resume, deferral,
  handoff building, and the explicitly requested reconcile-and-pick flow.
- [Add a task](add.md): new work, including decision tasks.
- [Correct a task](correct.md): update its description or predicted file surface.
- [Review status](status.md): compact read-only status and execution history.
- [Check the roadmap](doctor.md): structural checks and targeted repairs.

For archive requests, list `done,dropped,rejected` with `--summary`, resolve the
requested ids, then call `archive` with `{"ids":[...]}`. If "archive finished
work" is explicit, that authorizes the listed terminal set; report which moved.
Ask when the intended subset is ambiguous. `restore` accepts the same shape;
use `list --archived --summary` to locate it. Only terminal entries archive.
Archiving preserves history and dependency resolution, and never reuses ids.