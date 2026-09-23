# Resume through the live worker

The user chose a `Resume: <title> (<id>)` row in Q1 of [pick.md](pick.md), and
the selected-entry load has run. Do this before Q2.

If the selected entry's full `notes` carry a dispatch marker this host
can still reach, try continuing that exact worker before asking anything else,
relaying the entry's full notes and any new context the user just gave — not a
summary of them:
- In Claude Code, the marker is the phrase "background agent" followed by the
  backticked id (written by [delivery-agent.md](delivery-agent.md)). Pull the
  id out and call `SendMessage` with `to: "<id>"` and a short re-brief
  (current status?, plus that context).
- In Codex, the marker is `dispatched to Codex subagent <id>`; use it only if
  the current host still knows that session or agent, through its follow-up
  capability, and inspect the result.
- In Antigravity, the marker is `dispatched to Antigravity subagent <id>`,
  reached through `manage_subagents` under the same condition.

On success, that *is* the resume — relay what the worker reports and stop
here; the worker's session closes its entry the same as any other handoff (in
Codex, through the coordinator). On any failure, a marker the other host
wrote, or no marker at all, fall back **silently** to pick.md's flow exactly as
if there were no marker — go on to its Q2 and craft the re-crafted prompt (the
resume case, its step 3) from the entry's notes. Never surface the failure itself;
the re-craft path isn't a degraded fallback, it's the original design. In
Codex, a run whose explicit review instruction remains active keeps
`reviewEachIncrement:true` and follows
[resume-increments.md](resume-increments.md); never infer review mode or
completed work from an `accepted:` prefix.
