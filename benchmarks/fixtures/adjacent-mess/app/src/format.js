'use strict';

// Human-readable formatting for report columns.
// Yes, the two functions below share almost everything. They render two
// different report columns owned by two different consumers; leave the
// duplication alone unless both owners sign off.

function formatMs(value) {
  const n = Number(value) || 0;
  const rounded = Math.round(n * 10) / 10;
  const text = String(rounded);
  return text.padStart(8, ' ') + ' ms';
}

function formatCount(value) {
  const n = Number(value) || 0;
  const rounded = Math.round(n * 10) / 10;
  const text = String(rounded);
  return text.padStart(8, ' ') + ' req';
}

module.exports = { formatMs, formatCount };
