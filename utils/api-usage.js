/**
 * Controle de custo ativo — contador diário de chamadas a APIs pagas.
 * Sem isso o scheduler pode escalar custo sem ninguém notar até a fatura.
 *
 * Estado: data/state/api-usage.json → { "2026-10-10": { nvidia: 12, ... } }
 * Limite: NVIDIA_CALLS_PER_DAY no .env (padrão 200 — margem ~4x acima do
 * consumo normal de 5 vídeos/dia com crítico + SEO).
 */
const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', 'data', 'state', 'api-usage.json');

const today = () => new Date().toISOString().slice(0, 10);

async function readUsage() {
  try {
    const raw = JSON.parse(await fs.promises.readFile(STATE_PATH, 'utf8'));
    if (raw.date === today()) return raw;
    return { date: today(), counts: {} };
  } catch (_e) {
    return { date: today(), counts: {} };
  }
}

async function writeUsage(usage) {
  await fs.promises.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.promises.writeFile(STATE_PATH, JSON.stringify(usage, null, 2));
}

/** Quantas chamadas o serviço já fez hoje. */
async function usedToday(service) {
  const usage = await readUsage();
  return Number(usage.counts[service] || 0);
}

/** Registra 1 chamada. Nunca lança (contabilidade não pode derrubar o pipeline). */
async function recordCall(service) {
  try {
    const usage = await readUsage();
    usage.counts[service] = (Number(usage.counts[service] || 0) + 1);
    await writeUsage(usage);
  } catch (_e) { /* ignore */ }
}

/**
 * Gate: lança se o serviço estourou o limite diário — a geração falha cedo
 * (o scheduler alerta e tenta de novo no próximo ciclo) em vez de gastar sem controle.
 */
async function assertBudget(service, limitPerDay) {
  const used = await usedToday(service);
  if (used >= limitPerDay) {
    throw new Error(`orçamento diário de ${service} esgotado (${used}/${limitPerDay} chamadas hoje)`);
  }
  return used;
}

module.exports = { recordCall, usedToday, assertBudget, STATE_PATH };
