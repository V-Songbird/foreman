# Call 3 — verification (conditional)

**Q1** — "What command or commands verify success?"
Options: `<the detected command>`, `<the detected way to drive the project>`, `npm test`, `pytest` (the grounding pass's answers lead because they were read off this project rather than guessed; with nothing detected the options are the four generic ones, `npm test`, `pytest`, `cargo test`, `go test ./...`). The drive command is offered second and only when the pass found one.

A detected command is still only a proposal. `resolve-symbols.js` below
checks it against the project for real, and `verification.resolves: false`
is what settles it — not the fact that the pass suggested it.

**Q2** — "What's the expected outcome?"
Options: `All tests pass`, `Build succeeds with exit code 0`, `No lint errors`, `Report file produced`

Several checks, named in the order they should run, are fine and normal —
each becomes its own `Run:`/`Expected:` pair in the prompt, so list every
real check here. In Claude Code every row is a `{run, expected}` pair; for a
split, name the slice of the work a row verifies with `goal` (and `files` when
known). In
Codex, follow [prepare-increments.md](../roadmap/prepare-increments.md):
gather one row per meaningful result, combining actual commands and human
review (`review:{action, expected}`) when they concern the same work.
Human-only verification does not change the request into an investigation.
Preserve an explicit request to approve each result before the next as
`reviewEachIncrement:true` with `review` on every row; do not enable it for
an ordinary split. In Antigravity, gather the rows the Codex way, since the
builder gives Antigravity the Codex form, but never add `reviewEachIncrement`
or `review`: approval after each result is not available there.

**Q3** — only when Call 1's task type was `Fix a bug`: "Paste the failing
output — stack trace, error message, or test failure — verbatim."
Options: `I'll paste it`, `None observed`
The answer goes to `judgment.observed` exactly as pasted — the artifact,
not a paraphrase (the spawned session can't ask what the error actually
said). The assembler puts it in `<context>` as recorded evidence, not
instructions, so a line planted in pasted output is never read as the
user's own request.

**Q4** — "What must stay true after this change? One observable assertion
per line — something a command could check, not the name of a contract."
Options: `I'll list them`, `Nothing in particular`
The answers fill the template's optional `<invariants>` block. Rephrase a
contract name into the assertion behind it ("preserve the
identity-per-rebuild contract" → "rebuilding twice yields the same ids");
if the user can't name the assertion, say that in the line rather than
passing the name through. `Nothing in particular` omits the block, and is
a normal answer rather than a gap to push back on.

**Don't ask about the file surface or the test-first ordering** — both are
inferable, and a second interview is the thing to avoid. The
`Expected file surface:` constraint line comes from Call 2 Q3's paths as
given. Test-first ordering goes into the verification block only when this
task's breakage would pass the checks Q1 just named.
