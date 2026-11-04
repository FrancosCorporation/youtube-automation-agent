#!/usr/bin/env bash
set -euo pipefail

systemctl_bin="${SYSTEMCTL_BIN:-/usr/bin/systemctl}"
service_unit="ai-video-scheduler.service"

if "$systemctl_bin" --user is-active --quiet "$service_unit"; then
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  /usr/bin/node "$script_dir/reload-scheduler-when-idle.js"
  exit 0
fi

# Clear systemd's rate-limit state before the periodic guard retries a failed
# service start. This is a no-op for a unit that has not entered failed state.
"$systemctl_bin" --user reset-failed "$service_unit"
exec "$systemctl_bin" --user start "$service_unit"
