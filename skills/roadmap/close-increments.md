# Close the integrated result

Before closing an explicitly reviewed task, read the selected entry's complete
notes and inspect the current integrated result. Reconcile evidence by the
specific outcome and check it concerns. Keep this comparison in the conversation
and existing notes, not a new persistent checklist or increment store.

- A corroborated acceptance covers only the result actually presented. It does
  not accept another result, later changed content, or the whole task by default.
- A required check that failed or a result awaiting correction or review remains
  unresolved. Do not close the task while that work is pending.
- An explicit user instruction to continue without a particular review permits
  that omission only. Record it as `unverified:` with its scope and reason; do
  not describe it as accepted or silently change project configuration.
- A later observed check can resolve a previously omitted check of the same
  result. Append `verification resolved:` with the observed evidence and current
  reference. Keep the earlier `unverified:` note. An acceptance elsewhere, a
  duplicate note, or a bare `accepted:` prefix cannot resolve it.

Do not classify every historical `unverified:` line as still pending. Determine
which checks actually remain unresolved from their scoped evidence and current
content. If this relationship is ambiguous, request revalidation before claiming
resolution. Offer Test first only for those still-unverified checks, quoting the
relevant original lines and explaining the current uncertainty. Never erase all
omissions because some other result was accepted.

After all increments are resolved or their omissions explicitly authorized,
run the required integrated checks and present the whole result, its limits,
remaining authorized omissions and evidence. Follow `requireVerification` for
the parent: with final acceptance required, record `awaiting_acceptance` until
the user actually accepts the integrated result. With it disabled, an explicit
per-increment review still applies; do not skip that review to close early.

The last increment's acceptance alone is not final acceptance. If the final
result and last increment are presented together and the user explicitly accepts
both, record that scope once and close without asking the same question twice.
A worker leaves the shared close and final question to its coordinator. Without
a human channel, preserve the final review as pending rather than inferring yes.

Use the existing `update-status`, lifecycle check and eligible staged-close
protocol. If committing, keep the final `Foreman: <id>` trailer and observed file
evidence; a dirty run continues without commits. Neither an intermediate
checkpoint nor a successful lifecycle check proves final human acceptance.
Clients that ignore this protocol can still read the roadmap format; that does
not make their behavior equivalent.
