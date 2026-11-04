#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { reloadIdleScheduler } = require('../utils/scheduler-idle-reload');

async function main() {
  const root = path.resolve(__dirname, '..');
  const stateDir = path.resolve(root, process.env.STATE_DIR || 'data/state');
  const requestPath = path.join(stateDir, 'scheduler-reload-request.json');
  if (!fs.existsSync(requestPath)) return;
  const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  if (request.schemaVersion !== 1 || !Number.isSafeInteger(request.pid) || request.pid <= 1
    || !/^[a-f0-9]{64}$/.test(request.schedulerSha256 || '')) throw new Error('pedido de reload inválido');
  const scheduler = path.join(root, 'scripts/channel-scheduler.js');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(scheduler)).digest('hex');
  if (hash !== request.schedulerSha256) throw new Error('código mudou após o pedido de reload');
  const pid = Number(execFileSync(process.env.SYSTEMCTL_BIN || '/usr/bin/systemctl',
    ['--user', 'show', 'ai-video-scheduler.service', '--property=MainPID', '--value'], { encoding: 'utf8', timeout: 5000 }).trim());
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  const command = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
  if (!command.some(arg => arg === scheduler || arg === 'scripts/channel-scheduler.js')
    || fs.realpathSync(`/proc/${pid}/cwd`) !== root) throw new Error('PID não corresponde ao scheduler Pulso');
  if (pid !== request.pid) {
    fs.renameSync(requestPath, `${requestPath}.applied-${pid}`);
    console.log(`scheduler atualizado, PID ${pid}`);
    return;
  }
  const readHealth = () => JSON.parse(fs.readFileSync(path.join(stateDir, 'scheduler-health.json'), 'utf8'));
  const readChildren = () => fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean);
  const hasActiveLocks = () => {
    for (const dir of [...new Set([stateDir, path.join(root, 'data')])]) {
      for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.lock'))) {
        let record;
        try { record = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') continue; return true; }
        if (!Number.isSafeInteger(record.pid)) return true;
        try { process.kill(record.pid, 0); return true; }
        catch (error) { if (error.code !== 'ESRCH') return true; }
      }
    }
    return false;
  };
  const result = await reloadIdleScheduler({ pid, readHealth, readChildren, hasActiveLocks,
    signal: (target, name) => process.kill(target, name) });
  if (result.status === 'requested') console.log('reload solicitado em janela ociosa; systemd fará a retomada');
}

if (require.main === module) {
  main().catch(error => { console.error(`reload adiado: ${error.message}`); process.exitCode = 1; });
}
module.exports = { main };
