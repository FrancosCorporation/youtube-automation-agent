import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captionAt } from '../src/pulso-story-timing.mjs';

test('new page wins over lingering previous page', () => {
  const pages = [[{startMs: 0, endMs: 300}], [{startMs: 310, endMs: 600}]];
  assert.equal(captionAt(pages, 320).group, pages[1]);
  assert.equal(captionAt(pages, 320).active, 0);
});

test('word boundaries are half open, so previous word cannot remain active', () => {
  const pages = [[{startMs: 0, endMs: 300}, {startMs: 300, endMs: 600}]];
  assert.equal(captionAt(pages, 300).active, 1);
  assert.equal(captionAt(pages, 600).active, -1);
});

test('empty input, invalid time and actual silence have no active caption', () => {
  assert.deepEqual(captionAt([], 0), {group: null, active: -1});
  assert.deepEqual(captionAt([[{startMs: 100, endMs: 200}]], 0), {group: null, active: -1});
  assert.deepEqual(captionAt([[{startMs: 100, endMs: 200}]], 500), {group: null, active: -1});
  assert.deepEqual(captionAt([[{startMs: 100, endMs: 200}]], NaN), {group: null, active: -1});
});

test('every positive-duration word in the actual narration is active at its midpoint', () => {
  const { events } = JSON.parse(readFileSync(new URL('../public/pulso-story/word-timings.json', import.meta.url)));
  const pages = [];
  let group = [];
  for (const word of events) {
    group.push(word);
    if (/[.!?][”’"')\]]*$/.test(word.text) || group.length === 7) { pages.push(group); group = []; }
  }
  if (group.length) pages.push(group);
  for (const word of events.filter(word => word.endMs > word.startMs)) {
    const selected = captionAt(pages, (word.startMs + word.endMs) / 2);
    assert.equal(selected.group?.[selected.active]?.text, word.text, word.text);
  }
});

test('backward seeking restores exactly the same caption state', () => {
  const pages = [[{startMs: 0, endMs: 300}], [{startMs: 310, endMs: 600}]];
  const first = captionAt(pages, 150);
  captionAt(pages, 550);
  assert.deepEqual(captionAt(pages, 150), first);
});
