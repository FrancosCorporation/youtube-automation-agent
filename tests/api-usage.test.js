const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createUsageStore } = require('../utils/api-usage');

test('estado isolado pode compartilhar explicitamente o orçamento de provedores', async () => {
  await withTempState(async statePath => {
    const child = spawn(process.execPath, ['-e', "require('./utils/api-usage').reserveCall('shared-provider', 1).catch(error => { console.error(error); process.exitCode = 1; })"], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, STATE_DIR: path.join(path.dirname(statePath), 'isolated'), API_USAGE_STATE_PATH: statePath },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr))); });
    assert.equal(await createUsageStore({ statePath }).usedToday('shared-provider'), 1);
  });
});

async function withTempState(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'api-usage-test-'));
  try { await run(path.join(directory, 'api-usage.json')); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('reservas concorrentes entre processos respeitam o limite e preservam a contagem', async () => {
  await withTempState(async statePath => {
    const childCode = `
      const { createUsageStore } = require('./utils/api-usage');
      createUsageStore({ statePath: process.env.USAGE_TEST_PATH })
        .reserveCall('nvidia', 7)
        .then(() => process.stdout.write('reserved'))
        .catch(error => {
          if (error.code === 'BUDGET_EXHAUSTED') process.stdout.write('exhausted');
          else { console.error(error); process.exitCode = 1; }
        });
    `;
    const runOne = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', childCode], {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, USAGE_TEST_PATH: statePath },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `child exit ${code}`)));
    });

    const outcomes = await Promise.all(Array.from({ length: 18 }, runOne));
    assert.equal(outcomes.filter(value => value === 'reserved').length, 7);
    assert.equal(outcomes.filter(value => value === 'exhausted').length, 11);
    assert.equal(await createUsageStore({ statePath }).usedToday('nvidia'), 7);
  });
});

test('orçamento esgotado não incrementa e valida serviço e limite', async () => {
  await withTempState(async statePath => {
    const store = createUsageStore({ statePath });
    assert.equal(await store.reserveCall('nvidia', 1), 1);
    await assert.rejects(store.reserveCall('nvidia', 1), error => error.code === 'BUDGET_EXHAUSTED');
    assert.equal(await store.usedToday('nvidia'), 1);
    await assert.rejects(store.reserveCall('../nvidia', 10), TypeError);
    await assert.rejects(store.reserveCall('nvidia', 0), TypeError);
  });
});

test('atribui chamadas reservadas ao job e à operação sem guardar conteúdo editorial', async () => {
  await withTempState(async statePath => {
    const store = createUsageStore({ statePath });
    const jobId = 'video-job-20261017';
    assert.equal(await store.reserveCall('nvidia', 5, { jobId, operation: 'script-generation' }), 1);
    assert.equal(await store.reserveCall('nvidia', 5, { jobId, operation: 'script-review' }), 2);
    await store.recordCall('nvidia', { jobId, operation: 'script-review' });
    const usage = JSON.parse(await fs.readFile(statePath, 'utf8'));

    assert.deepEqual(usage.counts, { nvidia: 3 });
    assert.deepEqual(usage.byJob, {
      [jobId]: {
        'script-generation': { nvidia: 1 },
        'script-review': { nvidia: 2 }
      }
    });
    assert.equal(await store.usedToday('nvidia'), 3);
    assert.equal(JSON.stringify(usage).includes('topic'), false);
    assert.equal(JSON.stringify(usage).includes('sourceContext'), false);
  });
});

test('atribuição inválida é recusada antes de reservar orçamento', async () => {
  await withTempState(async statePath => {
    const store = createUsageStore({ statePath });
    await assert.rejects(store.reserveCall('nvidia', 5, { jobId: '../unsafe', operation: 'script-generation' }), TypeError);
    assert.equal(await store.usedToday('nvidia'), 0);
  });
});

test('arquivo corrompido falha fechado e permanece intacto', async () => {
  await withTempState(async statePath => {
    const corrupt = '{not valid json';
    await fs.writeFile(statePath, corrupt, { mode: 0o600 });
    const store = createUsageStore({ statePath });
    await assert.rejects(store.reserveCall('nvidia', 10), /estado de uso ilegível/);
    assert.equal(await fs.readFile(statePath, 'utf8'), corrupt);
  });
});

test('recupera reaper abandonado quando o dono do lock morreu', async () => {
  await withTempState(async statePath => {
    const lockPath = `${statePath}.lock`;
    const reaperPath = `${lockPath}.reaper`;
    const staleOwner = JSON.stringify({ pid: 2147483647, createdAt: '2026-10-17T00:00:00.000Z' });
    const oldTime = new Date(Date.now() - 120000);
    await fs.writeFile(lockPath, staleOwner, { mode: 0o600 });
    await fs.writeFile(reaperPath, staleOwner, { mode: 0o600 });
    await fs.utimes(lockPath, oldTime, oldTime);
    await fs.utimes(reaperPath, oldTime, oldTime);

    const store = createUsageStore({ statePath, lockTimeoutMs: 1000 });
    assert.equal(await store.reserveCall('nvidia', 1), 1);
    assert.deepEqual(JSON.parse(await fs.readFile(statePath, 'utf8')), {
      date: new Date().toISOString().slice(0, 10), counts: { nvidia: 1 }
    });
    await assert.rejects(fs.access(lockPath));
    await assert.rejects(fs.access(reaperPath));
  });
});

test('preserva reaper antigo enquanto o processo dono ainda está vivo', async () => {
  await withTempState(async statePath => {
    const lockPath = `${statePath}.lock`;
    const reaperPath = `${lockPath}.reaper`;
    const staleOwner = JSON.stringify({ pid: 2147483647, createdAt: '2026-10-17T00:00:00.000Z' });
    const liveOwner = JSON.stringify({ pid: process.pid, createdAt: '2026-10-17T00:00:00.000Z' });
    const oldTime = new Date(Date.now() - 120000);
    await fs.writeFile(lockPath, staleOwner, { mode: 0o600 });
    await fs.writeFile(reaperPath, liveOwner, { mode: 0o600 });
    await fs.utimes(lockPath, oldTime, oldTime);
    await fs.utimes(reaperPath, oldTime, oldTime);

    const store = createUsageStore({ statePath, lockTimeoutMs: 120 });
    await assert.rejects(store.reserveCall('nvidia', 1), /timeout aguardando o lock de orçamento/);
    assert.equal(await fs.readFile(lockPath, 'utf8'), staleOwner);
    assert.equal(await fs.readFile(reaperPath, 'utf8'), liveOwner);
    await assert.rejects(fs.access(statePath));
  });
});

test('reserva troca o estado vencido no limite do dia UTC e cria arquivo privado', async () => {
  await withTempState(async statePath => {
    let currentDate = new Date('2026-10-12T23:59:59.999Z');
    const store = createUsageStore({ statePath, now: () => currentDate });
    await store.recordCall('nvidia', { jobId: 'video-job-20261017', operation: 'script-generation' });
    currentDate = new Date('2026-10-13T00:00:00.000Z');
    assert.equal(await store.usedToday('nvidia'), 0);
    await store.reserveCall('nvidia', 3);
    const usage = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const stat = await fs.stat(statePath);
    assert.deepEqual(usage, { date: '2026-10-13', counts: { nvidia: 1 } });
    assert.equal(stat.mode & 0o777, 0o600);
  });
});

test('sem limite local ainda contabiliza chamadas e atribuição', async () => {
  await withTempState(async statePath => {
    const store = createUsageStore({ statePath });
    for (let i = 0; i < 3; i++) {
      await store.reserveCall('nvidia', null, { jobId: 'video-job-20261102', operation: 'narrative-scene-author' });
    }
    const usage = JSON.parse(await fs.readFile(statePath, 'utf8'));
    assert.equal(usage.counts.nvidia, 3);
    assert.equal(usage.byJob['video-job-20261102']['narrative-scene-author'].nvidia, 3);
  });
});
