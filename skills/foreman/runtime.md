# Running Foreman

Foreman runs in Claude Code and in Codex from the same files. Every rule here
applies to both hosts unless a paragraph names one. A handoff adds the goal,
evidence, constraints, and completion criteria to the destination's own
instructions; it does not replace them or select a fixed model.

## Paths

`${CLAUDE_PLUGIN_ROOT}` in a command means Foreman's plugin root, the directory
that holds `scripts/`, `hooks/`, and `skills/`. In Claude Code the harness fills
it in. In Codex, resolve it from the loaded skill's actual location: a skill at
`<plugin-root>/skills/<name>/SKILL.md` belongs to `<plugin-root>`. Replace the
variable with that absolute path and quote it for the active shell; do not
assume the shell defines a plugin-root variable. Supporting references are
relative to the file that links them.

The project directory is separate: scripts resolve `FOREMAN_PROJECT_DIR`, then
`CODEX_CWD`, then `CLAUDE_PROJECT_DIR`, then the shell working directory. Run
commands in the user's project.

## JSON payloads

Commands show their JSON after `echo` for readability. Never interpolate
user-written text into a shell command: send that JSON through a quoted heredoc
(`<<'EOF'`), a PowerShell literal here-string (`@'...'@`), or a UTF-8 payload
file piped to the script. Use the execution and patch tools the host actually
provides rather than tools named for the other host.

## Roadmap stores

Every roadmap, archive, or lesson-store read and mutation goes through
`node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js <verb>`. The same CLI owns id
allocation, validation, locking, migration, and compare-and-set guards. Read
[the schema](../../roadmap-schema.md) only when a field needs explanation, and
use `--help` for exact payloads. Do not edit those stores by hand.

## Intent and questions

An explicit request to add, correct, defer, archive, or restore specified work
already authorizes that mutation. Do it, show the concrete result, and do not
ask for the same permission again. Ask when Foreman inferred or proposed the
change, when the request leaves the target or the new value open, or when the
change would go beyond what the user named. Inferred new work and unresolved
product choices need the user's decision unless the current conversation
already provides it; destructive replacement and final acceptance always need
the user's own explicit decision.

Ask workflow choices directly, without saying Foreman requires a question or
citing a skill as the reason to choose. Honor choices already supplied, and do
not treat an unanswered question as approval.

- In Claude Code, ask with `AskUserQuestion`: at most four options per question,
  each a label plus a description. It appends its own free-text option, so never
  author one.
- In Codex, use the picker and answer handling in [questions.md](questions.md).
- With no usable question tool, ask one self-contained plain-text question and
  never refer to options the user cannot see.

Acceptance is distinct from implementation completion: `requireVerification`
defaults to true, so finished work records `awaiting_acceptance` until the user
accepts it. Never interpret a test passing, a subagent finishing, or a new pick
request as that acceptance.

## Work and delegation

Honor the user's destination, or ask Foreman's shared
[destination question](../roadmap/destination-question.md) before crafting the
handoff. A background agent shares this working tree: it must not switch
branches or commit checkpoints. It inherits the model and
reasoning settings unless the user chose otherwise.

- In Claude Code, a background agent is an `Agent` call with
  `run_in_background: true` and no `model`, dispatched without `isolation`.
  Its own handoff opens and closes its roadmap entry. Never call `mcp__ccd_session__spawn_task`: tasks spawned through it don't get
  MCP tools.
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

## Bookkeeping and commits

Crafting or copying a prompt leaves its entry `planned`; the session that
actually starts the work opens it.

- In Claude Code, Foreman's hooks carry that lifecycle: creating a task whose
  description names an entry opens it, completing that task gates its close, and
  session start surfaces unfinished work.
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

Respect the user's branch restrictions before every mutation. Never switch,
merge, or commit on a protected branch — one the user said not to modify, or
one the host or repository marks as protected; if a writable branch is needed,
create a descriptive branch first (`codex/<descriptive-name>` in Codex). Keep parent
repositories and submodule pointers outside the task untouched.

Task commits use `scripts/safe-commit.js`: `begin` before changes and `finish`
after verification, with the returned baseline and the owned file surface. A
`dirty:true` start means no automated commits; Foreman's own bookkeeping comes
back under `ledger_dirty` and does not count. A moved HEAD, unexpected files, or
failed staging needs inspection, never a broader staging command.

Every roadmap-owned commit carries the exact final trailer `Foreman: <id>`. For
a staged close, `finish --no-commit` stages the owned work, `update-status` with
`staged:true` includes the close, then one commit carries that trailer. Record
follow-up commits without changing `awaiting_acceptance` to `done`. Record
model and effort only as the executing environment knows them — a Claude family
label (`haiku`, `sonnet`, `opus`, `fable`) in Claude Code, the exact model id in
Codex — and omit unknown values.

## Discovery

With `discoverySuggestions` on (the default), concrete findings outside the
task's scope become roadmap suggestions. In Claude Code, the commit hook raises
them after each commit. In Codex, follow [discovery.md](discovery.md) before
reporting completion, including investigations and work without a commit; the
`start` and `check` results carry the same reminder.

## Trial events

Trial logging is local and opt-in: every call is a no-op unless the project set
`trialLog`, and a failure to record never interrupts work. Record only events
that actually occurred. `question_asked` is one question interaction the user
saw: one `AskUserQuestion` call in Claude Code, however many questions it
batches; one picker call or one plain-text question in Codex. A skipped question
is never logged. Log counts, booleans, ranks, and the writer's closed vocabulary
only; never task text, paths, or user input.
