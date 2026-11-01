'use strict';

const { Transform } = require('node:stream');
const { StringDecoder } = require('node:string_decoder');
const { sanitizeLogText } = require('./log-sanitizer');

const MAX_LOG_LINE_LENGTH = 8192;

function createSanitizedLogStream() {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let droppingLongLine = false;

  return new Transform({
    transform(chunk, _encoding, callback) {
      let text = decoder.write(chunk);
      while (text) {
        if (droppingLongLine) {
          const newline = text.indexOf('\n');
          if (newline < 0) return callback();
          text = text.slice(newline + 1);
          droppingLongLine = false;
          this.push('[oversized diagnostic line redacted]\n');
          continue;
        }

        const newline = text.indexOf('\n');
        if (newline < 0) {
          pending += text;
          if (pending.length > MAX_LOG_LINE_LENGTH) {
            pending = '';
            droppingLongLine = true;
          }
          break;
        }

        const line = pending + text.slice(0, newline);
        pending = '';
        text = text.slice(newline + 1);
        this.push(line.length > MAX_LOG_LINE_LENGTH
          ? '[oversized diagnostic line redacted]\n'
          : `${sanitizeLogText(line)}\n`);
      }
      callback();
    },
    flush(callback) {
      const remaining = decoder.end();
      if (droppingLongLine || pending.length + remaining.length > MAX_LOG_LINE_LENGTH) {
        this.push('[oversized diagnostic line redacted]');
      } else {
        const line = pending + remaining;
        if (line) this.push(sanitizeLogText(line));
      }
      callback();
    }
  });
}

module.exports = { createSanitizedLogStream, MAX_LOG_LINE_LENGTH };
