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
- In Codex, a `paused:` or `review pending:` note may instead name
  `Codex session <id>` (written by
  [increment-review.md](increment-review.md)). That session still holds the
  presented result and its subagent. Offer the person
  `codex exec resume <id> -` before re-crafting anything, and say that the
  `-` reads their decision from standard input: they type or paste it, then
  end input with Ctrl+D in a POSIX shell, Git Bash included, or Ctrl+Z and
  Enter in PowerShell or cmd. If
  they take it, stop here. If they decline, record the decline with
  `roadmap.js annotate` as the note
  `resume declined: codex exec resume <id>`, then fall back as below. The
  re-crafted handoff carries that note, so it does not offer the command
  again.
- In Antigravity, the marker is `dispatched to Antigravity subagent <id>`,
  reached through `manage_subagents` under the same condition.

On success, that *is* the resume. When the worker reports it finished, read
what it verified before relaying that, as
[delivery-agent.md](delivery-agent.md) says for a completion notification:
each `Run:`/`Expected:` result it reports, and the entry's status and its
`unverified:` lines (`roadmap.js list --ids <id>`). Call a check it skipped
or could not run unverified, never passed; acceptance still comes only from
the user in this session, or from the orchestrator `delegatedAcceptance`
names for it. Then stop here; the worker's session closes its
entry the same as any other handoff (in Codex, through the coordinator). On any failure, a marker the other host
wrote, or no marker at all, fall back **silently** to pick.md's flow exactly as
if there were no marker — go on to its Q2 and craft the re-crafted prompt (the
resume case, its step 3) from the entry's notes. Never surface the failure itself;
the re-craft path isn't a degraded fallback, it's the original design. In
Codex, a run whose explicit review instruction remains active keeps
`reviewEachIncrement:true` and follows
[resume-increments.md](resume-increments.md); never infer review mode or
completed work from an `accepted:` prefix.
