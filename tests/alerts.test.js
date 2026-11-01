'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getAlertChannelStatus, notifyFailure, notifyTelegram, notifyWebhook } = require('../utils/alerts');

const ENV_KEYS = ['NOTIFICATION_WEBHOOK_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID'];

async function withEnv(values, run) {
  const previous = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  const originalError = console.error;
  console.error = () => {};
  for (const key of ENV_KEYS) {
    if (Object.hasOwn(values, key)) process.env[key] = values[key];
    else delete process.env[key];
  }
  try {
    return await run();
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    console.error = originalError;
  }
}

test('webhook considers only HTTP 2xx delivered', async () => {
  await withEnv({ NOTIFICATION_WEBHOOK_URL: ' https://hooks.example.test/private ' }, async () => {
    const calls = [];
    for (const [status, expected] of [[200, true], [204, true], [400, false], [500, false]]) {
      const result = await notifyWebhook('falha de teste', {
        postJsonImpl: async (url, payload) => {
          calls.push({ url, payload });
          return status;
        }
      });
      assert.equal(result, expected, `HTTP ${status}`);
    }
    assert.equal(calls.length, 4);
    assert.equal(calls[0].url, 'https://hooks.example.test/private');
    assert.equal(calls[0].payload.text, 'falha de teste');
  });
});

test('webhook rejects malformed, insecure, or credential-bearing endpoints without a request', async () => {
  for (const endpoint of ['not-a-url', 'http://hooks.example.test/private', 'https://user:password@hooks.example.test/private']) {
    await withEnv({ NOTIFICATION_WEBHOOK_URL: endpoint }, async () => {
      let calls = 0;
      assert.equal(await notifyWebhook('falha de teste', {
        postJsonImpl: async () => { calls += 1; return 204; }
      }), false);
      assert.equal(calls, 0);
      assert.equal(getAlertChannelStatus().webhook, 'invalid');
    });
  }
});

test('Telegram considers only HTTP 2xx delivered', async () => {
  await withEnv({ TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_ADMIN_CHAT_ID: 'test-chat' }, async () => {
    for (const [status, expected] of [[200, true], [400, false], [500, false]]) {
      const result = await notifyTelegram('falha de teste', {
        postJsonImpl: async url => {
          assert.match(url, /\/bottest-token\/sendMessage$/);
          return status;
        }
      });
      assert.equal(result, expected, `HTTP ${status}`);
    }
  });
});

test('failure alert aggregates channels, reports timeout as failure and does not leak credentials', async () => {
  await withEnv({
    NOTIFICATION_WEBHOOK_URL: 'https://hooks.example.test/private',
    TELEGRAM_BOT_TOKEN: 'secret-test-token',
    TELEGRAM_ADMIN_CHAT_ID: 'private-chat'
  }, async () => {
    const partial = await notifyFailure('falha', 'detalhes', {
      postJsonImpl: async url => url.includes('telegram.org') ? 500 : 204
    });
    assert.equal(partial, true);

    const failed = await notifyFailure('falha', '', {
      postJsonImpl: async () => { throw new Error('timeout secret-test-token'); }
    });
    assert.equal(failed, false);
  });
});

test('outbound alert text redacts credentials and private error fields', async () => {
  await withEnv({ NOTIFICATION_WEBHOOK_URL: 'https://hooks.example.test/private' }, async () => {
    let payload;
    const sent = await notifyFailure(
      'Falha com token=title-secret',
      'authorization: Bearer bearer-secret password=private-password https://api.telegram.org/bot123456:telegram-secret/sendMessage?chat_id=private-chat',
      {
        postJsonImpl: async (_url, body) => {
          payload = body;
          return 204;
        }
      }
    );

    assert.equal(sent, true);
    assert.equal(payload.text, payload.content);
    assert.match(payload.text, /Falha com token=\[REDACTED\]/);
    assert.match(payload.text, /Bearer \[REDACTED\]/);
    assert.doesNotMatch(payload.text, /title-secret|bearer-secret|private-password|telegram-secret|private-chat/);
  });
});

test('alerts remain a no-op when no recipient is configured', async () => {
  await withEnv({}, async () => {
    let calls = 0;
    assert.equal(await notifyFailure('falha', '', { postJsonImpl: async () => { calls++; return 200; } }), false);
    assert.equal(calls, 0);
  });
});

test('alert channel status distinguishes missing, incomplete, and configured sinks without exposing values', () => {
  assert.deepEqual(getAlertChannelStatus({}), { webhook: 'missing', telegram: 'missing' });
  assert.deepEqual(getAlertChannelStatus({ TELEGRAM_BOT_TOKEN: ' token ' }), {
    webhook: 'missing',
    telegram: 'incomplete'
  });
  assert.deepEqual(getAlertChannelStatus({
    NOTIFICATION_WEBHOOK_URL: ' https://hooks.example.test/private ',
    TELEGRAM_BOT_TOKEN: 'token-secret',
    TELEGRAM_ADMIN_CHAT_ID: 'chat-secret'
  }), { webhook: 'configured', telegram: 'configured' });
  assert.deepEqual(getAlertChannelStatus({ NOTIFICATION_WEBHOOK_URL: 'not-a-url' }), {
    webhook: 'invalid',
    telegram: 'missing'
  });
});
