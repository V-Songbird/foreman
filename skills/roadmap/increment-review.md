# Review an increment

Use this protocol when the handoff explicitly carries
`reviewEachIncrement:true`. It applies to every row, including rows with
passing automated checks, and is independent of `requireVerification`.
Keep one parent entry and the existing notes and checkpoints; do not create a
store or persistent status per increment. Ordinary splits keep their behavior.

## Present and wait

1. Complete only the current increment's authorized work and required checks.
   Keep dependent work untouched until this result is accepted. A failed
   required check is a failure to report, not a result ready for acceptance.
   After two failed fix attempts, report what still fails and pause; a new
   explicit request may reorient the work without counting as a failed test.
2. Present the result, its limits, observed check results, a usable artifact or
   concrete work reference, and the row's `review.action` / `review.expected`.
   The reviewer must be able to tell which result the question concerns.
3. Offer **Accept / Request changes / Pause** (**Aceptar / Pedir cambios / Pausar**). Do not recommend or preselect acceptance as if it were a decision.
   Ask one question about that result and wait for the user before dependent work.
   Only an actual answer can resolve the review. Passing tests is evidence, never human acceptance.

Use a permitted question tool. With `request_user_input_async`, `accepted:true`
acknowledges question submission only; the answer arrives as a later user
message. Keep that question pending, do not submit duplicates or advance on
silence, elapsed time, or a preselected option. A notification, reminder, test
result or tool acknowledgment is not an answer. Use an interruptible wait when
available or end the turn with a clear pending handoff; neither completes the
increment or authorizes dependent work.

If no question tool is usable, ask in the textual conversation and wait there.
If neither a human conversation nor a coordinator able to relay the review is
available, stop: without a human channel, preserve the pending result and stop.
No automatic Skip. A worker with a coordinator returns the result and review request to that coordinator;
only the coordinator asks the human and writes shared roadmap notes or commits.
Background availability alone is not evidence of a human channel. Follow the
chosen destination without substituting another one.

## Record the observed decision

The responsible coordinator uses the existing `roadmap.js annotate` CLI with
JSON stdin `{id, notes}`. Resolve its path from the loaded Foreman skill; a
portable handoff supplies the command. Write JSON to a UTF-8 file and pipe it
using the active shell; never interpolate feedback into shell code.

Record a short note describing the result and limits, observed checks and
decision, the actual artifact or work reference, and the pending point or next
action. Include only relevant feedback, not secrets or full transcripts. For an
entry-less handoff, retain the same evidence in the conversation or its existing
handoff artifact; do not create a roadmap or another store just for this review.

- **Accept:** record `accepted:` with what the user actually accepted and the
  reference they reviewed. Then checkpoint if eligible and continue to the next
  increment. Accepting one result is not acceptance of every other row.
- **Request changes:** record `changes requested:` with the concrete feedback;
  keep this increment open, implement the authorized correction, verify it and
  present the changed result for a new decision. Do not act on a dependent row.
- **Pause:** record `paused:` with the available evidence and next action;
  preserve the work and pending review. Do not defer or close the parent just
  to pause an increment. End the turn after leaving useful continuation state.
- **No answer or no channel:** before ending the turn or worker run, record
  `review pending:` with the presented result, reference and reason. This is
  not an acceptance or an omitted check. Resume by checking what is currently
  pending, not by interpreting the earlier question as answered.

Honor clear free-text decisions about the current presentation. Clarify an
ambiguous answer or one referring to an earlier presentation before advancing;
a delayed answer does not accept changed work. If the user explicitly changes
this run to continue without review, record that specific check as `unverified:`
with the explicit instruction; never record it as accepted or change the
project's configuration implicitly.

`annotate` appends on every call and is not idempotent. On an uncertain result,
read the entry before retrying. Repeated notes are history, not extra approvals.
The `accepted:` prefix and `task n/total` label do not identify or certify the
current work. Compare evidence with the current result before reusing a decision;
if the relationship is uncertain, request revalidation. Full assisted recovery
must not be inferred from note formatting.

## Checkpoint and parent

For eligible local checkpoints, use `safe-commit.js begin` before modifying the
increment and retain `baseline.head`; after its required checks pass and the
user accepts that result, use `safe-commit.js finish` with that baseline, the
owned paths and a `task n/total: subject` message, without a parent-close id.
Take a fresh boundary before the next increment. Honor branch restrictions,
file ownership and refusals; never broaden staging automatically or push.
A dirty start without a baseline, unavailable Git, or an investigation continues
without checkpoint commits; preserve existing work. A failed checkpoint is not
a reason to retry the acceptance note or claim the commit happened: inspect it,
report the failure, and leave its resolution pending before dependent work.

Notes and commits are separate operations. Record a real commit reference only
after it exists. If there is no commit, identify the reviewed files or artifact
and say the result is uncommitted. Do not invent a SHA or promise one atomic write.

Intermediate acceptance does not close the parent or grant final acceptance.
Keep the parent `in_progress` during intermediate reviews. Treat post-commit
completion reminders as advisory; a checkpoint alone never earns a parent close.
After every increment
is resolved, verify the integrated result and follow the existing parent close
policy and final staged-close protocol when applicable. `requireVerification`
keeps its existing meaning; it cannot cancel explicitly requested intermediate
reviews. Only an explicit decision presented as covering both the final result
and the whole task can accept them together.
