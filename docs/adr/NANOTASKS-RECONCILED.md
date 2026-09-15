# Foreman: accepting a task increment by increment

Canonical implementation contract for Codex — 2026-09-08.

This contract consolidates the [original proposal](https://github.com/V-Songbird/foundry/blob/main/docs/foreman/research/NANOTASKS.md),
the selective-pause design received on 2026-09-08 and its two reviews. The
user's later request authorizes continuing and implementing this contract for
Codex ONLY. For V1 it replaces the separate-store design. It does not certify
acceptance of any implemented result or of the whole feature. Claude Code waits
on the outcome of the Codex evaluation. The earlier documents remain background,
not cumulative instructions.

The Codex implementation ships in this package. The
[evidence report](https://github.com/V-Songbird/foundry/blob/main/docs/foreman/validation/NANOTASKS-DOGFOOD.md)
records tests, real decisions, controlled rehearsals and cleanup. For the
implementation run, the user authorized finishing the remaining technical
deliveries autonomously and omitting their intermediate reviews. That exception
does not change product behavior and does not grant human acceptance of the
whole feature, which remains separate.

## 1. Product agreement

Foreman lets you develop **one roadmap task in increments that a person can try
and accept**. The executing session keeps the goal, presents each result and
waits for the decision before building the next one.

"Nanotask" may be used in conversation, but it does not introduce another
category the user has to manage. An increment is a meaningful result, not every
programming step. Creating a component can be an internal step; opening and
closing an accessible modal is a reviewable result.

The behavior is requested explicitly, for example: "Do this task in steps and
wait for my approval between them." The usual split keeps its behavior. The
preference travels in the request for that run, without a new mandatory project
setting or a question about every detail.

The assembler's transient input represents it as `reviewEachIncrement:true`,
only when it captures that explicit request. Absent or `false` keeps the
previous behavior; the script does not try to infer it from free text. With
`true`, it rejects rows without a review and carries the obligation into the
prompt. It is an option of that request, not a new roadmap field or a project
preference that switches on silently.

**In a run requested this way, every increment ends in human acceptance.**
Tests and tools supply evidence, but they do not replace the decision that the
result matches the user's intention. The reviewed aspect does not have to be
impossible to automate.

This decision preserves the original request. The alternative, "ask only when a
tool cannot verify it", would be a different product contract; the word
nanotask does not make the two equivalent.

## 2. Minimal implementation and scope

V1 reuses the `craft-handoff.js` splits, the parent entry's lifecycle, its notes
and the existing checkpoints. It creates no other store, no persistent per-unit
states, no propagation graph, no server and no execution across several parent
entries.

The exclusion of persistent acceptance and execution schemas in `SCOPE.md` also
covers a side file. The proposed `.foreman/nanotasks/<parent>.json` is withdrawn
from V1. Keeping brief evidence in `notes` must not turn into an event database
or a complete schema hidden as text.

The promised experience is assisted acceptance and continuity. It does not
promise a state machine that stops every client from skipping ahead, or an exact
automatic resume. A reproduced limitation can justify extending the
implementation; there is no need to wait for two real incidents. A change of
scope is justified separately before it is built.

## 3. Unit of work and checks

One split row represents **one increment**, and it can combine automatic checks
and human review. Do not create two rows without distinct work just because the
same result needs a test and an inspection by the user.

Implemented contract for the assembler's transient input:

```json
{
  "goal": "Open and close the sign-in form",
  "files": ["src/Header.tsx", "src/LoginModal.tsx"],
  "run": "npm test -- LoginModal",
  "expected": "The open, close and focus checks pass",
  "review": {
    "action": "Open sign-in, close it with Escape and open it again",
    "expected": "The form opens and closes the way you expect; it does not authenticate yet"
  }
}
```

The example defines the row contract. Whether each capability is available and
accepted is read from the roadmap CLI, never inferred from this document.
Verification can be automatic only, human only, or both. `run` and its
`expected` form one pair; `review.action` and `review.expected` form another.
Require at least one and validate complete pairs. The existing
`{run,expected,goal,files}` form stays valid without reinterpreting its
meaning. In a run with acceptance per increment, every row carries `review`.

From the `look` design, this adopts the distinction of a human check, but as a
review field attached to the row so that it can live beside `run`. It can be
rendered as `Look:` / `Expected:`. There is no need to maintain two new input
formats: `look` is not implemented.

Only commands go to the command resolver. The count used to split work and to
offer checkpoints counts increments with work of their own, not the total
number of checks. The agent recommendation requires executable checks and the
other existing conditions. Do not invent a `run` to get past a validator.

Tests that verify structure do not show that the text proposes good increments.
Reviewing the result and dogfooding cover that part.

## 4. Pause, decision and close

Sequence for each increment:

1. Implement only its scope and run its required checks.
2. Present the result, how to try it and what it does not include yet.
3. Ask **Accept / Request changes / Pause** and wait for a real answer.
4. Record the decision and the evidence. On acceptance, make the checkpoint
   when appropriate and continue with the next increment.

A required failure is not presented as success. Requesting changes keeps the
increment open and keeps the feedback. Respect the existing limit of two failed
fix attempts; reaching it means reporting and pausing, not accepting or
widening the scope. A new explicit request can redirect the work. A change of
goal is not treated as a test failure.

Pausing keeps the work and the pending decision. It needs no new roadmap
operation. Ending the session can also pause, but it must leave a useful note
for resuming; assuming that the host's task list will persist is not enough.

**There is no automatic Skip.** Without a question tool, the conversation is
used. With no human channel, progress stops with the result pending. An explicit
user change to continue without review can modify the instruction for that run;
it is recorded as an omitted check, never as acceptance. No silent exit is added
for infrastructure.

A worker returns its result to the coordinator when that channel exists.
Background availability does not mean there is no person, and it does not allow
assuming that someone will answer. V1 must first support the current session
and the clipboard; other destinations state their limits and do not replace the
chosen destination.

Checkpoints follow `safe-commit`, branch restrictions and file ownership. A tree
that was already modified can continue without commits. Recording acceptance
and creating a commit are not one transaction.

Intermediate acceptance does not close the parent or satisfy its dependents.
When all increments are finished, check the complete integration and apply the
existing parent close policy. `requireVerification` keeps its meaning as a
general setting: it does not remove an intermediate review the person explicitly
asked for, and its value is never changed implicitly. When final acceptance is
required, accepting an increment does not grant it. If the final result and the
last increment are presented together, one explicit decision can accept both
without asking the same thing twice.

## 5. Honest evidence and recovery

Use `roadmap.js annotate` for brief notes on acceptance, requested changes,
explicit omission or pause. A useful record describes:

- The result and its limits as they were presented.
- The check performed and the decision observed.
- The available reference to the reviewed artifact or the concrete work.
- The pending point and the next action, when there is one.

Do not record secrets or whole transcripts. `accepted:` can distinguish these
notes from code lessons, but the prefix certifies nothing on its own. If it is
filtered out of `recallExcerpt`, the resume flow must read the entry's notes
directly so that this evidence is not lost.

`task n/total` is a visual aid, not a stable identity across rebuilt plans. A
note written before the checkpoint is not automatically linked to the SHA of the
later commit. Record the real reference when it exists; if the work has no
commit, describe what was tested and state the limitation. Do not build hash
manifests as a V1 requirement.

When resuming, read the notes and the current work, compare them and rebuild the
next increment. **Do not skip work only because `accepted:` appears.** If it
cannot be established which result was accepted, or whether it changed
afterwards, present the uncertainty for revalidation before continuing. Do not
automatically reimplement what already exists. The same rule covers late
answers: an answer about an earlier presentation does not accept the new one.

An omitted check that is later resolved keeps both notes. At close, interpret
the evidence for that specific result, without erasing history or dropping an
`unverified:` note because some other acceptance exists.

The current `annotate` appends a line on every call; it is not idempotent. After
an uncertain outcome, reread before repeating. Test duplications and
interruptions; do not claim that an append plus a commit guarantees exactly one
write. An older client can read the roadmap without knowing the new protocol:
format compatibility does not mean behavioral compliance.

## 6. Reconciled example

Main task: "Add user sign-in".

| Increment | Work and evidence | Human decision |
| --- | --- | --- |
| Open and close the form | Button, modal, fields, focus and the matching tests | Does sign-in look and work the way you expect? It does not authenticate yet |
| Authenticate and recover from errors | Connection, correct and incorrect cases, signed-in state and tests | Try valid and invalid credentials; accept the behavior |
| Sign out and check the whole | Sign-out, updated access and an end-to-end check | Accept the result and, when it is presented explicitly, the whole task |

Three increments, three decisions; each contains as many technical steps as it
needs. This granularity satisfies approval between nanotasks without asking for
confirmation to create each file or run each command.

## 7. Required checks and dogfooding

Checks required before declaring the contract available:

- Existing commands keep their behavior; human and mixed rows render correctly;
  incomplete inputs are rejected.
- Tests and review of the same increment do not create extra empty rows.
- An answer is awaited; feedback or a missing channel does not unblock the next
  increment.
- The clipboard prompt carries the pause even for a single reviewable row; it is
  not tied to the two-row threshold the current checkpoint embed uses.
- Repeated notes, a crash between acceptance and commit, a late answer and later
  changes do not authorize skipping by inference.
- A close distinguishes what was accepted, what was omitted and what is still
  pending.
- Resuming is tested with sufficient evidence and with ambiguous evidence.

Run `node --test tests/*.test.js` for runtime changes and the installed
validators when editing skills or metadata. The tests neither install nor
publish. Use the checks available in the real checkout; do not inherit paths
that do not exist, or assumed historical authorizations, to tolerate failures.

Dogfooding records what happened. A spontaneous return that did not happen is
not invented; the return path must be tested through a rehearsal identified as
such. Keep behavior tests, rehearsals with the user and spontaneous use apart.
Reading text or checking that a sentence exists does not show that execution
stops. A real pause, its decision and a real resume are part of the evidence for
this delivery.

The implementation history, delivery records and evidence live in [Foundry research](https://github.com/V-Songbird/foundry/tree/main/docs/foreman).

## 8. Agreed decision

The final recommendation is **acceptance of each meaningful increment,
implemented on the current split and notes, with assisted recovery and explicit
limits**. Both the separate V1 store and automatic advancement when no answer
arrives are withdrawn.

If pausing only on exclusively human checks is chosen instead, it must be
recorded as an explicit change to the original request before rewriting the
document or the tasks. None of the external texts, their "declined" annotations
or this proposal amount to that user decision.
