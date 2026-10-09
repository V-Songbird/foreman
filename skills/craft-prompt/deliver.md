# Deliver

Read [delivery.md](../roadmap/delivery.md)
(`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/delivery.md`) and deliver through
the destination chosen above, using the `prompt` (and `tasks[]` when
present) craft-handoff just returned — never re-derive, re-split, or
re-embed any of it. What differs for a standalone prompt:

- There is no roadmap entry: skip every entry step the delivery files name —
  opening or closing it, the dispatch note, the acceptance hold.
  Checkpoints otherwise work exactly as in a roadmap handoff.
- A `Workflow stage` task also carries the JSON Schema assembled in Call 4,
  delivered alongside `prompt` the same way: the clipboard temp file holds
  the prompt then the schema; in Claude Code, a `TaskCreate` description
  carries both.
- **Never print the assembled prompt or a Workflow-stage schema into chat
  unless the user asks to see it** — they are data for a tool call or a
  file; delivery-clipboard.md's last-resort fallback is the only other exception.
