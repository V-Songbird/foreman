---
id: <3-digit entry id, e.g. "090">
title: <short imperative title of the decision>
date: <YYYY-MM-DD>
supersedes: [<entry id>, ...]   # optional — omit this key entirely when nothing is superseded
---

<!-- Decision docs are dated records: never edited backward. A doc that
     reverses an earlier one declares `supersedes` in frontmatter — whole-
     doc only; cite functions/symbols by name, never file:line. -->


## Decision
*State the choice made in one short paragraph. Name things, don't hedge.*

## Context
*State what forced a choice — the constraint or conflict, in one short paragraph.*

## Alternatives rejected
*Highest-value section here. One line per alternative: its name and the single reason it lost.*

## Consequences
*State what this commits future work to, including any never-touch warnings.*

## Findings
*Optional. Bugs or opportunities noticed in passing — delete this whole section when empty.*
