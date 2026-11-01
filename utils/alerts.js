/**
 * Alertas simples de operação — avisa um humano quando o pipeline 24h falha.
 * Sem isso, falhas no channel-scheduler ficam só no log local e podem passar
 * dias sem ninguém notar que o canal parou de publicar.
 *
 * Suporta dois canais opcionais (configuráveis via .env), nenhum obrigatório:
 *   - NOTIFICATION_WEBHOOK_URL: POST JSON genérico (compatível com Slack/Discord
 *     incoming webhook — ambos aceitam {"text": "..."} / {"content": "..."}).
 *   - TELEGRAM_BOT_TOKEN + TELEGRAM_ADMIN_CHAT_ID: mensagem via Bot API.
 * Se nenhuma estiver configurada, não envia nada; o scheduler registra somente
 * o estado configurado/incompleto/ausente no início, sem expor os valores.
 */
const https = require('https');
const { URL } = require('url');
const { sanitizeLogText } = require('./log-sanitizer');

function postJson(urlString, payload, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlString); } catch (error) { return reject(error); }
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs
    }, res => {
      // Drena a resposta pra não deixar socket pendurado; não precisamos do corpo.
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

function successfulHttpStatus(status) {
  const code = Number(status);
  return Number.isInteger(code) && code >= 200 && code < 300;
}

function inspectWebhookConfiguration(value) {
  const raw = String(value || '').trim();
  if (!raw) return { status: 'missing', url: null };
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
      return { status: 'invalid', url: null };
    }
    return { status: 'configured', url };
  } catch (_error) {
    return { status: 'invalid', url: null };
  }
}

function getAlertChannelStatus(env = process.env) {
  const webhook = inspectWebhookConfiguration(env.NOTIFICATION_WEBHOOK_URL).status;
  const hasTelegramToken = Boolean(String(env.TELEGRAM_BOT_TOKEN || '').trim());
  const hasTelegramChat = Boolean(String(env.TELEGRAM_ADMIN_CHAT_ID || '').trim());
  const telegram = hasTelegramToken && hasTelegramChat
    ? 'configured'
    : (hasTelegramToken || hasTelegramChat ? 'incomplete' : 'missing');
  return {
    webhook,
    telegram
  };
}

async function notifyWebhook(message, { postJsonImpl = postJson } = {}) {
  const configuration = inspectWebhookConfiguration(process.env.NOTIFICATION_WEBHOOK_URL);
  if (configuration.status === 'missing') return false;
  if (configuration.status !== 'configured') {
    console.error('[alerts] webhook configuration is invalid; alert not sent');
    return false;
  }
  try {
    // Formato aceito tanto por Slack quanto por Discord incoming webhooks.
    const status = await postJsonImpl(configuration.url.toString(), { text: message, content: message });
    if (!successfulHttpStatus(status)) {
      console.error(`[alerts] webhook recusou o alerta (HTTP ${String(status)})`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[alerts] webhook falhou: ${String(error.message || error).replace(configuration.url.toString(), '[webhook]').slice(0, 200)}`);
    return false;
  }
}

async function notifyTelegram(message, { postJsonImpl = postJson } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const status = await postJsonImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true
    });
    if (!successfulHttpStatus(status)) {
      console.error(`[alerts] Telegram recusou o alerta (HTTP ${String(status)})`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[alerts] telegram falhou: ${String(error.message || error).replace(token, '[redacted]').slice(0, 200)}`);
    return false;
  }
}

/**
 * Dispara o alerta em todos os canais configurados. Nunca lança — o chamador
 * não deve ter o fluxo principal interrompido por uma falha de notificação.
 */
async function notifyFailure(title, detail = '', { postJsonImpl = postJson } = {}) {
  // Alert sinks are external channels too: exception messages may echo tokens,
  // webhook URLs, or private request fields. Apply the shared redaction and
  // length cap before sending to either provider.
  const safeTitle = sanitizeLogText(title).trim();
  const safeDetail = sanitizeLogText(detail).trim();
  const message = sanitizeLogText(`🔴 ${safeTitle}${safeDetail ? `\n${safeDetail}` : ''}`);
  const sent = await Promise.all([
    notifyWebhook(message, { postJsonImpl }),
    notifyTelegram(message, { postJsonImpl })
  ]);
  return sent.some(Boolean);
}

module.exports = { getAlertChannelStatus, notifyFailure, notifyWebhook, notifyTelegram };
