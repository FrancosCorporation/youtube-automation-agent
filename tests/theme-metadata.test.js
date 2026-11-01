'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { themes } = require('../config/themes.json');
const { getTheme } = require('../utils/news-hunter');
const {
  DEFAULT_HASHTAGS,
  resolveThemeHashtags,
  resolveThemeTags,
  themeDescription
} = require('../utils/theme-metadata');
const { retryPendingSocialUploads } = require('../utils/social-retry');
const { assessSourceEvidence, createPublicationReview } = require('../utils/source-evidence');

function verifiedSourceEvidence() {
  const context = Array(5).fill('A pauta informa dados verificados, contexto do tema e consequências práticas com referências rastreáveis para o público.').join(' ');
  const sourceEvidence = assessSourceEvidence({
    sourceTitle: 'Análise de atividade física e saúde para iniciantes',
    sourceUrl: 'https://example.test/fitness',
    context
  });
  return {
    sourceEvidence,
    publicationReview: createPublicationReview({
      verdict: 'aprovado', sourceContext: context, reviewer: 'fixture de teste'
    })
  };
}

test('every configured theme supplies its own hashtags and upload tags', () => {
  assert.equal(themes.length, 10);
  for (const theme of themes) {
    const selected = getTheme(theme.id);
    assert.equal(selected.id, theme.id, `${theme.id} selects its own source configuration`);
    assert.equal(selected.gnews, theme.gnews);
    assert.deepEqual(selected.feeds, theme.feeds);
    const hashtags = resolveThemeHashtags(null, theme.id);
    assert.equal(hashtags, theme.hashtags, `${theme.id} uses configured hashtags`);
    assert.deepEqual(resolveThemeTags(null, theme.id), theme.hashtags.match(/#[\p{L}\p{N}_]+/gu).map(tag => tag.slice(1)));
    assert.match(themeDescription(theme.id), new RegExp(theme.brand || theme.name));
  }
  assert.equal(resolveThemeHashtags(null, 'missing-theme'), DEFAULT_HASHTAGS);
});

test('themes use the live replacement feeds verified for IA, curiosities, health, and fitness', () => {
  const feedByTheme = id => themes.find(theme => theme.id === id)?.feeds || [];
  assert.ok(feedByTheme('ia').some(([source, url]) => source === 'Tecnoblog' && url === 'https://tecnoblog.net/feed/'));
  assert.ok(feedByTheme('curiosidades').some(([source, url]) => source === 'ScienceDaily Strange & Offbeat'
    && url === 'https://www.sciencedaily.com/rss/strange_offbeat.xml'));
  for (const id of ['saude', 'fitness']) {
    assert.ok(feedByTheme(id).some(([source, url]) => source === 'ScienceDaily Health'
      && url === 'https://www.sciencedaily.com/rss/top/health.xml'));
  }
  assert.ok(!JSON.stringify(themes).includes('tecmundo.com.br/rss'));
  assert.ok(!JSON.stringify(themes).includes('health_medicine.xml'));
});

test('low-velocity news themes constrain Google News queries to recent coverage', () => {
  for (const id of ['economize', 'psicologia', 'misterios']) {
    assert.match(getTheme(id).gnews, /\bwhen:7d\b/, `${id} should avoid Google News results older than the fallback window`);
  }
});

test('SEO hashtags stay intact and are not replaced by the theme fallback', () => {
  assert.equal(resolveThemeHashtags('#pauta #especifica', 'fitness'), '#pauta #especifica');
  assert.deepEqual(resolveThemeTags(['pauta específica', 'pauta específica'], 'fitness'), ['pauta específica']);
});

test('background social retry uses the entry theme when SEO hashtags are absent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-theme-retry-'));
  try {
    const clipPath = path.join(root, 'data', 'videos', 'clip.mp4');
    await fs.mkdir(path.dirname(clipPath), { recursive: true });
    await fs.writeFile(clipPath, 'synthetic video fixture');
    const calls = [];
    const output = await retryPendingSocialUploads({
      entry: {
        publicationEligible: true,
        ...verifiedSourceEvidence(),
        theme: 'fitness',
        title: 'Treino de teste',
        clips: [{
          path: 'data/videos/clip.mp4',
          title: 'Corte fitness',
          kind: 'social-narrative',
          platforms: ['kwai']
        }]
      },
      root,
      results: { clips: { 'data/videos/clip.mp4': { kwai: 'não logado' } } },
      onPublicationState: async () => {},
      isLogged: async platform => platform === 'kwai',
      getMediaDuration: async () => 90,
      videoLimits: { kwai: 180 },
      uploaders: {
        kwai: async ({ caption }) => {
          calls.push(caption);
          return 'https://kwai.test/video/123';
        }
      },
      withBudget: async (_platform, promise) => promise,
      maxUploads: 1
    });

    assert.equal(output.uploadsAttempted, 1);
    assert.match(calls[0], /#fitness #treino #emagrecimento/);
    assert.doesNotMatch(calls[0], /#ia #inteligenciaartificial/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
