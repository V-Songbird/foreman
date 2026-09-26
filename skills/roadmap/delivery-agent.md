# Deliver: Execute with a background agent

Read this with [delivery.md](delivery.md): its shared rules and its host rule
still apply.

When the user chose it, dispatch it. The agent shares this working tree: it
never switches branches or commits checkpoints, and it inherits this session's
model — never pass one.

- In Claude Code, call `Agent` with `prompt` = the returned `prompt`,
  `description` = a 3-5 word summary, and `run_in_background: true`. The tool
  result trails with the dispatched agent's id (`agentId: a<16 hex>`). For a
  roadmap entry, capture it immediately with one annotate call, so a later
  session can resume this exact agent instead of re-crafting a prompt from its
  notes:
  `` echo '{"id":"<id>","notes":"dispatched to background agent `<agent-id>`"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js annotate ``
  (the script date-stamps each appended note itself — don't write one in). The
  phrase "background agent" followed by the backticked id is the exact marker
  grammar the resume flow parses — the id's own charset (`a` + lowercase hex)
  never needs escaping. The agent's own handoff opens and closes its entry.

  When its completion notification arrives, read what it verified
  before telling the user it finished: each `Run:`/`Expected:` result
  it reports and, for a roadmap entry, the entry's status and its
  `unverified:` lines (`roadmap.js list --ids <id>`). Call a check it
  skipped or could not run unverified, never passed. Acceptance comes
  only from the user in this session, or from the orchestrator
  `delegatedAcceptance` names for it, as
  [Close and acceptance](delivery.md#close-and-acceptance) says; the
  agent's report never gives it.
- In Codex, use the available collaboration tools for a bounded task, passing
  the returned prompt and the shared-tree ownership restriction. If delegation
  is unavailable, keep the handoff ready and explain that constraint; never
  silently replace a requested background run with a new app task. For a
  roadmap entry, append the returned agent id with `roadmap.js annotate` as
  `dispatched to Codex subagent <id>`, plus a session identifier when the host
  supplies one, so a later resume knows whether the handle can still be live.
  Wait for the agent, inspect its verification, and perform the coordinator
  bookkeeping; its completion notification is its actual return, not a
  scheduled automation. Do not imply that a shared-tree subagent survives the
  host session.
- In Antigravity, the same steps run through `invoke_subagent`, followed with
  `manage_subagents`; the annotate marker is `dispatched to Antigravity
  subagent <id>`.

## Explicit new Codex task

In Codex, when the user explicitly chooses a new app task, use the available
app task creation tools, their real project inventory, and their documented
worktree default. Pass the complete checked prompt and preserve the user's
branch restrictions. Report the created task through the app's returned
reference. If those tools are absent, supply a prompt file for the user to
paste. This is an explicitly requested extension, not a replacement for
background agents.
