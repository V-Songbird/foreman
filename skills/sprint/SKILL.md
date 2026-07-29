---
name: sprint
description: Experimental advanced surface, normally reached through the `foreman` entrance's run-a-short-batch intent. Works through a few ready Foreman roadmap tasks serially with one plan approval and one final acceptance.
when_to_use: Reached through the `foreman` entrance for a short batch; trigger directly when a power user asks Foreman to work through the next few roadmap tasks, batch the next tasks, run a small sprint, or invokes /foreman:sprint.
argument-hint: "<optional — task count (maximum 5) and/or what kind of work to prefer>"
allowed-tools: AskUserQuestion, Read, Write, Bash, PowerShell, TaskCreate, TaskUpdate, Workflow
---

# foreman:sprint — finish a few roadmap tasks with fewer interruptions

Use this only when the user explicitly asks for a sprint or several tasks.
It repeats Foreman's normal task path; it is not a general workflow builder.

If `ROADMAP.jsonl` is missing at the project root, tell the user to run
`/foreman:init` and stop. Never read or edit `ROADMAP.jsonl` directly.

## 1. Make the small dispatch plan mechanically

Extract a requested count and optional topic hint from the arguments. Default
to 3 tasks and never exceed 5. Run:

`node ${CLAUDE_PLUGIN_ROOT}/scripts/sprint.js plan --limit <count> [--hint "<words>"]`

Treat its ranking and grouping as authoritative. Do not survey the codebase or
rebuild the plan in the model. If `selected` is empty, report that no ready
work exists and stop.

If `runnable` is false, explain `reasons` and stop before creating tasks. A
dirty tree must be committed or stashed first, because a sprint worker makes
commits and must never absorb the developer's unfinished changes. Existing
`in_progress` entries must be resumed or closed through `/foreman:roadmap`
before starting a new batch. Entries left `awaiting_acceptance` by an earlier
batch do not block a new one — their work is committed and the tree is clean;
accepting them is a `/foreman:roadmap` step, not a sprint precondition.

Otherwise present one compact serial plan in ranked order and ask once
whether to run it. If `has_overlaps` is true, mention the compact `overlaps`
facts so the developer knows which planned areas are shared. They are
informational: execution is already serial, and the mechanical rank order
does not change.

## 2. Prepare only the next approved unit

Keep only the approved ids and their plan order. Do not fetch all full entries
or compose all handoffs up front: an earlier unit may change the facts a later
handoff needs.

Immediately before each unit, atomically revalidate its status and
dependencies while marking it as started:

`echo '{"id":"<id>","status":"in_progress","expected_status":"planned","require_ready":true}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`

Require the returned entry to be `in_progress` and not `skipped`. A skip means
the approved plan is no longer executable: report `reason` and any compact
`blocking_dependencies`, then stop before creating or dispatching the unit.
The readiness check and transition share the roadmap mutation lock, so no
dependency/status change can slip between them.

Now fetch only that unit's current full entry:

`node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --ids <id>`

Ground its handoff against the latest post-commit tree now, after every
earlier unit's commit, attestation, verification, and fold-back. Then assemble
it with one call to the same assembler the `foreman:roadmap` pick branch uses,
so a sprint worker gets the same prompt shape as every other Foreman handoff:

```
echo '{"destination":"agent","workflowStage":true,"title":"<entry title>","why":"<entry why>","what":"<entry what>","notes":"<entry notes, when non-empty>","planned_touches":[<entry planned_touches>],"depends_on":[<entry depends_on>],"judgment":{"role":"<role>","goal":"<goal sentence>","context":"<context prose>","steps":["<what to implement/fix>"],"constraints":["<hard limits, patterns to follow>"],"expectedFileSurface":"<planned_touches>","verification":[{"run":"<exact command>","expected":"<pass/fail signal>"}],"invariants":["<one observable assertion>"]}}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/craft-handoff.js
```

Pass the entry's own fields **inline**, never as `"entry":"<id>"`. That is
what omits the normal roadmap lifecycle paragraph: the sprint coordinator is
the only process allowed to change or close entries, so a worker must not be
handed the instructions to do it itself. `workflowStage: true` is the
Workflow-stage flavor — this prompt runs as a stage inside step 3's fixed
workflow. Type `${CLAUDE_PLUGIN_ROOT}` back literally in that stdin JSON; the
gate errors on a resolved plugins-cache path.

Gather the `judgment` fields from the entry exactly as the pick branch does:
`role`/`goal` from `title`/`why`, `context` from `what` plus `notes` when
non-empty, `steps`/`constraints` from `what`, `expectedFileSurface` from
`planned_touches`, `verification` as the `Run:`/`Expected:` pairs in running
order, and `invariants` from anything already asserted in `why`/`what`/`notes`.
No investigation — every field comes from the entry.

Add these sprint-only worker rules to `constraints`:

- implement and verify only this entry;
- never edit `ROADMAP.jsonl` or `CHANGELOG.md`. **This overrides the
  `<scope_discipline>` block in the assembled prompt**, which otherwise tells
  a worker to log grown scope to the roadmap itself: report it in the returned
  `notes` and stop instead. The coordinator is the only writer of either
  ledger, and step 3's attestation fails a commit that names one;
- never run `git add -A`; stage only files this unit changed, then inspect
  `git diff --cached --name-only` and stop if it names either shared ledger
  or an unrelated file;
- make one focused commit with the trailer `Foreman: <id>`;
- closure notes must cite observed files, commands, commits, or outcomes,
  never the planned `what` as execution evidence;
- return only the workflow schema fields.

The call returns `{ok, prompt, profile, signals, gate, warnings}`. Use
`prompt` verbatim as this unit's handoff and state `profile` in the plan
report. The profile is mechanical and is never a judgment call here: a fresh
unit carries no commits and no observed files, so step 2's
`planned` → `in_progress` transition above is not the `resumed` signal and the
script does not treat it as one. When `ok` is `false`, don't retry blind —
show `gate.errors`, gather the field each one names, and re-call.

Create this unit's visible task with `TaskCreate` and mark it `in_progress`.
Do not create later tasks yet. That way a stopped sprint does not mark work
that never started, and roadmap truth does not depend on a task hook
recognizing model-authored prose.

Do not add researcher, planner, or reviewer roles. Grounding happens inside
each normal implementation handoff, where it is useful.

## 3. Execute serially with a fixed, schema-checked workflow

Invoke the fixed workflow once per entry, in plan order:

`${CLAUDE_PLUGIN_ROOT}/skills/sprint/workflows/run-batch.js`

with:

```json
{
  "units": [
    {
      "entry_id": "001",
      "prompt": "<complete handoff>",
      "model": "sonnet",
      "effort": "high"
    }
  ]
}
```

Before each workflow call, capture the mechanical boundary:

`node ${CLAUDE_PLUGIN_ROOT}/scripts/sprint.js snapshot`

Keep its `head` and `state_hash`. The workflow accepts exactly one
Foreman entry per invocation. It fixes the worker type, bounds model and
effort values, and does not expose worktree or parallel controls.

The workflow enforces one small return shape per worker:
`entry_id`, `outcome`, `commit_sha`, `verification`, `notes`, and
`changelog_line`.

Wait for that invocation to finish. Do not invoke the next unit yet.
Immediately attest its boundary, before verification or any roadmap/changelog
write:

`node ${CLAUDE_PLUGIN_ROOT}/scripts/sprint.js attest --entry <id> --baseline <snapshot.head> --state-hash <snapshot.state_hash> [--commit <result.commit_sha>]`

Pass `--commit` whenever the worker returned one. Attestation must report
`ok:true`: it proves the working tree and index still match the pre-worker
state, exactly one reported worker commit is now `HEAD`, that commit is
directly based on the snapshot, it has exactly the canonical
`Foreman: <id>` trailer, and no shared ledger was committed. The state hash
covers staged and unstaged diffs plus untracked-file contents, including
coordinator ledgers that were already dirty at the snapshot. Inspect its
mechanically derived
`changed_files` against the approved entry and handoff; any unrelated path is
a failed boundary. Stop and surface all `reasons`, `forbidden_files`, or
unrelated paths before verification or fold-back.

After every boundary-valid `done` result, run the entry's real verification
again in the current tree before calling it successful. A worker's report
alone is not proof. If that rerun fails, reclassify the result as
`failed_verification` with the observed command and failure. Finish
attestation, verification, and fold-back for this unit before invoking the
next workflow; execution is strictly serial.

## 4. Fold results back as the only writer

The calling session is the only roadmap and changelog writer.

For every boundary-valid result that returned a commit, record that observed
commit without closing the entry, whether the result is successful or
partial:

`echo '<json>' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`

For a successful, boundary-valid, re-verified result, use
`{"id":"<id>","status":"awaiting_acceptance","commit":"<sha>","notes":"<observed evidence>"}`.
That is what is true: implemented, checked, waiting only on the acceptance in
step 5. For a partial or verification-failed result, use
`{"id":"<id>","status":"in_progress","commit":"<sha>","notes":"<observed reason>"}`
instead — the work is not finished, so it must not claim to be. Either way the
commit and actual touched files are preserved for acceptance or recovery. For a
successful result, keep its changelog line for final acceptance. For a partial
or verification-failed result, stop before dispatching another unit.

For `blocked`, `failed_verification`, or `conflict`, use `annotate` with the
observed reason only when no commit was returned; the commit-bearing path
above already records that evidence. Leave the entry `in_progress` — those
outcomes never reach `awaiting_acceptance`. Mark its
visible task blocked or keep it in progress; do not discard successful
siblings. Stop before dispatching another unit.

Do not annotate a boundary-invalid result: the attestation deliberately runs
before further ledger writes, preserving the exact recovery state.

Collect non-null `changelog_line` values, but do not write `CHANGELOG.md` yet.

## 5. Ask once, then close only accepted entries

Show one end-of-batch report with each entry's outcome, verification, commit,
and concise observed evidence. Ask one question that lets the user accept all
successful entries or name a subset. This final acceptance is mandatory even
when the project has `requireVerification: false`.

For each accepted id, call `update-status` with
`{"id":"<id>","status":"done"}` and mark its visible task completed. Append
only those entries' effect-only changelog lines to the project's changelog,
once, if that project uses one.

Leave unaccepted entries `awaiting_acceptance` and failed ones `in_progress`,
both with their evidence intact.
Then stage only `ROADMAP.jsonl` and the changelog if it changed, verify with
`git diff --cached --name-only` that no other path is staged, and create one
coordinator-owned `Record Foreman sprint results` commit. Put all affected
entry ids in its final `Foreman: <id, id...>` trailer. If an unexpected path
is staged, stop and ask instead of changing the index.

Report recovery state plainly. Do not create a review state, parallel path,
workflow definition, dashboard, or unattended scheduler.
