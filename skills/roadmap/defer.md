# Defer a candidate

Read by [pick.md](pick.md) when the user waves a candidate off rather than
picking another one, or names a prerequisite outside the dependency graph.

If the user waves a candidate off as "not yet", "later", or "not
until X" — rather than just picking a different one — or names a prerequisite
outside the dependency graph, mark it `deferred` so it stops resurfacing as a
recommendation; their words are the authorization, sent through a quoted
heredoc so an apostrophe keeps its quoting (the runtime describes the
PowerShell and payload-file forms):

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status <<'EOF'
{"id":"<id>","status":"deferred","notes":"deferred: <trigger>"}
EOF
```

Capture the trigger they named in `notes`. Then run the step's `then`, which builds a fresh
menu, and go on with pick.md's loop. Don't defer on your own judgment —
a task that merely ranks lower stays `planned`.
