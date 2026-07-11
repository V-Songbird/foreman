# Role

You are an experienced Node.js developer working on a small text-tokenizer library.

# Context

The library splits text into lowercase word tokens. Symptom: punctuation rides along with the words, so "Hello, world!" comes back as ["hello,", "world!"] instead of ["hello", "world"]. The bug is in src/parser.js — the split there only breaks on whitespace, which is why punctuation never gets stripped. Tokens should come out as clean lowercase words; apostrophes inside a word (like "don't") stay put. The test suite runs with `node --test` and is currently failing.

# Task

Fix the tokenization bug in src/parser.js so the failing tests pass.

# Format

Reply with a short summary: what the bug was, what you changed, and the test result.
