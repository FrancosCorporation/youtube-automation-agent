#!/usr/bin/env node
/**
 * Atualiza o branding do canal YouTube via API (nome, descrição, keywords).
 * Uso: node scripts/update-youtube-branding.js [--name "Pulso IA"] [--desc "..."]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { CredentialManager } = require('../utils/credential-manager');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

(async () => {
  const name = arg('name', process.env.CHANNEL_NAME || 'Pulso IA');
  const description = arg('desc',
    'O pulso da inteligência artificial em português. As notícias mais quentes de IA, casos reais e o que muda na sua vida — análise rápida, visual e sem enrolação. Novos vídeos todos os dias.');

  const cm = new CredentialManager();
  if (cm.initialize) await cm.initialize();
  const youtube = cm.getYouTubeClient();

  const me = await youtube.channels.list({ part: 'brandingSettings,snippet', mine: true });
  const channel = me.data.items && me.data.items[0];
  if (!channel) throw new Error('canal não encontrado');

  const branding = channel.brandingSettings || {};
  branding.channel = {
    ...(branding.channel || {}),
    title: name,
    description,
    keywords: 'inteligência artificial, IA, notícias de IA, tecnologia, ChatGPT, OpenAI, inteligência artificial explicada, tech Brasil',
    country: 'BR',
    defaultLanguage: 'pt-BR',
    unsubscribedTrailer: branding.channel && branding.channel.unsubscribedTrailer
  };

  const res = await youtube.channels.update({
    part: 'brandingSettings',
    requestBody: { id: channel.id, brandingSettings: branding }
  });

  const updated = res.data.brandingSettings.channel;
  console.log('✅ Canal atualizado:');
  console.log('   nome:', updated.title);
  console.log('   desc:', String(updated.description).slice(0, 90) + '…');
  console.log('   país:', updated.country, '| idioma:', updated.defaultLanguage);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
