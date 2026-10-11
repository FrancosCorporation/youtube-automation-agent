#!/bin/bash
# Prepara o host para o redroid (Android em Docker, emulador on-demand do Kwai).
# Rodar UMA vez com sudo:
#   sudo bash scripts/redroid-host-setup.sh
set -e

# 1) módulo binder (kernel Android) — sem ele o redroid não sobe
if ! lsmod | grep -q binder; then
  modprobe binder_linux devices="binder,hwbinder,vndbinder" 2>/dev/null || modprobe binder_linux
fi

# 2) binderfs (dispositivos binder para os containers)
mkdir -p /dev/binderfs
mountpoint -q /dev/binderfs || mount -t binder binder /dev/binderfs

# 3) persiste entre reboots
echo "binder_linux" > /etc/modules-load.d/binder.conf
grep -qE "^binder /dev/binderfs" /etc/fstab 2>/dev/null || \
  echo "binder /dev/binderfs binder defaults 0 0" >> /etc/fstab

# 4) permissões cgroup para o LXC interno do redroid
sysctl -w kernel.unprivileged_userns_clone=1 2>/dev/null || true

echo "OK: binder carregado + persistido ($(ls /dev/binderfs 2>/dev/null | head -3 | tr '\n' ' '))"
