# Running Foreman in Codex

Foreman supplies task context and its roadmap workflow within the destination's
active Codex instructions. Honor applicable `AGENTS.md` files, the current mode,
available tools, and existing authorization. A handoff adds the goal, relevant
evidence, constraints, and completion criteria; it does not replace those
instructions, select a fixed model, or assume another host's tool APIs. Leave
general planning and tool use to Codex's native behavior; carry a specific
sequence only when the task or Foreman's bookkeeping requires it.

Resolve the plugin root from the loaded skill's actual location: a skill at
`<plugin-root>/skills/<name>/SKILL.md` belongs to `<plugin-root>`. Supporting
references are relative to the file that links them. Do not assume the shell
defines a plugin-root variable. In command examples, replace `<plugin-root>`
with that resolved absolute path and quote it appropriately for the active
shell. The project directory is separate: scripts resolve
`FOREMAN_PROJECT_DIR`, then `CODEX_CWD`, then the legacy project override,
then the shell working directory. Run commands in the user's project.

For JSON payloads, prefer a real JSON file or safely quoted stdin. Never
interpolate user text into a shell command. On PowerShell, a literal here-string
or a JSON payload file avoids shell evaluation; on other shells use a quoted
heredoc or file. Use the available execution and patch tools rather than
inventing tools named in a different host.

Every roadmap, archive, or lesson-store mutation goes through
`node "<plugin-root>/scripts/roadmap.js" <verb>`. The same CLI owns reads,
id allocation, validation, locking, migration, and compare-and-set guards.
Read [the schema](../../roadmap-schema.md) only when a field needs explanation.
Use `--help` for exact payloads. Do not edit those stores by hand.

## Intent and questions

An explicit request to add, correct, defer, archive, or restore specified work
already authorizes that mutation. Use the context and show the concrete result;
do not ask for the same permission again. Ask for missing information only
when it changes the outcome. Inferred new work, unresolved product choices,
destructive replacement, and final acceptance need the user's decision unless
the current conversation already provides it.

For task and execution preferences, use the selectable picker and answer
handling in [questions.md](questions.md). These are workflow choices, not
permission requests: ask directly without saying Foreman requires a question
or citing a skill as the reason to choose. Honor choices already supplied.
For actual permissions or other missing information, follow the active host's
input rules. Do not assume an unanswered optional interview was approval.

Survey findings must be concrete and individually reviewable. An explicit
instruction to apply grounded repairs can authorize them; a request to inspect
alone cannot. Acceptance is distinct from implementation completion:
`requireVerification` defaults to true, so finished work records
`awaiting_acceptance` until the user accepts it. Never interpret a test passing,
a subagent finishing, or a new pick request as that acceptance.

## Work and delegation

Honor the user's destination, or ask Foreman's shared destination question
before crafting the handoff. For the chosen destination, use available
collaboration subagents for concrete independent subtasks alongside useful
coordinator work. Give each bounded scope, relevant evidence, expected output,
and verification. Inherit model and reasoning settings unless the user chose
otherwise. Wait for completion, inspect results, and integrate them before
claiming the task done. If optional internal delegation is unavailable, handle
that subtask locally. If the user selected a background destination, disclose
unavailable delegation and offer a prompt artifact or another destination;
do not start local execution without the user's choice.

Subagents and user-owned Codex tasks are different destinations. Create a new
sidebar task only when the user explicitly requests one. Use the available
app task tools and their documented project/worktree rules; prepare a portable
prompt file if those tools are unavailable. A subagent id can be resumed only
while the current host still knows it. Never treat a stored id as a guarantee
of cross-session persistence; re-craft from the entry's notes when unavailable.

Subagents sharing a working tree must not switch branches, stage shared files,
or commit coordinator checkpoints. Parallelize only independent file ownership.
The coordinator owns integration, roadmap transitions, and final acceptance.
Do not silently widen into a new roadmap entry or create an app task as a
workaround for an unavailable subagent.

## Bookkeeping and commits

At a flow's entrance, surface unfinished or awaiting work from compact CLI
reads when the session-start hook has not already done so. Read lessons for the
task's paths with `roadmap.js notes --paths <comma-joined paths>` when useful;
ordinary shell reads are not guaranteed to trigger automatic recall.

When execution of a selected entry actually begins, use
`node "<plugin-root>/hooks/codex-task.js" start --id <id>` to open it through
the native checkpoint. Proceed only after exit 0 and `dispatchReady:true`.
Blocked, deferred, or terminal work is not dispatchable; inspect the returned
reason and refresh the selected entry instead of bypassing the check.
Crafting or copying a prompt alone leaves it planned.
Before reporting a completed entry, use the companion `check --id <id>`;
planned or in-progress means its work has not been recorded as closed yet.
A failed explicit check arms the optional Stop reminder for this session;
opening a task alone does not register an attempt to finish.
The host's supported hooks add assistance, but explicit lifecycle calls remain
part of the flow. A warning is not evidence of completion or acceptance.

Respect the user's branch restrictions before every mutation. Never switch,
merge, or commit on a protected branch; if a writable branch is needed, create
a `codex/<descriptive-name>` branch within the authorized repository first.
Keep parent repositories and submodule pointers outside the task untouched.

For task commits, use `scripts/safe-commit.js begin` before changes and
`finish` after verification, with the returned baseline and owned file surface.
A dirty start without a baseline means no automated commits. The CLI tolerates
its own shared bookkeeping dirt; do not treat unrelated changes as task-owned.
A moved HEAD, unexpected files, or failed staging needs inspection, never a
broader staging command. Explicitly authorized surface changes can update the
owned set; unrelated user work remains outside it.

Every roadmap-owned commit carries the exact final trailer `Foreman: <id>`.
For a staged close, `finish --no-commit` stages owned work, `update-status` with
`staged:true` includes the close, then commit the resulting staged files with
that trailer. A commit cannot contain its own SHA; the trailer is its evidence.
Record follow-up commits without changing `awaiting_acceptance` to `done`.
Record only actual model/effort values known from the executing environment;
omit unknown values.

After a commit, if the automatic hook did not provide bookkeeping, use
`list --status in_progress,awaiting_acceptance --summary` to identify relevant
entries. Record only work that this commit actually implements.

## Discovery during execution

Retain concrete bugs, design ideas, optimization opportunities, and other
improvements observed outside the selected task's scope. Before reporting
completion, review them even for investigations and work without a commit.
Read [discovery.md](discovery.md) for the user choices and duplicate handling.
The `start` and `check` checkpoint results carry the same discovery reminder;
act on it rather than treating successful exit as the entire close protocol.

## Trial events

Trial logging is local and opt-in. Record only events that actually occurred;
do not synthesize interactions for a skipped question or a recommendation the
user did not see. Each branch names its events. Log counts, booleans, ranks,
and the writer's closed vocabulary only; never task text, paths, or user input.
Failures to record never interrupt work. The writer handles disabled logging.
