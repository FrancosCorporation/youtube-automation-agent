'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const scriptPath = path.join(__dirname, '..', 'scripts', 'wait-for-docker.sh');

function runWaiter({ succeedsAt, attempts }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-readiness-'));
  const dockerCalls = path.join(directory, 'calls');
  const fakeDocker = path.join(directory, 'docker');
  fs.writeFileSync(fakeDocker, `#!/bin/sh
count=0
[ ! -f "$DOCKER_CALLS" ] || count=$(cat "$DOCKER_CALLS")
count=$((count + 1))
printf '%s' "$count" > "$DOCKER_CALLS"
[ "$count" -ge "${succeedsAt}" ]
`, { mode: 0o700 });

  const result = spawnSync('bash', [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DOCKER_BIN: fakeDocker,
      DOCKER_CALLS: dockerCalls,
      DOCKER_WAIT_ATTEMPTS: String(attempts),
      DOCKER_WAIT_INTERVAL_SECONDS: '0'
    }
  });
  const calls = Number(fs.readFileSync(dockerCalls, 'utf8'));
  fs.rmSync(directory, { recursive: true, force: true });
  return { result, calls };
}

test('waiter aguarda o daemon Docker e conclui quando fica pronto', () => {
  const { result, calls } = runWaiter({ succeedsAt: 3, attempts: 5 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls, 3);
});

test('waiter falha claramente quando o Docker não fica pronto no limite', () => {
  const { result, calls } = runWaiter({ succeedsAt: 4, attempts: 2 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Docker não ficou pronto após 2 verificações/);
  assert.equal(calls, 2);
});
