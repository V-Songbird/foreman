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
on a work branch, and the user chooses the finish action. A task-closing commit
carries the exact `Foreman: <id>` trailer; intermediate `task n/total` checkpoints
omit the parent-close id and do not close the entry. Commit evidence and actual touched files are recorded;
the original planned surface remains separately correctable.

The default `requireVerification: true` leaves implemented work
`awaiting_acceptance`. A user's acceptance closes it; rejection or more work
resumes it. Completion evidence says what shipped, what was checked, and what
remains. A worker's success report alone does not prove acceptance.

## Review between increments

After updating the installed plugin, start a new Codex task so its current skills
are loaded. Ask explicitly, for example: “Foreman, ejecuta esta tarea aquí por
incrementos y espera mi aprobación después de cada resultado.” The skill turns
that explicit request into the top-level transient
`reviewEachIncrement:true` assembler input. It is not a stored preference. An
ordinary split, or an absent/false flag, keeps its existing behavior; the script
does not interpret natural language to switch modes.

One `judgment.verification` row represents one meaningful result. Creating its
files and checking them are internal steps, not extra increments. Rows support
three forms: automatic checks (`run` plus `expected`), human checks (`review.action`
plus `review.expected`), or both pairs together. At least one complete pair is
required. Only commands enter command preflight; a human-only result needs no
invented command. `review` is the input field; `Look:` is its rendered label.
In an explicitly reviewed run, **every row needs `review`**, including results
that automated checks can verify. A mixed row counts once when splitting or
considering checkpoints and destinations.

A tracked feature remains one roadmap entry. Its increments are execution rows
whose evidence goes into that entry's notes. For example, a sign-in feature can
deliver a usable form, authentication and error handling, then sign-out and
integrated verification. Approve a result, request changes to it, or pause before
its dependent successor.

This small entry-less payload reviews a documentation result in this checkout:

```json
{
  "title": "Clarify the review example",
  "why": "Readers need to know when execution waits for them.",
  "what": "Clarify the review example in HOW-IT-WORKS.md.",
  "touches": ["HOW-IT-WORKS.md"],
  "destination": "clipboard",
  "reviewEachIncrement": true,
  "judgment": {
    "role": "a documentation editor",
    "goal": "to make the review example clear and actionable",
    "context": "This is the Codex-only reviewed-increment workflow.",
    "steps": ["Read the existing example and clarify its wait behavior."],
    "constraints": ["Keep the existing task acceptance policy."],
    "verification": [{
      "goal": "Explain the wait before the next result",
      "files": ["HOW-IT-WORKS.md"],
      "review": {
        "action": "Read the revised review example",
        "expected": "You can tell when to accept, request changes or pause; no installation is included"
      }
    }]
  }
}
```

This human-only row is valid without `run` or its sibling `expected`. Add a real
`run`/`expected` pair to the same row when that result also needs automated
evidence. For an ordinary automatic-only row, omit `review` and do not enable
`reviewEachIncrement`. Set `destination:"task", split:true` for a requested local
split. Keep the user's chosen destination; exporting a clipboard prompt does
not start work or accept anything, and even one reviewed row carries the pause.

The executor implements the current increment and runs its required checks,
then presents the result, limits, evidence and review action. It offers
**Accept / Request changes / Pause** and waits for an actual answer before
dependent work. Passing tests, elapsed time and question-tool acknowledgments
are not answers. Requested changes keep the increment open; after two failed
fix attempts, report and pause. Without a question tool, use conversation.
Without a human or relay coordinator channel, preserve the pending result and
stop. A worker returns its result to its coordinator, who handles the human
review and shared bookkeeping. Background execution alone supplies no answer.

The coordinator records brief observed decisions and concrete work references
in existing entry notes using `roadmap.js annotate`; an entry-less run uses its
conversation or existing handoff. Explicit user permission to continue without
a review records that check as `unverified:` (omitted), never `accepted:`.
Acceptance notes and eligible safe checkpoints are separate operations; a dirty
start can continue without commits. Intermediate acceptance keeps the parent
open. Verify the integrated result and apply the existing final close policy;
only a decision explicitly covering both the last result and the whole task
accepts them together.

Recovery is assisted: read the complete entry notes and inspect current work,
including actual referenced artifacts or commits. Continue from corroborated
acceptance; do not skip merely because a note starts with `accepted:` or a row
number matches. Changed work, missing references, ambiguous scope or a late
answer require revalidation. Preserve both omission and later resolution notes,
matching them to the specific check. `annotate` appends on every call, so reread
after an uncertain outcome before retrying. This is not automatic exact replay
or a separate increment store. Older clients can read format 2 while ignoring
the protocol; format compatibility does not establish equivalent behavior.

For closure, compare each historical `unverified:` check with later evidence for
that same result. Append `verification resolved:` when the comparison supports
resolution, preserving the original note. Offer Test first only for checks still
unverified; an unrelated acceptance cannot clear them. The detailed contracts are
[preparation](skills/roadmap/prepare-increments.md),
[review](skills/roadmap/increment-review.md),
[recovery](skills/roadmap/resume-increments.md), and
[integrated close](skills/roadmap/close-increments.md).

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
