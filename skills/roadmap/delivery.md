# Deliver a checked handoff

Use the `prompt` and optional `tasks[]` returned by `craft-handoff.js`. Preserve
the requested `reviewEachIncrement` choice and each row's attached checks; one
mixed row is one increment. Do not
reassemble canonical sections or split rows by hand. Explain the selected
task's effect and reason in one or two plain sentences; keep raw XML in the
artifact or tool payload unless the user asks to see it.

## Execute here

Work the prompt directly. If the host has a plan tool, it may track progress,
but it does not replace the roadmap lifecycle. Open a selected entry when work
starts using the runtime's lifecycle CLI, verify the result, and record its
outcome and evidence before reporting completion.

For split by check, use the returned `tasks[]` in order. Each verification
boundary must verify the work assigned to its row. The first row carries the
full prompt, and the last row alone carries the entry close. Maintain that
ordering with a supported plan tool or an explicit local sequence; there is no
assumed native task-dependency API.

When `reviewEachIncrement:true` is present, follow the
[increment review protocol](increment-review.md) after every result. The same
protocol is embedded in the generated prompt, including for one reviewed row.
Keep the current result pending until a real answer arrives. A passing check
or successful question submission does not permit the next row or parent close.
When resuming, follow [resume-increments.md](resume-increments.md) before
dependent work. The generated `increment_resume` block contains the complete
selected notes and the same recovery protocol. Refresh the entry and inspect
current artifacts; retain existing work and revalidate uncertain acceptance.

An investigation (`judgment.question`) uses split rows to collect diagnostic
evidence. Skip implementation checkpointing, branch creation for checkpoints,
staging, and commits; a failed check remains evidence. Preserve the explicit
research scope and record only its authorized Foreman lifecycle bookkeeping.
For a decision, checkpoint only explicitly authorized decision artifacts;
diagnostics never authorize implementation changes.

Read [the template's checkpoint protocol](../../prompt-template.md) before an
implementation split run or a run producing authorized decision artifacts.
It owns the boundary, branch, safe commits, final staged close, and
finish policy. Checkpointing remains optional on dirty trees; the work can
continue without commits. Preserve `checkpoints:{baseBranch,branch,onFinish}`
from the project configuration and its first-relevant finish-policy question.
A branch restriction supplied by the user overrides every configured finish
policy: keep the branch when merging would write a protected branch.

## Background agent

Use the available collaboration tools for a bounded task, passing the returned
prompt and the shared-tree ownership restriction. Inherit the model and
reasoning effort. Delegate only when useful coordinator work can proceed
alongside it; otherwise keep the handoff ready and explain the capability
constraint. Never silently replace a requested background run with a new app task.

When an entry is involved, append its returned agent id with `roadmap.js
annotate` as `dispatched to Codex subagent <id>`. Store a session identifier if
the host supplies one, so a later resume knows whether the handle can still be
live. Reuse a live agent with the available follow-up tool; otherwise re-craft
from durable notes. Do not imply that a shared-tree subagent survives the host
session. Wait for the agent, inspect its verification, and perform coordinator
bookkeeping. Completion notification is its actual return, not a scheduled
automation or a promise to keep working after the session ends.

## Clipboard or prompt file

Save the prompt to a UTF-8 temporary file first. Never interpolate the prompt
into a shell string. Only when the user selected clipboard, pipe the file to
`Set-Clipboard` on Windows, `pbcopy` on macOS, or an available `wl-copy`/`xclip`
on Linux. A prompt-file-only request skips clipboard access. Quote the path for the active
shell, preserve Unicode, and report the file's absolute path as a fallback.
Claim "copied" only after a successful clipboard operation. If none is available,
deliver the file link; a fenced prompt is a fallback when no usable file can
be delivered. Include the schema artifact too for a structured-output handoff.

A portable prompt must resolve the plugin available to its executing session.
Follow the builder's relocation instructions; do not bake a nonexistent
host variable into a command or assume another machine has this installation.
Copying does not mark the entry in progress. For an explicitly reviewed run,
keep the embedded `increment_review` block intact even when there is only one
row and no multi-row checkpoint block. A missing question tool uses textual
conversation; without a human or coordinator channel the pasted worker leaves
the result pending and stops.

## Explicit new Codex task

When the user explicitly chooses a new app task, use available app task
creation tools, their real project inventory, and their documented worktree
default. Pass the complete checked prompt and preserve the user's branch
restrictions. Report the created task through the app's returned reference.
If those tools are absent, supply a prompt file for the user to paste. This is
an explicitly requested extension, not a replacement for background agents.

## Close and acceptance

Record observed files, commands, commits, outcomes, and any `unverified:` checks
in entry notes. If ledger is enabled, a useful lesson is one factual sentence
anchored to the task's actual files, within the writer's length limit. Do not
fabricate a lesson to fill a field.

For an explicitly reviewed run, intermediate decisions use `annotate` and keep
the parent open. Do not apply this whole-task close while a row is awaiting
review or correction; follow [increment review](increment-review.md).
Use [close-increments.md](close-increments.md) to reconcile omitted checks with
later evidence for the same result and distinguish last-row acceptance from
acceptance of the integrated task. The prompt embeds that same close protocol.

With `requireVerification:true`, completed implementation becomes
`awaiting_acceptance`; summarize evidence and ask the user to accept or review.
When checks remain unverified after that evidence comparison, offer testing
those checks first and keep the entry awaiting. An explicit acceptance closes it; feedback that work is not ready
returns it to `in_progress` with the feedback recorded. A background worker
leaves acceptance to its coordinator. No new task is started while a required
acceptance decision is pending unless the user explicitly chooses separate work.
