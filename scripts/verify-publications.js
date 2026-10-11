import fs from 'fs/promises';
import { execFileSync } from 'child_process';
import path from 'path';

const LEDGER_PATH = path.join(process.cwd(), 'data', 'state', 'publications.json');

function httpHead(url) {
  return new Promise((resolve, reject) => {
    try {
      const curl = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', '15', url], { encoding: 'utf8' }).trim();
      resolve(parseInt(curl) || null);
    } catch (e) {
      reject(new Error('curl error: ' + (e.message || 'unknown')));
    }
  });
}

async function main() {
  let ledgerContent = await fs.readFile(LEDGER_PATH, 'utf8');
  let ledger = JSON.parse(ledgerContent).filter(e => e);

  if (!ledger.length) { console.log('Nenhuma publicação no ledger.'); process.exit(0); }

  const results = [];

  for (const entry of ledger) {
    const url = entry.url || '';
    let statusCode = 0, online = false, error = null;
    try {
      statusCode = await httpHead(url);
      if (statusCode !== null && statusCode >= 200 && statusCode < 400) online = true;
    } catch (e) {
      error = (e.message || '').slice(0, 80);
    }
    results.push({ entry, online, statusCode, error });
  }

  // Atualizar ledger
  for (const r of results) {
    const idx = ledger.findIndex(e => e.id === r.entry.id);
    if (idx >= 0) {
      ledger[idx].checkedAt = new Date().toISOString();
      ledger[idx].checkResult = { online: r.online, statusCode: r.statusCode, error: r.error };
    }
  }
  await fs.writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2));

  let ok = 0, off = 0, errs = 0;
  results.forEach(r => { if (r.online) ok++; else off++; if (r.error) errs++; });
  console.log(`\n=== RELATÓRIO DE VERIFICAÇÃO ===`);
  console.log(`Total: ${ledger.length} | Online: ${ok} | Offline/Erro: ${off + errs}`);
  results.forEach(r => {
    const s = r.online ? '🟢' : (r.error ? '⚠️' : '❌');
    const id = r.entry.id?.slice(0,8) || '?';
    console.log(`${s} [${r.entry.platform}] ${id} — ${r.online ? 'online' : (r.error ? 'erro' : 'offline')} (status ${r.statusCode})`);
  });
}

main().catch(e => { console.error('verify error:', e.message); process.exit(1); });