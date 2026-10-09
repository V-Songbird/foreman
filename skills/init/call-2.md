# Call 2 — approval

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
