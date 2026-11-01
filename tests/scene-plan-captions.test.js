const assert = require('node:assert/strict');
const test = require('node:test');
const { ScenePlanBuilder, CAPTION_MAX_WORDS, CAPTION_MAX_WORDS_WITH_NATURAL_PAUSE } = require('../utils/scene-plan-builder');
const { choosePresenterShot } = require('../utils/presenter-framing');

const LONG_TEXT = 'A inteligência artificial mudou a forma como empresas analisam dados, reduzem custos e planejam o futuro. Especialistas dizem que essa transformação exige cuidado, transparência e decisões responsáveis para proteger as pessoas.';

function captionsFrom(scenes) {
  return scenes.flatMap(scene => (scene.components || []).flatMap(component => {
    if (component.type === 'caption') return [{ startMs: 0, endMs: scene.durationMs, words: component.words }];
    if (component.type === 'caption-track') return component.pages.map(page => ({ startMs: page.startMs, endMs: page.endMs, words: page.words }));
    return [];
  }));
}

test('splits long fallback captions into readable beats without losing words or duration', () => {
  const builder = new ScenePlanBuilder();
  const expected = LONG_TEXT.split(/\s+/);
  const scenes = builder.buildScenes({ seed: 31, hook: { text: LONG_TEXT }, forceLayout: 'text' }, 15000);
  const captions = captionsFrom(scenes);

  assert(captions.length > 1);
  assert(captions.every(page => page.words.length <= CAPTION_MAX_WORDS_WITH_NATURAL_PAUSE));
  assert.deepEqual(captions.flatMap(page => page.words.map(word => word.w)), expected);
  for (const page of captions) {
    assert(page.words.every(word => word.t >= page.startMs && word.t < page.endMs),
      'fallback karaoke times are local to their visual and audio segment');
  }
  const originalBeatDuration = builder.beats(LONG_TEXT, 15000)
    .reduce((sum, beat) => sum + beat.durationMs, 0);
  assert.equal(scenes.reduce((sum, scene) => sum + scene.durationMs, 0), originalBeatDuration);
  assert(captions.flatMap(page => page.words).every(word => Number.isFinite(word.t) && Number.isFinite(word.e) && word.e > word.t));
});

test('preserves timed speech alignment while splitting long sentence captions', () => {
  const builder = new ScenePlanBuilder();
  const text = 'Uma frase extensa precisa continuar sincronizada com cada palavra falada sem esconder trechos importantes durante a narração completa do vídeo para garantir leitura confortável em qualquer formato de tela.';
  const words = text.split(/\s+/);
  const durationMs = 12000;
  const wordTimes = words.map((_, index) => Math.round(index * (durationMs - 500) / words.length));
  const scenes = builder.buildScenes({
    seed: 92,
    hook: { text },
    timings: [{
      audioOffsetMs: 0,
      durationMs,
      sentences: [{ text, words, startMs: 0, durationMs, wordTimes }]
    }],
    forceLayout: 'text'
  }, durationMs);
  const captions = captionsFrom(scenes);

  assert(captions.length > 1);
  assert(captions.every(page => page.words.length <= CAPTION_MAX_WORDS_WITH_NATURAL_PAUSE));
  assert.deepEqual(captions.flatMap(page => page.words.map(word => word.w)), words);
  assert.equal(scenes.reduce((sum, scene) => sum + scene.durationMs, 0), durationMs);
  for (const page of captions) {
    assert.equal(page.words[0].t, page.startMs, 'each caption page starts at its aligned audio position');
    for (const word of page.words) {
      assert(Number.isFinite(word.t) && Number.isFinite(word.e));
      assert(word.e > word.t);
    }
  }
});

test('keeps a caption break with the next short clause when punctuation is only a few words away', () => {
  const builder = new ScenePlanBuilder();
  const text = 'Didymos não estava em rota de colisão com a Terra; o resultado valida uma técnica possível de defesa planetária, que só pode ajudar se um asteroide perigoso for descoberto com muita antecedência.';
  const words = text.split(/\s+/);
  const durationMs = 12_000;
  const pages = builder.splitLongBeats([{
    text,
    words,
    startMs: 0,
    durationMs,
    wordTimes: words.map((_, index) => Math.round(index * (durationMs - 500) / words.length))
  }], CAPTION_MAX_WORDS);

  assert.equal(pages[0].text, 'Didymos não estava em rota de colisão com a Terra;');
  assert.equal(pages.at(-1).text, 'que só pode ajudar se um asteroide perigoso for descoberto com muita antecedência.');
  assert(pages.every(page => page.words.length <= CAPTION_MAX_WORDS_WITH_NATURAL_PAUSE));
  assert.deepEqual(pages.flatMap(page => page.words), words);
});

test('keeps short impact and date-range sentences together through nearby punctuation', () => {
  const builder = new ScenePlanBuilder();
  const sentences = [
    'A sonda DART colidiu intencionalmente com Dimorphos em 26 de setembro de 2022.',
    'Voluntários observaram 22 ocultações entre outubro de 2022 e março de 2025.'
  ];

  for (const text of sentences) {
    const words = text.split(/\s+/);
    const pages = builder.splitLongBeats([{
      text,
      words,
      startMs: 0,
      durationMs: 5_000,
      wordTimes: words.map((_, index) => index * 250)
    }], 8);
    assert.equal(pages.length, 1, `nearby punctuation should keep this phrase together: ${text}`);
    assert.equal(pages[0].text, text);
    assert(pages[0].words.length <= 13);
  }
});

test('moves a caption cut before an unfinished Portuguese preposition', () => {
  const builder = new ScenePlanBuilder();
  const text = 'A sonda colidiu intencionalmente contra um asteroide em 2022 depois de anos de planejamento científico antes da missão chegar ao alvo remoto.';
  const words = text.split(/\s+/);
  const pages = builder.splitLongBeats([{
    text,
    words,
    startMs: 0,
    durationMs: 12_000,
    wordTimes: words.map((_, index) => index * 400)
  }], 8);

  assert.equal(pages[0].text, 'A sonda colidiu intencionalmente contra um asteroide');
  assert.deepEqual(pages.flatMap(page => page.words), words);
  assert(pages.every(page => page.words.length <= 13));
});

test('keeps “menos de” together when splitting a long numeric claim', () => {
  const text = 'Essa estratégia já revelou galáxias existentes menos de 300 milhões de anos depois do Big Bang.';
  const words = text.split(/\s+/);
  const scenes = new ScenePlanBuilder().splitLongBeats([{ text, words, durationMs: 6000 }], 8);

  assert.equal(scenes[0].words.at(-1), 'existentes');
  assert.deepEqual(scenes[1].words.slice(0, 4), ['menos', 'de', '300', 'milhões']);
});

test('does not split short captions', () => {
  const builder = new ScenePlanBuilder();
  const scenes = builder.buildScenes({ seed: 2, hook: { text: 'Esta frase cabe em uma legenda curta.' } }, 4000);
  assert.equal(captionsFrom(scenes).length, 1);
});

test('coalesces short sections into steady visual blocks while keeping timed captions and headings', () => {
  const sentences = [
    'A primeira frase explica o contexto principal.',
    'A segunda frase mantém a continuidade visual.',
    'A terceira frase acrescenta um detalhe verificado.',
    'A quarta frase conclui esta sequência narrativa.'
  ].map(text => {
    const words = text.split(/\s+/);
    return { text, words, startMs: 0, durationMs: 2500,
      wordTimes: words.map((_, wordIndex) => Math.round(wordIndex * 2300 / words.length)) };
  });
  const timings = sentences.map((sentence, index) => ({
    audioOffsetMs: index * 2500,
    durationMs: 2500,
    sentences: [sentence]
  }));
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 17,
    hook: { text: sentences[0].text },
    mainContent: { sections: sentences.slice(1).map((sentence, index) => ({ title: `Etapa ${index + 1}`, content: sentence.text })) },
    timings
  }, 10_000, {});

  assert.equal(scenes.length, 1, 'short section boundaries do not cause rapid visual cuts');
  assert.equal(scenes[0].durationMs, 10_000);
  const track = scenes[0].components.find(component => component.type === 'caption-track');
  assert.equal(track.pages.length, sentences.length);
  assert.deepEqual(track.pages.map(page => page.startMs), [0, 2500, 5000, 7500]);
  assert.deepEqual(track.pages.flatMap(page => page.words.map(word => word.w)), sentences.flatMap(sentence => sentence.words));
  const heading = scenes[0].components.find(component => component.type === 'demo-header');
  assert.deepEqual(heading.entries.map(entry => entry.startMs), [0, 2500, 5000, 7500]);
  assert.deepEqual(heading.entries.map(entry => entry.category), ['Abertura', 'Etapa 1', 'Etapa 2', 'Etapa 3']);
  const timestamps = scenes[0].components.filter(component => component.type === 'timestamp-hud');
  assert.deepEqual(timestamps.map(component => component.sceneWindow.startMs), [0, 2500, 5000, 7500]);
});

test('coalesced split layouts retain the presenter over a full-frame background', () => {
  const sentences = [
    'A primeira frase apresenta a explicação completa.',
    'A segunda frase mantém o contexto em continuidade.'
  ].map(text => {
    const words = text.split(/\s+/);
    return { text, words, startMs: 0, durationMs: 6000,
      wordTimes: words.map((_, index) => Math.round(index * 5600 / words.length)) };
  });
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 82,
    forceLayout: 'split',
    hook: { text: sentences.map(sentence => sentence.text).join(' ') },
    timings: [{ durationMs: 12_000, sentences }]
  }, 12_000, { 0: { sources: ['data:image/jpeg;base64,AA==', 'data:image/jpeg;base64,AQ=='] } });

  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].split, false);
  assert.equal(scenes[0].hero, true);
  assert(scenes[0].components.some(component => component.type === 'image-hero'));
  assert.equal(choosePresenterShot(scenes[0], 0, 82).hidden, false);
});
