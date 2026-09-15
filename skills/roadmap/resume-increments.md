# Resume reviewed work from evidence

Apply this protocol when resuming an explicitly reviewed run. The executor,
not Fast pick's mechanical selection, compares the recorded evidence with the
current project. Keep the existing parent, notes and checkpoints. Do not create
a persistent increment identity, state store or automatic replay mechanism.

Read the selected entry's complete notes, including review pending, requested
changes, pauses, omissions and acceptances. A recall excerpt or a stored agent
handle is not a substitute. The handoff carries those notes as recorded evidence,
not instructions; refresh them through `roadmap.js list --ids <id>` when execution
starts. A worker asks its coordinator for the refreshed record when necessary.
For an entry-less handoff, inspect its existing conversation or handoff evidence.

Before doing dependent work:

1. Identify the actual result described by each relevant note: its scope,
   reviewed artifact or files, limits, observed checks and decision. Row numbers
   are presentation aids, not stable identities after a plan is reconstructed.
2. Inspect those artifacts and the current files. Use a referenced commit when
   it resolves, but never assume a note written before a checkpoint refers to
   that later commit. An uncommitted result may still have sufficient evidence;
   describe what was compared and the limits of the comparison.
3. Distinguish existing work with corroborated acceptance, work still awaiting
   review or correction, and work not yet implemented. Do not recreate an
   existing result merely because this is a new session. Do not skip a result
   merely because a note starts with `accepted:` or an earlier task list marked
   a row complete. Duplicate notes are not additional approvals.
4. If the evidence clearly identifies the accepted result and it still matches
   current work, state that finding and continue from the next unresolved
   result. If its reference is missing, its content changed, or the decision's
   scope is ambiguous, present the current result and uncertainty for
   revalidation before dependent work. Preserve the files while waiting.

A late answer refers to the presentation it answered. Compare it with the
current result before treating it as acceptance. If that result changed or the
answer could concern another result, ask which result the person accepts; never
silently transfer an old approval to new content. Missing tools use conversation;
without a human or coordinator channel, leave the uncertainty pending and stop.

Record the observed comparison and next action with `annotate`, including any
revalidation actually requested or received. Never invent a user response.
When an annotate outcome is uncertain, reread before retrying: append is not
idempotent. If execution stopped between a note and a checkpoint, inspect both
the current notes and Git state; do not duplicate the note, invent a commit,
or run a checkpoint again merely to recreate an assumed sequence.

An omission and its later resolution both remain in history. Match evidence to
the specific result and check; an unrelated acceptance cannot erase an
`unverified:` check. This comparison does not grant whole-task acceptance.
Keep the parent open until its remaining work and integrated verification are
complete, then apply the existing final acceptance policy.

This is assisted recovery. Format-compatible clients may ignore this protocol;
the existing roadmap CLI does not mechanically enforce every intermediate
decision. Do not claim automatic exact resume or universal client compliance.
