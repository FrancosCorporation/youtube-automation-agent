'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

function videoIdForPath(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new TypeError('caminho do vídeo obrigatório para gerar ID de observabilidade');
  }
  const stablePath = path.resolve(candidate);
  const digest = crypto.createHash('sha256').update(stablePath).digest('hex').slice(0, 24);
  return `vid_${digest}`;
}

function createJobId() {
  return crypto.randomUUID();
}

module.exports = { createJobId, videoIdForPath };
