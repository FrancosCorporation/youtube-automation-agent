'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const guardScript = path.join(__dirname, '..', 'scripts', 'ensure-ai-video-scheduler.sh');

function runGuard({ active }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-video-scheduler-guard-'));
  const callLog = path.join(directory, 'systemctl-calls.txt');
  const fakeSystemctl = path.join(directory, 'systemctl');
  fs.writeFileSync(fakeSystemctl, `#!/bin/sh
printf '%s\\n' "$*" >> "$SYSTEMCTL_CALL_LOG"
if [ "$1" = "--user" ] && [ "$2" = "is-active" ]; then
  [ "$TEST_SERVICE_ACTIVE" = "1" ]
elif [ "$1" = "--user" ] && [ "$2" = "reset-failed" ] && [ "$3" = "ai-video-scheduler.service" ]; then
  exit 0
elif [ "$1" = "--user" ] && [ "$2" = "start" ] && [ "$3" = "ai-video-scheduler.service" ]; then
  exit 0
else
  exit 9
fi
`, { mode: 0o700 });
  const result = spawnSync('bash', [guardScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SYSTEMCTL_BIN: fakeSystemctl,
      SYSTEMCTL_CALL_LOG: callLog,
      TEST_SERVICE_ACTIVE: active ? '1' : '0'
    }
  });
  const calls = fs.readFileSync(callLog, 'utf8').trim().split('\n');
  fs.rmSync(directory, { recursive: true, force: true });
  return { result, calls };
}

test('scheduler guard deixa o serviço ativo sem reiniciá-lo', () => {
  const { result, calls } = runGuard({ active: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, ['--user is-active --quiet ai-video-scheduler.service']);
});

test('scheduler guard inicia o serviço quando ele está parado', () => {
  const { result, calls } = runGuard({ active: false });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, [
    '--user is-active --quiet ai-video-scheduler.service',
    '--user reset-failed ai-video-scheduler.service',
    '--user start ai-video-scheduler.service'
  ]);
});
