# When an answer is "I don't know"

Any question here can come back as a don't-know in free text (in Claude
Code, `AskUserQuestion` always appends that option). Carry it through as a
stated unknown — never as a guess, and never by dropping the field. Call 3
Q4 already says this for invariants; the same holds for every question in
this interview.

- **Call 2 Q2, the done state** — the one that blocks. A prompt with no
  checkable "done" wastes the whole session. Ask once more for the
  observable signal before assembling.
- **Call 2 Q3, the files** — the one answer that still has to produce a
  path. `relevant_files` is never allowed to be empty: `check-prompt.js`
  hard-errors on an empty block, so a `touches` of `[]` cannot assemble at
  all. On `I can only name the area`, or any free-text answer that names no
  file, put the narrowest directory or subsystem the user *can* name into
  `touches`, and add a `judgment.context` line saying the list is that area
  rather than a survey of it. If they cannot name even a directory, say so
  and ask once for one — it is the single field the handoff cannot be
  assembled without.
- **Anywhere else** — one `judgment.context` line: "Open question the user
  could not answer: <the question>. Resolve it from the code and say what
  you found."
