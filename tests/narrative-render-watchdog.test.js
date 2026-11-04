'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createNarrativeRenderWatchdog } = require('../utils/narrative-render-watchdog');

function fixture(options = {}) {
  let time = 0;
  const watchdog = createNarrativeRenderWatchdog({ logger: { info() {} }, now: () => time, stallMs: 100, ...options });
  return { ...watchdog, advance: ms => { time += ms; } };
}

test('software rendering and sequential encoding stay live while frames advance', () => {
  const watch = fixture();
  for (let frame = 1; frame <= 10; frame++) {
    watch.advance(90);
    watch.logger.info(`[narrative-remotion-landscape] Rendered ${frame}/10, time remaining: 1h`);
    assert.equal(watch.resourceCheck(), null);
  }
  for (let frame = 1; frame <= 10; frame++) {
    watch.advance(90);
    watch.logger.info(`Encoded ${frame}/10`);
    assert.equal(watch.resourceCheck(), null);
  }
  watch.advance(100);
  assert.equal(watch.resourceCheck().stage, 'narrative-render-stalled');
});

test('repeated, decreasing, unrelated or impossible counters cannot conceal a stalled render', () => {
  const watch = fixture();
  watch.logger.info('Rendered 8/10');
  for (const line of ['Rendered 8/10', 'Rendered 7/10', 'Rendered 11/10', 'Rendered 9/11', 'still working']) {
    watch.advance(20);
    watch.logger.info(line);
  }
  assert.equal(watch.resourceCheck().code, 'HYPERFRAMES_TIMEOUT');
});

test('an unresponsive browser times out even before its first frame', () => {
  const watch = fixture();
  watch.advance(100);
  assert.equal(watch.resourceCheck().code, 'HYPERFRAMES_TIMEOUT');
});

test('memory reserves still stop an actively progressing CPU render', () => {
  const error = Object.assign(new Error('memory reserve'), { code: 'HOST_RESOURCE_GATE' });
  const watch = fixture({ resourceCheck: () => error });
  watch.logger.info('Rendered 1/10');
  assert.equal(watch.resourceCheck(), error);
});

test('the next aspect receives its own progress window', () => {
  const landscape = fixture();
  landscape.advance(1000);
  const portrait = fixture();
  assert.equal(portrait.resourceCheck(), null);
  portrait.advance(90);
  portrait.logger.info('Rendered 1/10');
  assert.equal(portrait.resourceCheck(), null);
  assert.equal(landscape.resourceCheck().code, 'HYPERFRAMES_TIMEOUT');
});
