'use strict';

// Splits text into lowercase word tokens. Punctuation is not a token and
// must not travel with the words it touches.

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter(Boolean);
}

module.exports = { tokenize };
