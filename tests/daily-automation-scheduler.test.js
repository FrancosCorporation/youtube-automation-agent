'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { DailyAutomation } = require('../schedules/daily-automation');

function loadCron() {
  const packagePath = process.env.NODE_CRON_TEST_PACKAGE;
  return packagePath ? require(path.resolve(packagePath)) : require('node-cron');
}

test('daily automation creates, starts, reports, and stops all eight scheduled jobs', async () => {
  const nativeCron = loadCron();
  const createCalls = [];
  const scheduleCalls = [];
  const cron = {
    ...(typeof nativeCron.createTask === 'function' ? {
      createTask: (...args) => {
        createCalls.push(args[0]);
        return nativeCron.createTask(...args);
      }
    } : {}),
    schedule: (...args) => {
      scheduleCalls.push({ expression: args[0], options: args[2] });
      return nativeCron.schedule(...args);
    }
  };
  const logger = { info() {}, success() {}, warn() {}, error() {}, startTimer() {} };
  const automation = new DailyAutomation([], {}, { cron, logger });

  try {
    await automation.setupScheduledTasks();
    assert.equal(automation.scheduledTasks.size, 8);

    if (typeof nativeCron.createTask === 'function') {
      assert.equal(createCalls.length, 8);
      assert.equal(scheduleCalls.length, 0);
    } else {
      assert.equal(scheduleCalls.length, 8);
      assert.ok(scheduleCalls.every(call => call.options?.scheduled === false));
    }

    const status = await automation.getAutomationStatus();
    assert.equal(status.scheduledTasks.length, 8);
    assert.ok(status.scheduledTasks.every(task => task.running), 'todos os jobs iniciados devem aparecer ativos');

    await automation.stopAutomation();
    const stopped = await automation.getAutomationStatus();
    assert.ok(stopped.scheduledTasks.every(task => !task.running), 'todos os jobs devem parar sem deixar timers ativos');
  } finally {
    await automation.stopAutomation();
    for (const task of automation.scheduledTasks.values()) task.destroy?.();
  }
});

test('node-cron v4 idle tasks are active and use createTask before start', async () => {
  const created = [];
  const cron = {
    createTask(expression, callback) {
      const task = {
        expression,
        callback,
        status: 'stopped',
        start() { this.status = 'idle'; },
        stop() { this.status = 'stopped'; },
        getStatus() { return this.status; }
      };
      created.push(task);
      return task;
    },
    schedule() { throw new Error('node-cron v4 must use createTask for suspended jobs'); }
  };
  const logger = { info() {}, success() {}, warn() {}, error() {}, startTimer() {} };
  const automation = new DailyAutomation([], {}, { cron, logger });

  await automation.setupScheduledTasks();
  assert.equal(created.length, 8);
  assert.ok(created.every(task => task.status === 'idle' && typeof task.callback === 'function'));
  assert.ok((await automation.getAutomationStatus()).scheduledTasks.every(task => task.running));

  await automation.stopAutomation();
  assert.ok((await automation.getAutomationStatus()).scheduledTasks.every(task => !task.running));
});
