# Branch: Review status

Read-only. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --summary`
— compact rows (id, title, status, depends_on, planned_touches); the
render below reads the first four, and the full entries' prose would
multiply the payload for nothing on a large roadmap. Render a compact list
grouped by status, and **name each group in everyday words, never the
stored value** — the user did not choose this vocabulary and should not
have to learn it:

| Stored | What you write |
| --- | --- |
| `awaiting_acceptance` | Waiting on you |
| `in_progress` | Being worked on |
| `planned` | Not started |
| `deferred` | Parked |
| `done` | Finished |
| `dropped` | Dropped |
| `rejected` | Turned down |

In that order, with **Waiting on you** first — those are the only rows that
need the user to act. Under **Not started**, note which are blocked and on
what, derivable from `depends_on` plus the other entries' statuses. When a
blocker resolves to an entry that was dropped or turned down — or to an id
no entry has — say so explicitly rather than calling it plain
"blocked": it will not reappear in the pick list until that dependency is
moved back with `update-status`, or its edge is removed with
`update-deps`'s `remove_depends_on`. Finished work that has been archived
is not in this render at all — `list --archived --summary` returns it in
the same shape when the user asks for the history. If any parked entries
exist, fetch just those in full for the "waiting on what" word —
`list --ids <their ids>` — drawn from their `why`/`notes`. No writes,
no further questions.
