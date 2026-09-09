# Foreman scope

Foreman is the install-and-forget project coordinator for solo developers.
It remembers the plan, finds the next useful task, prepares grounded work,
and keeps the roadmap honest without requiring project-management expertise
or "agent engineering."

## Product promise

Install Foreman, initialize the project once, then speak naturally.

Foreman should make a long-running software project feel continuous across
otherwise disconnected coding sessions. The developer should not need to
learn a task methodology, design an agent workflow, maintain an external
service, or understand how Foreman coordinates the work underneath.

Foreman is deliberately cheap in several ways:

- **Cheap to adopt:** one installation and one project initialization.
- **Cheap to understand:** plain-language requests instead of process
  vocabulary, workflow diagrams, or agent roles.
- **Cheap to run:** deterministic scripts and hooks do work that does not
  require model judgment.
- **Cheap to maintain:** state stays in the repository; there is no server,
  database, account, or dashboard.
- **Cheap to recover:** the roadmap, Git, task notes, and checkpoints survive
  interrupted sessions.
- **Cheap in attention:** Foreman asks only when the developer must make a
  real decision.

Simple is an experience requirement, not a capability limit. Foreman should
feel simple because it handles the bookkeeping correctly underneath.

## Who Foreman is for

Foreman is primarily for a solo developer who:

- works on projects that outlive one coding session;
- wants reliable continuity without adopting a project-management system;
- wants help deciding what to work on next;
- wants a grounded handoff without becoming good at prompt engineering;
- may use background agents, but does not want to design agent workflows;
- values low token use, predictable behavior, and repository-owned state.

Small teams may still find Foreman useful, but team administration is not the
product's design center.

## The jobs Foreman owns

Foreman owns the narrow path from intent to completed work:

1. Keep a durable, readable record of planned work.
2. Derive which work is ready, blocked, or likely to collide.
3. Recommend the next useful task consistently.
4. Turn a roadmap entry into a grounded, mechanically checked handoff.
5. Hand that work off — in this session, to a background agent, or to the
   clipboard — without exposing the machinery.
6. Checkpoint and resume interrupted work.
7. Reconcile completed work back into the roadmap and Git.
8. Preserve task-specific findings and important decisions for later work.

The developer owns goals, meaningful product and technical decisions,
verification, and final acceptance. Foreman owns the bookkeeping around those
decisions.

## Experience contract

New capability must preserve these expectations:

- Foreman works after `/foreman:init` without further configuration.
- Natural language remains the primary interface.
- Defaults cover the normal path; configuration is an escape hatch.
- Advanced behavior appears as a simple outcome, not a new system to learn.
- The roadmap and normal repository files remain the source of truth.
- A missing optional integration reduces convenience, not correctness.
- Foreman never requires an external service or account.
- Foreman never silently changes project intent.
- Destructive or judgment-bearing changes still require the developer.
- Repeated operations are safe whenever they can be made safe mechanically.

An advanced implementation is acceptable when its complexity stays inside
scripts and hooks. It is not acceptable when the developer must understand or
maintain that complexity.

## Mechanical-first rule

If a result can be computed from `ROADMAP.jsonl`, Git, the working tree, or
Foreman's configuration, code should compute it.

Scripts and hooks should own:

- parsing and validating roadmap state;
- dependency filtering and cycle detection;
- candidate ranking;
- file-collision checks;
- exact duplicate detection;
- safe and idempotent writes;
- changed-file derivation;
- scope-drift comparison;
- prompt structure validation;
- compact payload shaping;
- checkpoint bookkeeping;
- immediate graph facts such as newly unblocked or stranded tasks.

The model should be reserved for:

- understanding the developer's intent;
- writing a useful task description from incomplete natural language;
- resolving genuine ambiguity;
- judging whether observed work satisfies the developer's goal;
- making technical decisions that cannot be derived from repository state.

Moving a behavior into code is valuable when it makes the result cheaper,
more predictable, or harder to corrupt. Moving it into code merely to make
the implementation look sophisticated is not.

## Product boundaries

Foreman may borrow useful mechanics from larger project and agent systems, but
it does not inherit their product scope.

### Lightweight project coordination, not project-management software

Foreman may improve dependency reasoning, roadmap consistency, and task
selection. It does not need teams, assignments, estimates, dashboards,
ceremonies, reporting hierarchies, or a taxonomy users must maintain.

### Project memory, not a knowledge database

Foreman keeps task notes, decision documents, source anchors, and links to
normal project documentation. It does not need a wiki, folder system,
semantic search service, note taxonomy, or automatic knowledge graph.

Only the selected task's detailed notes should enter a handoff — plus capped,
staleness-labeled lesson lines from closed tasks whose observed files intersect
the task's planned files. Dependency decisions should enter as bounded
pointers. General project knowledge remains in the project's existing files and
is found through truth-grounding.

### Verification support, not a review platform

Foreman requires grounded verification, records scope drift, and can craft a
review-shaped task. It does not own pull-request review, reviewer personas,
multi-lens review pipelines, or merge approval.

### One task at a time, not a workflow framework

Foreman hands off one task, checkpoints it, and resumes it after an
interruption. It does not run batches, and it does not provide workflow
definitions, configurable agent pipelines, researcher/planner/reviewer role
systems, or a general-purpose multi-agent runtime.

The intended execution loop is:

```text
pick -> ground -> execute -> verify -> checkpoint -> close -> repeat
```

## Feature admission test

A proposed feature belongs in Foreman when the answer is "yes" to most of
these questions, especially the first four:

1. Does a solo developer encounter the problem regularly?
2. Can Foreman solve it from the roadmap, Git, or existing project files?
3. Does it work with useful defaults and no additional setup?
4. Does it reduce questions, tokens, repeated exploration, or manual
   bookkeeping?
5. Can scripts or hooks enforce its important invariants?
6. Can its user-visible behavior be explained in one sentence?
7. Does it strengthen the path from roadmap entry to completed work?
8. If the feature disappeared, would users miss the outcome rather than the
   sophistication?

A feature does not belong when its value depends on users learning agent
architecture, maintaining another information system, or configuring a
workflow before Foreman can help.

## Implementation principles

The safeguards below follow these constraints:

- no new setup step;
- no external state;
- no new configuration key unless a safe default is impossible;
- no new user-facing concept when an internal CLI shape is enough;
- no schema growth without measured evidence that existing fields cannot
  carry the behavior;
- no model call for work a script can perform;
- no broad automatic write when a compact fact can be returned for the
  existing flow to handle;
- benchmarks or replay evidence before changing established ranking behavior.

## Implemented safeguards

### Keep unselected task detail out of session context

**Risk addressed:** `next-candidates` can return the full `what`, `touches`, and `notes`
for every offered task. The user selects only one, but the other candidates'
detail remains in the conversation and is paid for on later turns.

**Mechanism:**

1. Add a `--menu` shape to `roadmap.js next-candidates`.
2. Return only the fields needed to present the choice:
   `id`, `title`, a short `why`, collision state, and ranking signals.
3. Return slim `in_progress` rows suitable for the resume choice.
4. After the user chooses, fetch that entry alone through the existing
   `list --ids <id>` path.
5. Run project-section rendering and selected-entry preparation only after
   the choice when they are not needed earlier.

**Mechanical ownership:** `scripts/roadmap.js` determines both response
shapes. The roadmap skill consumes them without reconstructing fields.

**Compatibility:** the existing full `next-candidates` result remains
available for callers that need it. No roadmap or configuration migration.

**Verification:**

- candidate order is identical between full and menu shapes;
- menu output contains no `what`, full `notes`, `touches`, or decision-doc
  payload;
- selected-task handoffs remain byte-valid under `check-prompt.js`;
- a large-notes fixture shows a material payload reduction.

**Exit criterion:** the normal pick flow retains the same choices and
handoff quality while carrying only one task's detailed record forward.

### Serialize roadmap mutations

**Risk addressed:** temp-file replacement protects against a partial write, but two
sessions can still read the same roadmap version and let the later rename
erase the earlier session's update.

**Mechanism:**

1. Add one internal mutation wrapper around every write command.
2. Acquire a project-specific exclusive lock before reading the entries that
   will be modified.
3. Hold the lock through validation, mutation, write, and post-write parse.
4. Store the lock in the operating system's temporary directory, keyed by a
   hash of the resolved project path, so normal use leaves no repository file.
5. Record enough ownership and time information to recover a demonstrably
   stale lock after a crashed process.
6. Use a short bounded wait; on failure, return one structured error instead
   of spinning or writing without the lock.

**Mechanical ownership:** all callers receive the protection automatically.
Skills, hooks, and users do not opt in or handle revisions.

**Verification:**

- concurrent writers updating different entries preserve both changes;
- concurrent writers updating the same entry serialize cleanly;
- a crashed writer leaves a recoverable stale lock;
- read-only commands never acquire the mutation lock;
- Unix and Windows tests cover the same contract.

**Exit criterion:** no supported pair of concurrent Foreman mutations can
silently lose a completed write.

### Make exact task creation idempotent

**Risk addressed:** an interrupted initialization or repeated mechanical add can
create the same task twice. The skill performs a semantic duplicate check,
but the write primitive itself is not safe to replay.

**Mechanism:**

1. During `add`, compare the proposed title with existing titles.
2. On an exact match, return the existing entry with `deduped: true` and do
   not write.
3. Preserve the current semantic duplicate question for non-exact matches.
4. Require intentional separate tasks to use distinguishing titles so the
   write primitive remains replay-safe without another stored key.

**Mechanical ownership:** exact replay safety lives in `roadmap.js`, not in
skill memory or prompt wording.

**Verification:**

- repeating the same add is a clean no-op;
- a partially completed init can safely repeat its add sequence;
- intentional separate tasks receive distinguishing titles;
- id sequencing does not advance on a deduplicated call.

**Exit criterion:** any exact task-creation call is safe to retry after an
unknown or interrupted result.

### Return immediate graph facts with mutations

**Risk addressed:** a mutation may make another task ready or strand a dependent.
The necessary graph is already in memory during the write, but a later model
step may reread and reason over the roadmap to discover the consequence.

**Mechanism:**

1. Compare ready-task state before and after `update-status` and
   `update-deps`.
2. Add compact result fields only when non-empty:
   - `newly_unblocked`;
   - `newly_blocked`;
   - `stranded_dependents`;
   - the existing `scope_drift`.
3. Keep each item to the entry id and title.
4. Do not automatically edit dependent entries.
5. Let existing skills decide whether to mention the fact, ask the user, or
   continue silently.

**Mechanical ownership:** graph facts come from the same parsed snapshot and
mutation that caused them. No second roadmap read or model derivation.

**Verification:**

- closing the last blocker reports the newly ready task;
- adding a dependency reports a newly blocked task;
- dropping or rejecting a dependency reports dependents that cannot become
  ready without an edge change;
- unrelated mutations return none of these fields;
- responses stay compact on large roadmaps.

**Exit criterion:** immediate structural consequences are available without
another whole-roadmap reasoning pass.

### Test critical-path ranking before changing it

**Risk addressed:** `unblocks_total` rewards broad downstream impact. The head of the
longest remaining dependency chain may sometimes be the more useful pick, but
adding another ranking rule without evidence would make established behavior
harder to explain.

**Mechanism:**

1. Implement longest-open-chain computation in the benchmark or replay layer,
   not the production sorter.
2. Replay real and synthetic roadmaps through:
   - current ranking;
   - critical-depth-first ranking;
   - critical depth as a late tie-breaker.
3. Record disagreement cases and judge whether the alternative clearly
   improves the solo-developer recommendation.
4. Ship only the smallest rule supported by the evidence, preferably an
   internal tie-breaker.

**Mechanical ownership:** if adopted, critical depth is derived at read time.
There is no stored priority, estimate, category, or ranking configuration.

**Verification:**

- dependency cycles remain rejected before ranking;
- ranking is deterministic;
- hint matching and collision avoidance keep their documented precedence;
- the new rule improves measured picks rather than merely changing them.

**Exit criterion:** either a replay-backed ranking improvement ships, or the
current algorithm is explicitly retained with no production change.

### Tighten closure-note honesty without a new schema

**Risk addressed:** a model can restate the planned `what` as if it were evidence of
what actually happened.

**Mechanism:**

1. Add one closure rule to the canonical handoff instructions:
   closure notes describe observed work and cite files, commands, commits, or
   outcomes; they never treat the planned description as execution evidence.
2. Keep `notes` as the storage field.
3. Do not add acceptance-criteria, execution-record, or review-state fields
   without a measured failure that requires them.
4. Pin the rule in the prompt-template tests.

**Mechanical ownership:** `check-prompt.js` verifies that the canonical
closure instruction is present. The model still judges the evidence because
truthfulness cannot be reliably inferred from note syntax.

**Exit criterion:** every roadmap handoff carries the evidence rule, with no
new user input or roadmap field.

## The surface 1.0 ships

Five skills, and no others:

| Skill | What it is |
| --- | --- |
| `foreman` | the one plain-language entrance; owns no flow, routes every request |
| `roadmap` | pick, add, correct, review status, check the roadmap |
| `init` | one-time project bootstrap |
| `survey` | the reconcile pass, only when the user asks for it |
| `craft-prompt` | an advanced side surface: a standalone prompt with no roadmap entry behind it |

Anything under `skills/` that is not on this list is not part of 1.0.

## The never-list

Published with 1.0. Each of these may be useful in a different product;
none of them is Foreman.

- team members, assignments, estimates, priorities, and dashboards;
- a general project knowledge base, wiki, or note taxonomy;
- semantic search or an automatic knowledge graph;
- pull-request review, reviewer personas, or multi-lens review pipelines;
- a dedicated review-agent system;
- persistent acceptance-criteria and execution-record schemas;
- an `in_review` lifecycle state;
- non-blocking relationship graphs and propagation workflows;
- whole-project graph-health audits;
- a separate activity-feed database;
- workflow-definition languages and configurable agent pipelines;
- researcher/planner/implementer/reviewer role systems;
- arbitrary multi-agent workflow composition;
- batch or parallel execution of several roadmap tasks;
- an external scheduler or any unattended run;
- a server, an account, or hosted state of any kind.

**The rule.** Nothing on this list ships in a 1.x release. An item may come
off the list only in a major version, and only with the reason written into
this file next to the entry it replaces — repeated solo-developer evidence
that the simpler Foreman path could not solve the problem. A shortened form
of this list is published in `README.md`, and the two must agree.

## Definition of success

Foreman is improving when:

- users perform less setup and answer fewer routine questions;
- roadmap operations consume less context as the project grows;
- repeated and concurrent operations are safe;
- task recommendations stay predictable;
- handoffs begin with grounded, task-specific context;
- interruptions do not duplicate or lose work;
- the roadmap remains understandable in the repository without Foreman
  running.

The desired impression is not that Foreman exposes sophisticated agent
engineering. It is that the project is always ready to continue.
