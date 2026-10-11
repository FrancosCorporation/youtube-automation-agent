#!/usr/bin/env node
/**
 * Upload direto para o YouTube usando as credenciais OAuth do projeto.
 *
 * CLI:  node scripts/upload-to-youtube.js <video.mp4> --title "..." [--desc "..."] [--tags "ia,tecnologia"] [--privacy public]
 * API:  const { uploadVideo } = require('./upload-to-youtube');
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { CredentialManager } = require('../utils/credential-manager');
const { assertValidYouTubeMetadata } = require('../utils/youtube-metadata-validator');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function uploadVideo({ videoPath, title, description, tags, privacyStatus = 'public', thumbnailPath }) {
  const resolved = path.resolve(videoPath);
  if (!fs.existsSync(resolved)) throw new Error(`vídeo não encontrado: ${resolved}`);

  const cm = new CredentialManager();
  if (cm.initialize) await cm.initialize();
  if (!(cm.credentials && cm.credentials.youtube && cm.tokens && cm.tokens.youtube)) {
    throw new Error('credenciais YouTube ausentes — rode `npm run credentials:setup`');
  }
  const youtube = cm.getYouTubeClient();

  const safe = assertValidYouTubeMetadata({
    title: String(title || '').slice(0, 100),
    description: String(description || ''),
    tags: Array.isArray(tags) ? tags : String(tags || '').split(/[,;]/).map(t => t.trim()).filter(Boolean),
    categoryId: '28',
    defaultLanguage: 'pt-BR',
    defaultAudioLanguage: 'pt-BR'
  });

  const res = await youtube.videos.insert({
    part: 'snippet,status',
    requestBody: {
      snippet: {
        title: safe.value.title,
        description: safe.value.description,
        tags: safe.value.tags,
        categoryId: safe.value.categoryId,
        defaultLanguage: 'pt-BR',
        defaultAudioLanguage: 'pt-BR'
      },
      status: {
        privacyStatus: ['public', 'unlisted', 'private'].includes(privacyStatus) ? privacyStatus : 'public',
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: true
      }
    },
    media: { body: fs.createReadStream(resolved) }
  });

  const videoId = res.data.id;

  // Thumbnail customizada (a "capa do filme") — se falhar (cota/aspecto),
  // o upload NÃO é perdido: só loga e segue.
  const thumbPath = thumbnailPath && path.resolve(thumbnailPath);
  if (thumbPath && fs.existsSync(thumbPath)) {
    try {
      await youtube.thumbnails.set({
        videoId,
        media: { body: fs.createReadStream(thumbPath) }
      });
      console.log(`      thumbnail aplicada: ${path.basename(thumbPath)}`);
    } catch (error) {
      console.warn(`      thumbnail falhou (upload mantido): ${error.message.slice(0, 150)}`);
    }
  }

  return { id: videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
}

async function main() {
  const videoPath = process.argv[2];
  if (!videoPath) {
    console.error('uso: node scripts/upload-to-youtube.js <video.mp4> --title "..." [--desc "..."] [--tags "a,b"] [--privacy public]');
    process.exit(1);
  }
  const result = await uploadVideo({
    videoPath,
    title: arg('title', 'Vídeo de IA'),
    description: arg('desc', 'Notícias de inteligência artificial.'),
    tags: arg('tags', 'inteligência artificial,notícias,tecnologia'),
    privacyStatus: arg('privacy', process.env.YT_PRIVACY || 'public')
  });
  console.log(`⬆️ OK: ${result.url}`);
}

if (require.main === module) main();
module.exports = { uploadVideo };
