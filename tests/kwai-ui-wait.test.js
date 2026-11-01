const assert = require('node:assert/strict');
const test = require('node:test');
const { waitForKwaiUi } = require('../scripts/upload-to-socials');

test('Kwai UI waiter tolerates transient empty accessibility dumps', async () => {
  let reads = 0;
  const screenshots = [];
  const nodes = await waitForKwaiUi({
    dumpUI: async () => {
      reads += 1;
      return reads < 3 ? [] : [{ text: 'Post composer' }];
    },
    screencap: async label => screenshots.push(label)
  }, current => current.some(node => node.text === 'Post composer'), 'o compositor', { timeoutMs: 6000 });

  assert.equal(reads, 3);
  assert.equal(nodes[0].text, 'Post composer');
  assert.deepEqual(screenshots, []);
});

test('Kwai UI waiter captures diagnostics and fails closed only at the timeout', async () => {
  const screenshots = [];
  const startedAt = Date.now();
  await assert.rejects(waitForKwaiUi({
    dumpUI: async () => [],
    screencap: async label => screenshots.push(label)
  }, () => false, 'o compositor', { timeoutMs: 1200 }), /hierarquia Android vazia/);

  assert.ok(Date.now() - startedAt >= 1200);
  assert.deepEqual(screenshots, ['ui_hierarquia_vazia']);
});

test('Kwai UI waiter captures a screenshot when a nonempty hierarchy never reaches the target screen', async () => {
  const screenshots = [];
  await assert.rejects(waitForKwaiUi({
    dumpUI: async () => [{ rid: 'kwai.lite.video.product:id/hashtag_text', text: 'Hashtag' }],
    screencap: async label => screenshots.push(label)
  }, () => false, 'o compositor limpo', { timeoutMs: 5 }), /não confirmou o compositor limpo/);

  assert.deepEqual(screenshots, ['ui_timeout']);
});

test('Kwai UI waiter passes the remaining deadline without a one-second floor', async () => {
  const budgets = [];
  await assert.rejects(waitForKwaiUi({
    dumpUI: async options => { budgets.push(options.timeoutMs); return [{ text: 'Other screen' }]; },
    screencap: async () => {}
  }, () => false, 'o editor', { timeoutMs: 15 }), /não confirmou/);
  assert.ok(budgets.length > 0);
  assert.ok(budgets.every(value => value > 0 && value <= 15));
});
