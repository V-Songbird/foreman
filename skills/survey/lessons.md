<!-- [Foreman: 247] -->
# 3b. The lessons recorded about the same files

Survey is the only flow that has already read the code a recorded lesson
describes, so it is the only place a wrong one gets retired. Nothing else in
Foreman can tell a claim that aged badly from one that was never true.

One call, for the candidates you surveyed, with their `planned_touches` joined:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js notes --paths <comma-joined paths>
```

Skip the whole step when it returns no records — that one call answers both
"is the feature on" and "is there anything here", and it costs nothing to ask.

Three kinds of record are worth the user's attention, and no others:

- **`staleness: "stale"` whose claim the step-2 evidence contradicts.** The
  files under it moved, and the investigators that just read those files
  reported something different.
- **Any record the step-2 evidence contradicts outright**, whatever its label.
  A `fresh` label says the files have not changed since the claim was
  recorded. It never says the claim was right when it was written.
- **Any record with `hidden_characters`.** `notes` withholds its lesson and
  nothing serves it, so show its key and the code points it lists in place of
  the lesson, label and evidence, and offer to retire it.

**A stale label on its own is not a finding.** It is a prompt to look, and the
looking already happened in step 2.

For each record worth offering, show the lesson verbatim, its label, and the
evidence line that contradicts it, then ask the same way and under the same
approval rule as step 3: keep it, or retire it. On retire:

```
echo '{"key":"<the key notes reported>","by_entry":"<the surveyed entry>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js note-supersede
```

Retiring stops the line being served and stops it spending the handoff's
capped serving window. It does not delete it, and it does not record what the
truth is instead: the corrected fact belongs on the `lesson` of whichever task
next closes in that code, where it arrives with its own anchor and date.

**Pruning is a separate ask and it comes last.** It is the one command in
Foreman that rewrites the lesson store, so it never runs on an inference about
what the user probably wants:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js note-prune --dry-run
```

That writes nothing and reports what would go — records whose every file is
gone, and records already retired. Show the count and ask once, unless the
user already explicitly asked to prune that set. Only on a yes, or that
explicit request, run the same command without `--dry-run`. When the dry run
reports nothing, skip the ask entirely.
