# The roadmap menu

Read by [the roadmap skill](SKILL.md) for a direct `/foreman:roadmap` call, or
for a request handed over without a branch.

## Call 1 — menu

**Q1** — "What do you need?" — `AskUserQuestion` in Claude Code, the picker in
[questions.md](../foreman/questions.md) in Codex.
Options:
- `Pick the next task` — read the roadmap, reason about what to work on
  next, craft a handoff prompt for it.
- `Add a task` — append a new entry to the roadmap.
- `Correct a task` — fix a stale title, why, what, kind, or planned files
  on an entry that already exists.
- `Review status` — read-only summary of where every task stands.

The menu holds four options because `AskUserQuestion` takes four at most, so
the structural doctor is reached by asking for it rather than from this menu —
the routing just below carries the phrasings that get there.

Skip this call whenever the request already says what the user needs. If args
were provided and read like a task description rather than a question, treat it
as a seed for "Add a task". If they read like a pick request or a hint about
what to pick ("what's next on auth", "something quick I can finish today"), go
straight to "Pick the next task" with the hint in hand — that branch says what
to do with it. If they name an entry that already exists and say what's wrong
with it ("003's what is out of date", "retarget 007 at the proxy"), that's
"Correct a task". If they say the roadmap itself looks broken ("my roadmap is
broken", "is the roadmap file healthy"), go straight to "Check the roadmap".

If they ask to clear out or archive finished work ("archive the finished
tasks", "get the done ones out of the way"), skip the menu: run `list
--status done,dropped,rejected --summary` and resolve the ids they mean. An
explicit request for all finished work authorizes that listed set — archive it
and report which ids moved. When the intended subset is ambiguous, show those
ids and ask **one** question (`Archive them` / `Leave them`). Archive with
`echo '{"ids":["001","002"]}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js
archive` — one call, all the ids, nothing else moves. Only terminal entries
archive; archiving preserves history and dependency resolution, and never
reuses ids. `restore` with the same shape is the way back if one has to change
again; `list --archived --summary` finds it.

<!-- [Foreman: 209] -->
## Trial log

This file's own questions — Call 1's menu and the archive-finished-work ask —
belong to the branch the user ends up in, not to a branch of their own. Record
each one the user actually saw with that branch's flow:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js question_asked '{"flow":"pick"}'
```

`pick`, `add`, `correct`, `status` or `survey`, whichever the routing lands
on. The structural doctor has no flow and records nothing. One event per
question interaction, as the runtime defines it. A valid call records nothing
unless the project set `trialLog`, so it needs no check first; a malformed one
fails in every project. Either way it never blocks the flow.
