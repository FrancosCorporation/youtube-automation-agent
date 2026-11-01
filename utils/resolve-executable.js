'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function expandHome(candidate) {
  if (candidate === '~') return os.homedir();
  if (candidate.startsWith(`~${path.sep}`)) return path.join(os.homedir(), candidate.slice(2));
  return candidate;
}

function resolveExecutable(command, env = process.env) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const requested = expandHome(command.trim());
  const isPath = path.isAbsolute(requested) || requested.includes(path.sep);
  const candidates = isPath
    ? [path.resolve(requested)]
    : String(env.PATH || '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, requested));
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return path.resolve(candidate);
    } catch { /* próximo caminho */ }
  }
  return null;
}

module.exports = { resolveExecutable };
