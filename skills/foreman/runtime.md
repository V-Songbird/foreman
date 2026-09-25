# Running Foreman

Foreman runs in Claude Code, Codex and Antigravity from the same files. Every
rule here applies to every host unless a paragraph names one. A handoff adds the goal,
evidence, constraints, and completion criteria to the destination's own
instructions; it does not replace them or select a fixed model.

In Codex and Antigravity, read [the Codex and Antigravity runtime](runtime-codex.md)
right after this file. Each section here gives the shared rule and what Claude
Code does; that file adds what those two hosts do instead.

## Paths

`${CLAUDE_PLUGIN_ROOT}` in a command means Foreman's plugin root, the directory
that holds `scripts/`, `hooks/`, and `skills/`. In Claude Code the harness fills
it in. Supporting references are relative to the file that links them.

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
run `roadmap.js <verb> --help` for that verb's exact payload. Do not edit
those stores by hand.

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
  Its own handoff opens and closes its roadmap entry. Never call `mcp__ccd_session__spawn_task`: it only offers the user a chip and
  runs nothing until they click it. The session a clicked chip opens does have
  MCP tools (verified 2026-09-24, desktop app 2.7032.0).

## Bookkeeping and commits

Crafting or copying a prompt leaves its entry `planned`; the session that
actually starts the work opens it.

- In Claude Code, Foreman's hooks carry that lifecycle: creating a task whose
  description names an entry opens it, completing that task gates its close, and
  session start surfaces unfinished work.

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
Codex and Antigravity — and omit unknown values.

## Discovery

With `discoverySuggestions` on (the default), concrete findings outside the
task's scope become roadmap suggestions. In Claude Code, the commit hook raises
them after each commit.

## Trial events

Trial logging is local and opt-in: a valid call records nothing unless the
project set `trialLog`, a malformed one (an unknown event, a missing or illegal
field) fails in every project, and a failure to record never interrupts work.
Record only events
that actually occurred. `question_asked` is one question interaction the user
saw: one `AskUserQuestion` call in Claude Code, however many questions it
batches; one picker call or one plain-text question in Codex; one
`ask_question` call in Antigravity. A skipped question
is never logged. Log counts, booleans, ranks, and the writer's closed vocabulary
only; never task text, paths, or user input.
