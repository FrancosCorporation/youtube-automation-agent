/**
 * Alertas simples de operação — avisa um humano quando o pipeline 24h falha.
 * Sem isso, falhas no channel-scheduler ficam só no log local e podem passar
 * dias sem ninguém notar que o canal parou de publicar.
 *
 * Suporta dois canais opcionais (configuráveis via .env), nenhum obrigatório:
 *   - NOTIFICATION_WEBHOOK_URL: POST JSON genérico (compatível com Slack/Discord
 *     incoming webhook — ambos aceitam {"text": "..."} / {"content": "..."}).
 *   - TELEGRAM_BOT_TOKEN + TELEGRAM_ADMIN_CHAT_ID: mensagem via Bot API.
 * Se nenhuma estiver configurada, a função é um no-op silencioso (loga local só).
 */
const https = require('https');
const { URL } = require('url');

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

async function notifyWebhook(message) {
  const url = process.env.NOTIFICATION_WEBHOOK_URL;
  if (!url) return false;
  try {
    // Formato aceito tanto por Slack quanto por Discord incoming webhooks.
    await postJson(url, { text: message, content: message });
    return true;
  } catch (error) {
    console.error(`[alerts] webhook falhou: ${error.message}`);
    return false;
  }
}

async function notifyTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true
    });
    return true;
  } catch (error) {
    console.error(`[alerts] telegram falhou: ${error.message}`);
    return false;
  }
}

/**
 * Dispara o alerta em todos os canais configurados. Nunca lança — o chamador
 * não deve ter o fluxo principal interrompido por uma falha de notificação.
 */
async function notifyFailure(title, detail = '') {
  const message = `🔴 ${title}${detail ? `\n${detail}` : ''}`;
  const sent = await Promise.all([notifyWebhook(message), notifyTelegram(message)]);
  return sent.some(Boolean);
}

module.exports = { notifyFailure, notifyWebhook, notifyTelegram };
