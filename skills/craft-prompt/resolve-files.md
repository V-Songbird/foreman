# Resolve the named files (craft-time, once)

Once the file paths are known, run
`node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-symbols.js` now with
`{touches, what, verify}` on stdin (user text stays out of shell quotes:
see [the shared runtime](../foreman/runtime.md)). `craft-handoff.js`
resolves the touched paths again on its own, so this call exists only for
the check below — catching a problem now, before the interview continues,
instead of after assembly. A `missing` file is expected when this task
creates it; correct a path that moved. An `outside_project` path is
refused: fix or drop it.

<!-- [Foreman: 109] -->
Call 3 has already gathered the verification commands by this point, so
pass every `run` command as `verify` (an array; never a review action) in
the same call and act on all three fields here rather than assembling
around them:
- `verification.resolves: false` for any command — nothing in this
  project answers to it. Fix it with the user before assembly; a prompt
  naming a command that cannot run wastes the whole session.
- `references` — a file already importing the same helper is the
  `Pattern:` line `relevant_files` asks for in Call 2's Q3. Cite it instead
  of leaving the pattern slot empty.
- `files[].lastChanged` — a touched file that changed recently is where
  this task's claims are most likely stale. Hand those facts over as
  claims for the destination to check rather than restating them as
  settled.
