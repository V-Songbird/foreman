'use strict';

// Sentence-level parsing helpers.

function splitSentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parse(text) {
  return splitSentences(text).map((sentence) => ({
    sentence,
    words: sentence.split(/\s+/).filter(Boolean),
  }));
}

module.exports = { parse, splitSentences };
