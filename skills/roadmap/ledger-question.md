# The ledger question

[pick.md](pick.md) asks this when `craft-handoff.js` returns `ledger_ask: true`,
the first moment lesson lines could pay. It appears only when a finished entry
already touched files this one plans to and the setting has never been put to
the user. Ask once, before delivering:

> "**[Beta]** A finished task already touched these files. Should a close
> be able to record one durable sentence about a code area, quoted back to
> later tasks that plan to touch the same files? This one is new and may
> still have rough edges. Turning it off later changes nothing you have
> already recorded."
> Options: `Yes, record and quote lessons`, `No, keep handoffs as they are`

The `[Beta]` marker is part of the question, not decoration — it is the
user's only warning before a setting starts writing a file into their
repository. Keep it, and keep the sentence that says the answer is
reversible: the honest reason to say yes to a young feature is that saying
no later costs nothing.

Write the answer straight into `.foreman/config.json` as
`{"ledger":{"enabled":<true|false>}}`, preserving every other key —
a written `false` is what stops the question being asked again. Never
re-craft the prompt because of the answer: it takes effect on the next
pick, which is soon enough for a setting nobody has been using.
