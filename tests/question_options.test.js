'use strict';

// [Foreman: 366] A question a skill asks offers two to four options, because
// the question tool takes no fewer and no more. Every `Options:` list in
// skills/ is counted, whether inline (`Options: \`A\`, \`B\``, wrapped lines
// included) or as a bullet list under a bare `Options:` line. A menu the
// skill builds at run time is out of scope. The test only reads the skills.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'skills');
const LABEL = /(^|[\s>])Options:/g;

/** Each `Options:` list in `text`: its 1-based line and how many options it offers. */
function optionLists(text) {
  const lines = text.split(/\r?\n/);
  const lists = [];
  lines.forEach((line, index) => {
    const starts = [...line.matchAll(LABEL)].map((m) => m.index + m[1].length);
    starts.forEach((start, k) => {
      let body = line.slice(start + 'Options:'.length, starts[k + 1] ?? line.length);
      if (!body.trim()) {
        // A bare label: count the bullet items below it, continuation lines
        // indented under their item.
        let count = 0;
        for (const next of lines.slice(index + 1)) {
          if (/^\s*[-*]\s/.test(next)) count += 1;
          else if (count && /^\s+\S/.test(next)) continue;
          else break;
        }
        lists.push({ line: index + 1, count });
        return;
      }
      // An option wrapped across lines keeps its backtick open until it ends.
      for (let j = index + 1; (body.match(/`/g) || []).length % 2 && j < lines.length; j += 1) {
        body += ` ${lines[j]}`;
      }
      // A parenthetical nudge may quote examples in backticks; they are not options.
      for (let prev; prev !== body; ) {
        prev = body;
        body = body.replace(/\([^()]*\)/g, '');
      }
      const count = (body.match(/`[^`]+`/g) || []).length;
      if (count) lists.push({ line: index + 1, count });
    });
  });
  return lists;
}

function outOfBounds(lists) {
  return lists.filter(({ count }) => count < 2 || count > 4);
}

function skillFiles(dir) {
  return fs.readdirSync(dir, { recursive: true })
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(dir, name));
}

test('every Options: list in the skills offers two to four options', () => {
  let found = 0;
  const offenders = [];
  for (const file of skillFiles(SKILLS)) {
    const rel = path.relative(path.join(__dirname, '..'), file).replaceAll('\\', '/');
    const lists = optionLists(fs.readFileSync(file, 'utf-8'));
    found += lists.length;
    for (const { line, count } of outOfBounds(lists)) offenders.push(`${rel}:${line} offers ${count}`);
  }
  assert.ok(found >= 20, `only ${found} Options: lists found — the scan went blind`);
  assert.deepEqual(offenders, []);
});

test('a one-option list and a five-option list are caught', () => {
  const fixture = [
    '**Q1** — "Continue?"',
    'Options: `Yes`',
    '',
    '**Q2** — "Which one?"',
    'Options:',
    '- `A` — first',
    '- `B` — second, with a',
    '  continuation line',
    '- `C`',
    '- `D`',
    '- `E`',
    '',
    '**Q3** — "Keep it?" Options: `Keep it (a wrapped',
    'option)`, `Drop it`, `Cancel` (for example `x`, `y`, `z`)',
  ].join('\n');
  assert.deepEqual(optionLists(fixture), [
    { line: 2, count: 1 },
    { line: 5, count: 5 },
    { line: 13, count: 3 },
  ]);
  assert.deepEqual(outOfBounds(optionLists(fixture)).map(({ line }) => line), [2, 5]);
});
