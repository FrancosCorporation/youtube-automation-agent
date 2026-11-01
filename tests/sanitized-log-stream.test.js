'use strict';

const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');
const { createSanitizedLogStream } = require('../utils/sanitized-log-stream');

async function sanitizeChunks(chunks) {
  const stream = Readable.from(chunks).pipe(createSanitizedLogStream());
  const output = [];
  for await (const chunk of stream) output.push(chunk.toString());
  return output.join('');
}

test('diagnostic stream sanitizes secrets split across chunks and keeps safe progress lines', async () => {
  const output = await sanitizeChunks([
    Buffer.from('[1/5] roteiro pronto\nAuthorization: Bearer split-'),
    Buffer.from('secret-value\nprompt: "private material"\n')
  ]);

  assert.match(output, /\[1\/5\] roteiro pronto/);
  assert.match(output, /Bearer \[REDACTED\]/);
  assert.doesNotMatch(output, /split-secret-value|private material/);
});

test('diagnostic stream drops overlong lines without truncating into a possible secret', async () => {
  const output = await sanitizeChunks([
    Buffer.from(`${'x'.repeat(9000)}\nafter long line\n`)
  ]);

  assert.match(output, /oversized diagnostic line redacted/);
  assert.match(output, /after long line/);
  assert.doesNotMatch(output, /x{100}/);
});
