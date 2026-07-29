# Branch: Review status

Read-only. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --summary`
— compact rows (id, title, status, depends_on, planned_touches); the
render below reads the first four, and the full entries' prose would
multiply the payload for nothing on a large roadmap. Render a compact list grouped by `status`
(`awaiting_acceptance` first — those are finished and waiting on the user,
the only group that needs them to act — then `in_progress`, then `planned`
— noting which are blocked and on what, derivable from `depends_on` plus
the other entries' statuses — then
`deferred`, then `done`, `dropped`, `rejected` last). When a `planned`
entry's blocker resolves to an entry that is `dropped` or `rejected` — or
to an id no entry has — say so explicitly rather than calling it plain
"blocked": it will not reappear in the pick list until that dependency is
moved back with `update-status`, or its edge is removed with
`update-deps`'s `remove_depends_on`. Finished work that has been archived
is not in this render at all — `list --archived --summary` returns it in
the same shape when the user asks for the history. If any `deferred`
entries exist, fetch just those in full for the "waiting on what" word —
`list --ids <deferred ids>` — drawn from their `why`/`notes`. No writes,
no further questions.
