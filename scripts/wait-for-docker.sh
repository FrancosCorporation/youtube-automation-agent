#!/usr/bin/env bash
set -euo pipefail

docker_bin="${DOCKER_BIN:-/usr/bin/docker}"
max_attempts="${DOCKER_WAIT_ATTEMPTS:-120}"
interval_seconds="${DOCKER_WAIT_INTERVAL_SECONDS:-5}"

if [[ ! "$max_attempts" =~ ^[1-9][0-9]*$ || ! "$interval_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  printf '%s\n' 'DOCKER_WAIT_ATTEMPTS ou DOCKER_WAIT_INTERVAL_SECONDS inválido' >&2
  exit 2
fi

for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  if "$docker_bin" info >/dev/null 2>&1; then
    exit 0
  fi
  if ((attempt < max_attempts)); then
    sleep "$interval_seconds"
  fi
done

printf 'Docker não ficou pronto após %s verificações\n' "$max_attempts" >&2
exit 1
