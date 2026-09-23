# Defer a candidate

Read by [pick.md](pick.md) when the user waves a candidate off rather than
picking another one, or names a prerequisite outside the dependency graph.

If the user waves a candidate off as "not yet", "later", or "not
until X" — rather than just picking a different one — or names a prerequisite
outside the dependency graph, mark it `deferred` so it stops resurfacing as a
recommendation; their words are the authorization:
`echo '{"id":"<id>","status":"deferred","notes":"deferred: <trigger>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
(capture the trigger they named in `notes`, sent the way the runtime says
user-written text travels). Then re-run
`next-candidates --menu` and re-ask Q1. Don't defer on your own judgment —
a task that merely ranks lower stays `planned`.
