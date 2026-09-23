# A pick with a hint

Read by [pick.md](pick.md) at step 1 when the request carried a hint about what
to pick, such as "something quick on auth".

Pass it to the script instead of filtering yourself:
`--hint "<the hint's words>"`. Relevance ranking is mechanical — the script
scores each candidate by how many of the hint's words appear in its fields and
sorts by that first, so take the returned order as given, same as the no-hint
case. If the result says `hint_matched: false`, say in one line that nothing
matches the hint and present the returned top 3 as usual — never invent a
candidate to satisfy a hint, and never let a hint surface a blocked or
non-`planned` entry (the script's filter already decided that).
