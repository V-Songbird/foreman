# Call 1 — project and goals

Use a project description or goals the request already gives (including
the skill's arguments) and skip that question. Ask the rest in one
`AskUserQuestion` call in Claude Code; in Codex, one picker at a time from
[questions.md](../foreman/questions.md).

**Q1** — "What is this project?"
Options: `I'll describe it`, `Read the repo and work it out`
`I'll describe it` asks for a short description — what it does, what stack,
new or existing codebase.

**Q2** — "What are the near-term goals for the roadmap?"
Options: `I'll describe them`, `Propose some from the code`
`I'll describe them` asks for 2-5 concrete things they want to get done
soon.

In Claude Code, both `I'll describe` options nudge the user into Other.

On either read-the-code answer, ground the draft in what is actually
there — the README, the manifest, the entry points, `git log` — and say in
the draft which parts came from the repo rather than from the user. Call 2
is where they correct it. If the repo is empty or unreadable, say so and
ask the question again rather than drafting from nothing.
