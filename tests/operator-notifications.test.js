'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sqlite3 = require('sqlite3').verbose();
const { Database } = require('../database/db');
const { OperatorService } = require('../utils/operator-service');

const WEBHOOK_ENV = 'NOTIFICATION_WEBHOOK_URL';

async function withWebhook(value, run) {
  const previous = process.env[WEBHOOK_ENV];
  if (value === undefined) delete process.env[WEBHOOK_ENV];
  else process.env[WEBHOOK_ENV] = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[WEBHOOK_ENV];
    else process.env[WEBHOOK_ENV] = previous;
  }
}

function createHarness(httpPost) {
  const calls = [];
  const persisted = [];
  const warnings = [];
  const db = {
    async getSetting() { return 'true'; },
    async createNotification(notification) {
      calls.push({ kind: 'create', notification });
      return 'notice-fixture';
    },
    async updateNotificationData(id, data) { persisted.push({ id, data }); }
  };
  const logger = { warn(message) { warnings.push(String(message)); } };
  return {
    service: new OperatorService(db, { httpPost, logger }),
    calls,
    persisted,
    warnings
  };
}

test('operator notification persists webhook success and failure without logging the URL', async () => {
  await withWebhook('https://hooks.example.test/private-path/super-secret-token', async () => {
    const outcomes = [
      { status: 204 },
      { status: 400 },
      { status: 500 },
      Object.assign(new Error('request failed for https://hooks.example.test/private-path/super-secret-token'), { code: 'ECONNABORTED' })
    ];
    const h = createHarness(async () => {
      const result = outcomes.shift();
      if (result instanceof Error) throw result;
      return result;
    });

    for (let index = 0; index < 4; index += 1) {
      assert.equal(await h.service.notify({ title: 'Falha sintética', message: 'Fixture local', data: { source: 'test' } }), 'notice-fixture');
    }

    assert.deepEqual(h.persisted.map(entry => entry.data.webhookDelivery), [
      { status: 'delivered' },
      { status: 'failed', httpStatus: 400 },
      { status: 'failed', httpStatus: 500 },
      { status: 'failed', httpStatus: null, errorCode: 'ECONNABORTED' }
    ]);
    assert.ok(h.warnings.length >= 3);
    assert.ok(h.warnings.every(message => !message.includes('super-secret-token')));
    assert.equal(h.calls.length, 4);
  });
});

test('operator notification records an unconfigured webhook without making a request', async () => {
  await withWebhook(undefined, async () => {
    let requests = 0;
    const h = createHarness(async () => { requests += 1; return { status: 204 }; });
    await h.service.notify({ title: 'Local only', message: 'No external destination' });
    assert.equal(requests, 0);
    assert.deepEqual(h.persisted[0].data.webhookDelivery, { status: 'not_configured' });
  });
});

test('database persists webhook delivery outcome in notification data', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'operator-notification-'));
  const database = Object.create(Database.prototype);
  database.db = new sqlite3.Database(path.join(temporaryDirectory, 'fixture.sqlite'));
  try {
    await database.executeQuery('CREATE TABLE notifications (id TEXT PRIMARY KEY, data TEXT)');
    await database.executeQuery('INSERT INTO notifications (id, data) VALUES (?, ?)', ['notice-fixture', '{}']);
    await database.updateNotificationData('notice-fixture', {
      webhookDelivery: { status: 'delivered' }
    });
    const row = await database.getRow('SELECT data FROM notifications WHERE id = ?', ['notice-fixture']);
    assert.deepEqual(JSON.parse(row.data), { webhookDelivery: { status: 'delivered' } });
  } finally {
    await new Promise((resolve, reject) => database.db.close(error => error ? reject(error) : resolve()));
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
