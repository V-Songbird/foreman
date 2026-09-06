# How Foreman works in Codex

Foreman keeps the plan in `ROADMAP.jsonl`, with optional configuration, archived
entries, and notes under `.foreman/`. The JavaScript CLI owns roadmap writes:
it validates dependencies and IDs, locks mutations, checks stale-read guards,
and writes atomically. Skills supply the judgment and conversation.

## Selection and confidence

**Fast pick** reads the roadmap and ranks ready work by downstream work unblocked,
direct dependents, lack of collision with in-flight planned file surfaces, and
age. A hint reranks ready candidates, retaining the normal list when nothing
matches. Existing in-progress work and entries awaiting acceptance are offered
first; the user may still choose new work. Fast pick does not silently turn
into a repository survey.

**Reconcile and pick** first checks the relevant code against the plan, presents
grounded findings and corrections, then selects from the resulting roadmap.
Uncertain findings remain uncertain. Structural `doctor` checks are a separate,
cheap operation; they do not claim to verify implementation.

## Crafting and delivery

After a task is chosen, the builder resolves its expected files and symbols,
examines available patterns and history, renders optional project context, and
checks the assembled prompt. Missing planned files are distinguished from
invented existing files. The task's own reason, acceptance checks and boundaries
travel with the handoff.

Foreman preserves its standard/reinforced profiles and the destination choice:
one unit here, units split by acceptance check, background delegation, or an
exported prompt. A destination already specified by the user is honored without
another question. Codex's available tools determine what can run in that host.

Codex subagents get bounded tasks and explicit ownership. The coordinator
integrates and verifies their output, and serializes shared roadmap mutations.
Long-lived sidebar tasks and detached automation are not assumed to be subagents;
creating either requires the corresponding user request.

## Execution and acceptance

Starting actual work opens the selected entry through the Codex lifecycle
helper. Exporting a prompt leaves its entry planned. Dependencies are rechecked
at dispatch. An explicit unresolved completion `check` arms the optional `Stop`
reminder in that session/agent scope. The hook consumes that attempt once; a
normal turn ending or unrelated unfinished work does not arm it.

Safe commits begin with an ownership baseline. Foreman stages only declared,
owned changes, preserving pre-existing dirty work. Split checkpoints remain local
on a work branch, and the user chooses the finish action. Commits carry an exact
`Foreman: <id>` trailer. Commit evidence and actual touched files are recorded;
the original planned surface remains separately correctable.

The default `requireVerification: true` leaves implemented work
`awaiting_acceptance`. A user's acceptance closes it; rejection or more work
resumes it. Completion evidence says what shipped, what was checked, and what
remains. A worker's success report alone does not prove acceptance.

## Continuity

Session hooks surface unfinished work and opportunities to archive old terminal
entries. Post-commit hooks prompt evidence bookkeeping. The optional ledger
serves relevant lessons with freshness information, and can retire contradicted
notes without deleting history. Codex file-tool coverage is documented in
[CODEX.md](CODEX.md); prompt-time recall remains available without hooks.

## Skills and standalone scripts

| Skill | Responsibility |
| --- | --- |
| `foreman` | Route a plain-language Foreman request |
| `init` | Initialize or explicitly reinitialize a project's roadmap |
| `roadmap` | Add, correct, inspect, diagnose, select and manage work |
| `survey` | Compare tracked work with code evidence |
| `craft-prompt` | Craft a one-off or current-task handoff |

Scripts run with Node.js, no npm dependencies or server. Run them from the
target project, or set `FOREMAN_PROJECT_DIR` for an explicit target. Read the
[schema](roadmap-schema.md), [settings](settings.md), and [Codex port notes](CODEX.md)
for the exact data and integration contracts.
