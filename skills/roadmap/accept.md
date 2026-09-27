# Accept finished work from the pick menu

The user chose an `Accept: <title> (<id>)` row in Q1 of [pick.md](pick.md).
Read the entry back first —
`node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --ids <id>` — and take
every `unverified:` line out of its `notes`. Those are the checks the
finishing session could not run itself; leave out any that a later
`verification resolved:` note settles for the same check. With one or
more still unverified, the first option is `Test it first (Recommended)`:
print those lines verbatim, say nothing about whether it works, and stop —
the entry stays `awaiting_acceptance` until they come back. With none, that option does not appear at all. Then
ask whether the work holds up; only the user's explicit answer accepts.
Under `.foreman/config.json`'s `delegatedAcceptance`, the orchestrator it
names accepts for the sessions it lists instead: in that orchestrator's own
session its decision stands in for the user's answer, and a listed session
asks nothing and leaves the entry for it
([Close and acceptance](delivery.md#close-and-acceptance)).
Accepting closes it —
`echo '{"id":"<id>","status":"done"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
— and declining sends it back with what they said:
`echo '{"id":"<id>","status":"in_progress","notes":"<what they said>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
(their words go through a heredoc, here-string, or payload file in the
project's `tmp/`, as the runtime describes). Either way, say what changed and stop; no prompt is crafted for an accept.
