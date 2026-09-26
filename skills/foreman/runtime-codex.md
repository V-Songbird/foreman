# Running Foreman in Codex and Antigravity

Read this right after [the shared runtime](runtime.md), in Codex and
Antigravity only. It holds the rules those two hosts follow and Claude Code
does not; every rule in the shared runtime still applies.

## Paths

`${CLAUDE_PLUGIN_ROOT}` is Foreman's plugin root, as the shared runtime
defines it. In Codex and Antigravity, resolve it from the loaded skill's actual location: a skill at
`<plugin-root>/skills/<name>/SKILL.md` belongs to `<plugin-root>`. Replace the
variable with that absolute path and quote it for the active shell; do not
assume the shell defines a plugin-root variable.

## Questions

- In Codex, use the picker and answer handling in [questions.md](questions.md).
- In Antigravity, ask with `ask_question`: each option is the answer the user
  would give, label first, then a short description. The tool adds its own
  free-text option, so never author one, and allow several selections only
  when the choices combine. Where a step names `AskUserQuestion` or the Codex
  picker, this is the tool Antigravity uses in its place.

## Work and delegation

- In Codex, honor applicable `AGENTS.md` files, the current mode, available
  tools, and existing authorization, and leave general planning and tool use to
  Codex's native behavior. Inside the chosen destination, use available
  collaboration subagents for concrete independent subtasks alongside useful
  coordinator work, giving each a bounded scope, relevant evidence, expected
  output, and verification; wait for them and integrate their results before
  claiming the task done. If optional internal delegation is unavailable, handle
  that subtask locally. If the user selected a background destination that is
  unavailable, disclose it and offer a prompt artifact or another destination;
  do not start local execution without the user's choice. Subagents and
  user-owned Codex tasks are different destinations.
  Create a new sidebar task only when the user explicitly requests one.
  A subagent id can be resumed only
  while the current host still knows it. A subagent stages and commits nothing;
  the coordinator owns integration, roadmap transitions, and final acceptance.
- In Antigravity, a background agent is an `invoke_subagent` worker given the
  returned prompt and the shared-tree restriction; follow it with
  `manage_subagents`, wait for its result and integrate it as the coordinator,
  under the same ownership rules as Codex.

## Bookkeeping

- In Codex, when execution of a selected entry begins, run
  `node ${CLAUDE_PLUGIN_ROOT}/hooks/codex-task.js start --id <id>` and proceed
  only after exit 0 and `dispatchReady:true`. Blocked, deferred, or terminal work
  is not dispatchable; inspect the returned reason instead of bypassing the
  check. Before reporting a completed entry, run the companion `check --id <id>`;
  a failed check arms the optional Stop reminder for this session. At a flow's
  entrance, surface unfinished or awaiting work from compact CLI reads when the
  session-start hook has not already done so, and read lessons for the task's
  paths with `roadmap.js notes --paths <comma-joined paths>` when useful. After a
  commit the hook did not handle, use
  `list --status in_progress,awaiting_acceptance --summary` to find the entries
  it implements. Hooks add assistance, but these explicit calls remain part of
  the flow, and a warning is not evidence of completion or acceptance.
- In Antigravity, follow the Codex lifecycle above: `hooks/codex-task.js
  start` when execution of a selected entry begins, `check` before reporting a
  completed entry. No hook opens or closes an entry there and no stop reminder
  exists, so those explicit calls are the whole lifecycle. The session notice
  and a commit's reminders reach the model at its next call, not at the moment
  of the command. When a Foreman message names a `--session` value for this
  conversation, pass it to every `start` and `check`.

## Discovery

The shared runtime's discovery suggestions reach these hosts differently: in
Antigravity, a commit's reminder arrives at the next model call. In Codex and
Antigravity, follow [discovery.md](discovery.md) before reporting completion,
including investigations and work without a commit; the `start` and `check`
results carry the same reminder.
