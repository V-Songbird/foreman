'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// craft-prompt's SKILL.md only routes: each step lives in a sibling file. These
// pins keep every route, in order, and the clause that sends an area-only
// answer to dont-know.md.
const DIR = path.join(__dirname, '..', 'skills', 'craft-prompt');
const skill = fs.readFileSync(path.join(DIR, 'SKILL.md'), 'utf-8');

describe('craft-prompt skill routes', () => {
  test('SKILL.md sends each step to the file that holds it, in order', () => {
    let cursor = -1;
    for (const [heading, file] of [
      ['## Call 1 ', '(call-1.md)'],
      ['## Ground the file options', '(ground-files.md)'],
      ['## Call 2 ', '(call-2.md)'],
      ['## Call 3 ', '(call-3.md)'],
      ['## Call 4-N ', '(call-4.md)'],
      ['## When an answer is "I don\'t know"', '(dont-know.md)'],
      ['## Resolve the named files', '(resolve-files.md)'],
      ['## Call 5 ', '(../roadmap/destination-question.md)'],
      ['## Assemble the handoff', '(assemble.md)'],
      ['## Deliver', '(deliver.md)'],
    ]) {
      const at = skill.indexOf(heading);
      assert.ok(at > cursor, `${heading} missing or out of order`);
      const next = skill.indexOf('\n## ', at + 1);
      const section = skill.slice(at, next === -1 ? undefined : next);
      assert.ok(section.includes(file), `${heading} does not read ${file}`);
      cursor = at;
    }
  });

  test('every routed step file exists', () => {
    for (const file of ['call-1', 'ground-files', 'call-2', 'call-3', 'call-4', 'dont-know', 'resolve-files', 'assemble', 'deliver']) {
      assert.ok(fs.existsSync(path.join(DIR, `${file}.md`)), `${file}.md is missing`);
    }
  });

  test('an area-only Call 2 Q3 answer routes to dont-know.md', () => {
    const at = skill.indexOf('## When an answer is "I don\'t know"');
    const next = skill.indexOf('\n## ', at + 1);
    const flat = skill.slice(at, next).replace(/\s+/g, ' ');
    assert.match(flat, /Call 2 Q3 comes back as `I can only name the area` or names no file, read \[dont-know\.md\]\(dont-know\.md\)/);
  });
});

describe('craft-prompt review constraint', () => {
  // Anthropic's prompting guidance for current models: a severity or
  // conservatism filter in a review prompt lowers recall, so ask for every
  // finding with confidence and severity, or give a concrete bar.
  // https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5
  test('assemble.md asks for every finding with location, confidence and severity', () => {
    const flat = fs.readFileSync(path.join(DIR, 'assemble.md'), 'utf-8').replace(/\s+/g, ' ');
    assert.match(flat, /Report every finding you identify, including uncertain or low-severity ones, each with its location, a confidence level and an estimated severity/);
    assert.match(flat, /reporting that the work is sound is a valid outcome\. If a bar is given, apply it\./);
    assert.doesNotMatch(flat, /Flag only gaps/);
  });
});
