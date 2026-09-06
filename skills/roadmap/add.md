# Add a task

1. Derive `title`, `why`, `what`, and any `depends_on` and `planned_touches`
   from the user's request and available project context. Ask only for missing
   information that affects the task. `kind:"decision"` means resolve a choice
   and record it; implementation uses the default build kind.
2. Run `roadmap.js check-duplicate` with `{"title":"...","why":"..."}`.
   A rejected match means this was previously declined; do not revive it
   silently. Other matches are already tracked. If the user means separate
   work with an identical title, obtain a distinguishing title; exact-title
   replay always returns the existing entry.
3. Run `roadmap.js add` with the fields above, `source:"user"`, and arrays for
   dependencies and planned files. The CLI computes ids and dates and verifies
   the graph. Explicitly requested additions need no redundant approval.
4. Report the returned id and title, whether it was deduplicated, and any
   actionable warnings. Predicted files may be new; observed files are written
   mechanically at close.

After an actual question, record
`node <plugin-root>/scripts/trial-log.js question_asked '{"flow":"add"}'`.
This is a no-op unless the project set `trialLog` and never blocks the flow.