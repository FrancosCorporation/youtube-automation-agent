#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { createProjectBackup, listExpiredProjectBackups, pruneProjectBackups, restoreProjectBackup } = require('../utils/project-backup');

function parseArguments(argv) {
  const [command, ...args] = argv;
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const item = args[index];
    if (!item.startsWith('--')) throw new Error(`argumento inesperado: ${item}`);
    const separator = item.indexOf('=');
    const key = item.slice(2, separator < 0 ? undefined : separator);
    if (key === 'apply') {
      if (separator >= 0) throw new Error('--apply não recebe valor');
      options.apply = true;
      continue;
    }
    const inlineValue = separator < 0 ? undefined : item.slice(separator + 1);
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith('--')) throw new Error(`valor obrigatório para --${key}`);
    options[key] = value;
  }
  return { command, options };
}

function resolveFrom(base, value, fallback) {
  const selected = value || fallback;
  return path.isAbsolute(selected) ? selected : path.resolve(base, selected);
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const workspaceRoot = path.resolve(options.workspace || path.join(__dirname, '../..'));
  const appRoot = path.join(workspaceRoot, 'youtube-automation-agent');
  require('dotenv').config({ path: path.join(appRoot, '.env') });

  if (command === 'backup') {
    if (!options.destination) throw new Error('informe --destination fora do workspace para criar o backup');
    const databasePath = resolveFrom(appRoot, options.database || process.env.YOUTUBE_AUTOMATION_DB_PATH, 'data/youtube_automation.db');
    const stateDirectory = resolveFrom(appRoot, options.state || process.env.STATE_DIR, 'data/state');
    const result = await createProjectBackup({
      workspaceRoot,
      destinationRoot: path.resolve(options.destination),
      databasePath,
      stateDirectory
    });
    console.log(`Backup validado: ${result.path}`);
    console.log(`${result.manifest.files.length} arquivos; SQLite quick_check aprovado; dados privados com permissão 0600.`);
    if (result.manifest.skippedSymlinks.length) console.warn(`${result.manifest.skippedSymlinks.length} link(s) simbólico(s) foram omitidos.`);
    return;
  }

  if (command === 'restore') {
    if (!options.snapshot || !options.to) throw new Error('informe --snapshot e --to; a restauração exige diretório novo e isolado');
    const result = await restoreProjectBackup({ backupPath: options.snapshot, restoreRoot: options.to, workspaceRoot });
    console.log(`Restauração isolada validada em: ${result.path}`);
    console.log(`${result.manifest.files.length} arquivos verificados por SHA-256; JSON e SQLite validados.`);
    return;
  }

  if (command === 'prune') {
    if (!options.destination || !options.days) throw new Error('informe --destination e --days para a retenção explícita');
    const pruneOptions = { destinationRoot: options.destination, retentionDays: options.days, workspaceRoot };
    if (!options.apply) {
      const candidates = await listExpiredProjectBackups(pruneOptions);
      console.log(`Prévia de retenção: ${candidates.length} snapshot(s) elegível(is); nenhum arquivo foi removido.`);
      for (const name of candidates) console.log(name);
      if (candidates.length) console.log('Para remover após revisar a retenção e o destino: repita o comando com --apply.');
      return;
    }
    const removed = await pruneProjectBackups(pruneOptions);
    console.log(`Backups antigos removidos: ${removed.length}`);
    for (const name of removed) console.log(name);
    return;
  }

  throw new Error('uso: node scripts/project-backup.js backup --destination <fora-do-workspace> | restore --snapshot <backup> --to <diretório-novo> | prune --destination <pasta> --days <dias> [--apply]');
}

main().catch(error => {
  console.error(`Falha no backup/restauração: ${error.message}`);
  process.exitCode = 1;
});
