'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ScenePlanBuilder, ARTICLE_PRINT_MIN_DWELL_MS, sourceReferenceDwellMs } = require('../utils/scene-plan-builder');

function findComponent(scenes, type) {
  const components = scenes.flatMap(scene => scene.components || []);
  return components.find(component => component.type === type)
    || (type === 'caption' ? components.find(component => component.type === 'caption-track') : undefined);
}

test('source reading time grows with headline length without shifting narration', () => {
  assert.equal(sourceReferenceDwellMs({ type: 'article-print' }), 7200);
  assert.equal(sourceReferenceDwellMs({ type: 'article-print', readingWords: 40 }), 15000);
  const title = Array(40).fill('palavra').join(' ');
  const [scene] = new ScenePlanBuilder().coalesceVisualScenes([
    { groupIndex: 0, durationMs: 4000, components: [{ type: 'news-card', title, source: 'Veículo' }] },
    { groupIndex: 1, durationMs: 16000, components: [] }
  ]);
  assert.equal(scene.durationMs, 20000);
  assert.deepEqual(findComponent([scene], 'news-card').sceneWindow, { startMs: 0, endMs: 15000 });
});

test('a source card stays with its narration group when its reading window is longer than the section', () => {
  const scenes = new ScenePlanBuilder().coalesceVisualScenes([
    { groupIndex: 0, durationMs: 4000, steadyNarrative: true, components: [{ type: 'bento-card', title: 'Contexto anterior' }] },
    { groupIndex: 1, durationMs: 3000, steadyNarrative: true, components: [{ type: 'news-card', title: 'HTTP: Hypertext Transfer Protocol' }] },
    { groupIndex: 1, durationMs: 4000, steadyNarrative: true, components: [{ type: 'caption', words: [{ text: 'fala final' }] }] }
  ], 9000);

  assert.equal(scenes.length, 2, 'source evidence fences adjacent narration groups');
  assert.equal(scenes[0].groupIndex, 0);
  assert.equal(scenes[0].components.some(component => component.type === 'news-card'), false);
  assert.equal(scenes[1].groupIndex, 1);
  const sourceCard = findComponent([scenes[1]], 'news-card');
  assert.ok(sourceCard);
  assert.deepEqual(sourceCard.sceneWindow, { startMs: 0, endMs: 7000 },
    'a short section uses only its own duration instead of moving the source into earlier narration');
  assert.equal(scenes.reduce((sum, scene) => sum + scene.durationMs, 0), 11000,
    'citation timing never shifts narration');
});

test('successive metric callouts in one section do not remain visible over each other', () => {
  const [scene] = new ScenePlanBuilder().coalesceVisualScenes([
    { groupIndex: 1, durationMs: 2000, components: [
      { type: 'kinetic-number', value: '2022', label: 'IMPACTO DA DART', revealAtMs: 220 }
    ] },
    { groupIndex: 1, durationMs: 3000, components: [
      { type: 'kinetic-number', value: '6,1 km/s', label: 'IMPACTO DA DART', revealAtMs: 240 }
    ] }
  ], 5000);

  const callouts = scene.components.filter(component => component.type === 'kinetic-number');
  assert.equal(callouts.length, 2);
  assert.deepEqual(callouts.map(component => component.sceneWindow), [
    { startMs: 0, endMs: 2000 },
    { startMs: 2000, endMs: 5000 }
  ]);
  assert.equal(scene.durationMs, 5000, 'callout timing does not change the narration length');
});

test('steady narration uses authored imagery and timed captions without full-sentence bento duplicates', () => {
  const text = 'O artigo descreve respostas de bactérias em condições específicas de laboratório.';
  const scenes = new ScenePlanBuilder().buildScenes({
    steadyNarrative: true,
    hook: 'Uma observação começa dentro do laboratório.',
    mainContent: { sections: [{ title: 'O teste', content: text }] },
    timings: [
      { durationMs: 3000, sentences: [{ text: 'Uma observação começa dentro do laboratório.', words: ['Uma', 'observação', 'começa', 'dentro', 'do', 'laboratório.'], startMs: 0, durationMs: 3000 }] },
      { durationMs: 5000, sentences: [{ text, words: text.split(/\s+/), startMs: 0, durationMs: 5000 }] }
    ]
  }, 8000, { 0: 'hook.png', 1: 'laboratory.png' });

  const sectionScenes = scenes.filter(scene => scene.groupIndex === 1);
  assert.ok(sectionScenes.some(scene => scene.components.some(component => component.type === 'image-hero')));
  assert.ok(sectionScenes.some(scene => scene.components.some(component => ['caption', 'caption-track'].includes(component.type))));
  assert.equal(sectionScenes.some(scene => scene.components.some(component => component.type === 'bento-card')), false);
});

test('text-only editorial context stays visible across caption pages without repeating or inventing facts', () => {
  const builder = new ScenePlanBuilder();
  const card = { type: 'bento-card', editorialContext: true, title: 'O que o estudo mediu', subtitle: 'Fonte: Revista' };
  const input = Array.from({ length: 4 }, () => ({
    durationMs: 2000, groupIndex: 1, components: [{ type: 'demo-header', category: 'Evidência' }, { ...card }]
  }));
  const [scene] = builder.coalesceVisualScenes(input, 8000);
  const cards = scene.components.filter(component => component.editorialContext);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].sceneWindow, { startMs: 0, endMs: 8000 });
  assert.equal(cards[0].title, card.title);
  assert.equal(cards[0].subtitle, card.subtitle);
  assert.equal(scene.components[0].type, 'demo-header');
});

test('source prints retain their own reading window without an overlapping fallback context card', () => {
  const [scene] = new ScenePlanBuilder().coalesceVisualScenes([
    { durationMs: 4000, groupIndex: 0, components: [{ type: 'article-print', src: '/source.png' }] },
    { durationMs: 4000, groupIndex: 0, components: [{ type: 'bento-card', editorialContext: true, title: 'Contexto' }] }
  ], 8000);
  assert.equal(scene.components.some(component => component.editorialContext), false);
  assert.equal(findComponent([scene], 'article-print').sceneWindow.endMs, ARTICLE_PRINT_MIN_DWELL_MS);
});

test('comparison rows can render as a table without changing the cited labels or scores', () => {
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 2,
    hook: { text: 'Hoje vamos comparar duas opções disponíveis.' },
    mainContent: { sections: [{
      title: 'Consumo',
      content: 'O modelo A consome menos energia. O modelo B entrega mais velocidade.',
      visual: { type: 'compare-table', title: 'Consumo', items: [{ label: 'Modelo A', score: 8.5 }, { label: 'Modelo B', score: 7.2 }] }
    }] }
  }, 18000, {});
  const table = findComponent(scenes, 'compare-table');

  assert.ok(table);
  assert.equal(table.title, 'Consumo');
  assert.deepEqual(table.items, [{ label: 'Modelo A', score: 8.5 }, { label: 'Modelo B', score: 7.2 }]);
});

test('comparison visuals follow authored semantics and use a stable score-chart fallback', () => {
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 52,
    hook: { text: 'Duas comparações ilustram os dados.' },
    mainContent: { sections: [
      {
        title: 'Evolução', content: 'Em janeiro o resultado era oito. Em março o resultado chegou a dez.',
        visual: { type: 'line-chart', items: [{ label: 'Janeiro', score: 8 }, { label: 'Março', score: 10 }] }
      },
      {
        title: 'Alternativas', content: 'A opção A registrou oito pontos. A opção B registrou seis pontos.',
        visual: { type: 'score-compare', items: [{ label: 'Opção A', score: 8 }, { label: 'Opção B', score: 6 }] }
      }
    ] }
  }, 22000, {});

  assert.ok(findComponent(scenes, 'line-chart'));
  assert.ok(findComponent(scenes, 'score-chart'));
  assert.equal(findComponent(scenes, 'donut-chart'), undefined);
  assert.equal(findComponent(scenes, 'rank-list'), undefined);
});

test('comparison visual is omitted when any score is missing or outside the supported range', () => {
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 2,
    hook: { text: 'Duas alternativas disputam a atenção.' },
    mainContent: { sections: [{
      title: 'Teste',
      content: 'Uma alternativa prioriza o consumo. A outra mantém o foco em velocidade.',
      visual: { type: 'score-compare', title: 'Teste', items: [{ label: 'A', score: 8 }, { label: 'B', score: null }] }
    }] }
  }, 16000, {});
  const comparisonTypes = ['compare-table', 'score-chart', 'line-chart', 'donut-chart', 'rank-list'];
  assert.equal(scenes.flatMap(scene => scene.components || []).some(component => comparisonTypes.includes(component.type)), false);
});

test('metric comparison bars enter at their spoken cues and the scene stays open through the last value', () => {
  const sectionText = 'O Llama 3.1 8B traz oito bilhões de parâmetros. O Llama 3.1 70B traz setenta bilhões de parâmetros. O Llama 3.1 405B chega a quatrocentos e cinco bilhões de parâmetros.';
  const sentences = [
    { text: 'O Llama 3.1 8B traz oito bilhões de parâmetros.', startMs: 0, durationMs: 3200,
      words: ['O', 'Llama', '3.1', '8B', 'traz', 'oito', 'bilhões', 'de', 'parâmetros.'],
      wordTimes: [0, 180, 320, 480, 720, 980, 1230, 1540, 1700] },
    { text: 'O Llama 3.1 70B traz setenta bilhões de parâmetros.', startMs: 3400, durationMs: 3200,
      words: ['O', 'Llama', '3.1', '70B', 'traz', 'setenta', 'bilhões', 'de', 'parâmetros.'],
      wordTimes: [0, 180, 320, 480, 720, 980, 1230, 1540, 1700] },
    { text: 'O Llama 3.1 405B chega a quatrocentos e cinco bilhões de parâmetros.', startMs: 6800, durationMs: 3900,
      words: ['O', 'Llama', '3.1', '405B', 'chega', 'a', 'quatrocentos', 'e', 'cinco', 'bilhões', 'de', 'parâmetros.'],
      wordTimes: [0, 150, 300, 430, 700, 880, 1080, 1500, 1660, 1840, 2170, 2300] }
  ];
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 23,
    hook: { text: 'Compare o tamanho dos modelos.' },
    mainContent: { sections: [{
      title: 'Tamanho dos modelos', content: sectionText,
      visual: {
        type: 'metric-compare', title: 'Tamanho dos modelos',
        unitLabel: 'Bilhões de parâmetros', sourceLabel: 'Fonte: Meta Llama 3.1 Model Card',
        items: [
          { label: 'Llama 3.1 · 8B', value: 8, unit: 'B', cue: 'oito bilhões' },
          { label: 'Llama 3.1 · 70B', value: 70, unit: 'B', cue: 'setenta bilhões' },
          { label: 'Llama 3.1 · 405B', value: 405, unit: 'B', cue: 'quatrocentos e cinco bilhões' }
        ]
      }
    }] },
    timings: [
      { durationMs: 3000, sentences: [{ text: 'Compare o tamanho dos modelos.', startMs: 0, durationMs: 3000, words: ['Compare', 'o', 'tamanho', 'dos', 'modelos.'] }] },
      { durationMs: 11000, sentences }
    ]
  }, 14000, {});

  const chart = findComponent(scenes, 'progressive-comparison');
  assert.ok(chart);
  const chartScene = scenes.find(scene => scene.components?.includes(chart));
  assert.equal(chartScene.presenter, false, 'the chart cutaway must not be covered by the presenter canvas');
  assert.equal(chartScene.components.some(component => component.type === 'demo-header'), false,
    'the chart supplies its own title and should not show the slide progress header');
  assert.deepEqual(chart.items.map(item => item.revealAfterMs), [980, 4380, 7880]);
  assert.equal(chart.items[0].value, 8);
  assert.equal(chart.items[2].value, 405);
  assert.ok(chart.sceneWindow.endMs >= chart.revealAtMs + chart.items[2].revealAfterMs + 1260,
    'the coalesced scene should hold through the last spoken value and bar entrance');
});

test('metric comparison waits for the first narrated value instead of showing empty axes early', () => {
  const setup = 'Para usar, crie um ambiente Python 3.12 vazio e ative-o.';
  const checkpoint = 'O checkpoint padrão é baixado automaticamente na primeira execução.';
  const benchmark = 'Os benchmarks mostram 4 SM100 GPUs para prefill e 64 para decode.';
  const benchmarkWords = benchmark.split(/\s+/);
  const scenes = new ScenePlanBuilder().buildScenes({
    hook: { text: 'Como o DeepInfer permite inferência offline em larga escala?' },
    mainContent: { sections: [{ title: 'Benchmark', content: `${setup} ${checkpoint} ${benchmark}`, visual: {
      type: 'metric-compare', title: 'Comparação do benchmark', unitLabel: 'GPUs',
      items: [
        { label: 'Prefill SM100', value: 4, unit: 'GPUs', cue: '4 SM100 GPUs para prefill' },
        { label: 'Decode', value: 64, unit: 'GPUs', cue: '64 para decode' }
      ]
    } }] },
    timings: [
      { durationMs: 4000, sentences: [{ text: 'Como o DeepInfer permite inferência offline em larga escala?', startMs: 0, durationMs: 4000, words: 'Como o DeepInfer permite inferência offline em larga escala?'.split(/\s+/) }] },
      { audioOffsetMs: 0, durationMs: 24291, sentences: [
        { text: setup, words: setup.split(/\s+/), startMs: 25154, durationMs: 4446 },
        { text: checkpoint, words: checkpoint.split(/\s+/), startMs: 29600, durationMs: 13776 },
        { text: benchmark, words: benchmarkWords, startMs: 43376, durationMs: 6069,
          wordTimes: benchmarkWords.map((_, index) => index * 300) }
      ] }
    ]
  }, 28291, {});

  const chart = findComponent(scenes, 'progressive-comparison');
  assert.ok(chart);
  assert.equal(chart.sceneWindow.startMs, 4000 + 4446 + 13776,
    'the chart scene starts after the hook and setup narration, at the first metric beat');
  assert.equal(chart.revealAtMs, chart.sceneWindow.startMs + 260,
    'the chart appears within the beat that contains the first metric cue');
  assert.deepEqual(chart.items.map(item => item.revealAfterMs), [900, 2700]);
});

test('text-only source cards do not duplicate an existing Fonte prefix', () => {
  const scenes = new ScenePlanBuilder().buildScenes({
    sourceLabel: 'Fonte: Fonte: DeepSeek-AI/DeepInfer · GitHub',
    hook: { text: 'Como o DeepInfer permite inferência offline em larga escala?' }
  }, 4000, {});
  assert.equal(findComponent(scenes, 'bento-card').subtitle, 'Fonte: DeepSeek-AI/DeepInfer · GitHub');
});

test('spoken GPU benchmark comparisons produce an animated chart without invented values', () => {
  const content = 'Os benchmarks mostram 4 SM100 GPUs para prefill e 64 para decode.';
  const words = content.split(/\s+/);
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 24,
    sourceLabel: 'Fonte: documentação do DeepInfer',
    hook: { text: 'Como o DeepInfer permite inferência offline em larga escala?' },
    mainContent: { sections: [{ title: 'Benchmark', content }] },
    timings: [
      { durationMs: 4000, sentences: [{ text: 'Como o DeepInfer permite inferência offline em larga escala?', words: 'Como o DeepInfer permite inferência offline em larga escala?'.split(/\s+/), startMs: 0, durationMs: 4000 }] },
      { durationMs: 5000, sentences: [{ text: content, words, startMs: 0, durationMs: 5000,
        wordTimes: words.map((_, index) => index * 250) }] }
    ]
  }, 9000, {});

  const chart = findComponent(scenes, 'progressive-comparison');
  assert.ok(chart, 'a comparison in the approved narration should become a graphic');
  assert.equal(chart.title, 'Comparação do benchmark');
  assert.equal(chart.unitLabel, 'GPUs');
  assert.equal(chart.sourceLabel, 'Fonte: documentação do DeepInfer');
  assert.deepEqual(chart.items.map(({ label, value, unit }) => ({ label, value, unit })), [
    { label: 'Prefill SM100', value: 4, unit: 'GPUs' },
    { label: 'Decode', value: 64, unit: 'GPUs' }
  ]);
  assert.deepEqual(chart.items.map(item => item.revealAfterMs), [750, 2250],
    'each value enters when its phrase is spoken');
});

test('karaoke captions honor the audio end of each word instead of a fixed minimum hold', () => {
  const text = 'O modelo explica o resultado.';
  const words = text.split(/\s+/);
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 15,
    hook: { text },
    timings: [{ durationMs: 900, sentences: [{
      text, words, startMs: 0, durationMs: 900,
      wordTimes: [0, 90, 250, 390, 560],
      wordEndTimes: [70, 210, 340, 510, 820]
    }] }]
  }, 900, {});
  const caption = findComponent(scenes, 'caption');
  assert.deepEqual(caption.words.map(word => [word.t, word.e]), [
    [0, 70], [90, 210], [250, 340], [390, 510], [560, 820]
  ]);
});

test('GPU values without a same-unit comparison phrase do not create a chart', () => {
  const scenes = new ScenePlanBuilder().buildScenes({
    hook: { text: 'Vamos entender um detalhe do benchmark.' },
    mainContent: { sections: [{
      title: 'Execução',
      content: 'O servidor usa 4 GPUs. A equipe também cita um modelo de 64 bilhões de parâmetros.'
    }] }
  }, 12000, {});
  assert.equal(findComponent(scenes, 'progressive-comparison'), undefined);
});

test('metric comparison is omitted when any spoken cue is missing from the section', () => {
  const scenes = new ScenePlanBuilder().buildScenes({
    hook: { text: 'Os dados são diferentes.' },
    mainContent: { sections: [{ title: 'Tamanho', content: 'A fonte descreve os dois tamanhos em detalhe.' , visual: {
      type: 'metric-compare', title: 'Tamanho',
      items: [
        { label: 'Modelo A', value: 8, unit: 'B', cue: 'oito bilhões' },
        { label: 'Modelo B', value: 70, unit: 'B', cue: 'setenta bilhões' }
      ]
    } }] }
  }, 14000, {});
  assert.equal(findComponent(scenes, 'progressive-comparison'), undefined);
});

test('checklist and rotating cards quote the section rather than inventing labels or claims', () => {
  const builder = new ScenePlanBuilder();
  const checklistText = 'Primeiro, confira a origem da notícia. Segundo, compare os dados publicados. Terceiro, explique o que ainda falta confirmar.';
  const checklistScenes = builder.buildScenes({
    seed: 14,
    hook: { text: 'Vamos verificar a informação com cuidado.' },
    mainContent: { sections: [{ title: 'Verificação', content: checklistText }] }
  }, 18000, {});
  const checklist = findComponent(checklistScenes, 'checklist');
  assert.deepEqual(checklist.items, checklistText.split(/(?<=[.!?…])\s+/));

  const cardText = 'O teste mede o consumo total. A equipe registra cada leitura. O resultado compara os dois cenários.';
  const cardScenes = builder.buildScenes({
    seed: 19,
    hook: { text: 'O experimento acompanha três pontos centrais.' },
    mainContent: { sections: [{ title: 'O experimento', content: cardText }] }
  }, 18000, {});
  const cards = findComponent(cardScenes, 'rotation-cards');
  assert.deepEqual(cards.cards, cardText.split(/(?<=[.!?…])\s+/));
});

test('explicit process graphs reveal on a phrase spoken in that scene', () => {
  const content = 'Search encontra páginas. Fetch recupera o conteúdo de uma página selecionada.';
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 9,
    hook: 'Veja como a documentação organiza a busca.',
    mainContent: { sections: [{
      title: 'Search e Fetch',
      content,
      visual: { type: 'node-graph', nodes: ['Search', 'Fetch'], cue: 'Search encontra páginas' }
    }] },
    timings: [
      { durationMs: 4000, sentences: [{ text: 'Veja como a documentação organiza a busca.', words: 'Veja como a documentação organiza a busca.'.split(/\s+/), startMs: 0, durationMs: 4000 }] },
      { durationMs: 8000, sentences: [{ text: content, words: content.split(/\s+/), startMs: 0, durationMs: 8000 }] }
    ]
  }, 12000, {});

  const graph = findComponent(scenes, 'node-graph');
  assert.deepEqual(graph?.nodes, ['Search', 'Fetch']);
  assert.equal(graph?.revealAtMs, 260, 'the graph enters when its standalone cutaway begins');
  const graphScene = scenes.find(scene => scene.components?.includes(graph));
  assert.equal(graphScene.components.some(component => component.type === 'demo-header'), false,
    'the animated graph gets a clear title-free area');
});

test('an explicit process graph can replace a source card when both cue on the first spoken beat', () => {
  const content = 'Search encontra páginas e Fetch recupera o conteúdo.';
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 4,
    hook: 'Veja como a busca funciona.',
    news: [{ title: 'Documentação oficial', source: 'DeepSeek', sourceTypeLabel: 'documentação oficial',
      referenceLabel: 'Fonte da reportagem' }],
    mainContent: { sections: [{
      title: 'Busca e recuperação',
      content,
      visual: { type: 'node-graph', nodes: ['Search', 'Fetch'], cue: 'Search encontra páginas' }
    }] },
    timings: [
      { durationMs: 3000, sentences: [{ text: 'Veja como a busca funciona.', words: ['Veja', 'como', 'a', 'busca', 'funciona.'], startMs: 0, durationMs: 3000 }] },
      { durationMs: 6000, sentences: [{ text: content, words: content.split(/\s+/), startMs: 0, durationMs: 6000 }] }
    ]
  }, 9000, {});

  const graph = findComponent(scenes, 'node-graph');
  assert.deepEqual(graph?.nodes, ['Search', 'Fetch']);
  const graphScene = scenes.find(scene => scene.components?.includes(graph));
  const sourceCard = findComponent(scenes, 'news-card');
  assert.equal(sourceCard.sourceTypeLabel, 'documentação oficial');
  const sourceScene = scenes.find(scene => scene.components?.includes(sourceCard));
  assert.equal(sourceScene.components.some(component => component.type === 'node-graph'), false,
    'the source card remains in its own scene');
  assert.equal(graphScene.components.some(component => component.type === 'news-card'), false,
    'the graph cue has a clear scene instead of sharing the source card layout');
});

test('Atlas retrieval illustration replaces floating graph cards on its narration cue', () => {
  const text = 'A busca passou a priorizar identificadores e versões exatos, mantendo linhas vizinhas para reunir cabeçalho, item e valor.';
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 23,
    minimal: true,
    steadyNarrative: true,
    hook: { text: 'O teste compara duas rodadas.' },
    mainContent: { sections: [{ title: 'Recuperação', content: text,
      visual: { type: 'atlas-story-scene', beat: 'retrieval', cue: 'identificadores e versões exatos' } }] },
    timings: [
      { durationMs: 3000, sentences: [{ text: 'O teste compara duas rodadas.', words: 'O teste compara duas rodadas.'.split(/\s+/), startMs: 0, durationMs: 3000 }] },
      { durationMs: 7000, sentences: [{ text, words: text.split(/\s+/),
        wordTimes: text.split(/\s+/).map((_word, index) => index * 350), startMs: 0, durationMs: 7000 }] }
    ]
  }, 10000, {});

  const story = findComponent(scenes, 'atlas-story-scene');
  assert.equal(story?.beat, 'retrieval');
  assert.equal(story?.revealAtMs, 260);
  const scene = scenes.find(item => item.components.includes(story));
  assert.ok(scene);
  assert.equal(scene.durationMs, 7000, 'the illustration stays present through every caption page in its narration group');
  assert.equal(story.flowAtMs > 0, true, 'the request waits for its spoken cue before crossing to the source page');
  assert.equal(scenes.filter(item => item.components.some(component => component.type === 'atlas-story-scene')).length, 1);
  assert.equal(scene.components.some(component => ['node-graph', 'spec-chips', 'progress-bar'].includes(component.type)), false);
  assert.equal(scene.components.some(component => component.type === 'caption' || component.type === 'caption-track'), true);
  assert.equal(scene.presenter, true, 'portrait keeps the theme-colored robot visible');
});

test('a spoken fraction of a second does not trigger a fake process graph', () => {
  const hook = 'DART atingiu Dimorphos.';
  const content = 'Para medir a órbita do par ao redor do Sol, pesquisadores combinaram observações terrestres e radar com ocultações estelares, quando o asteroide passa diante de uma estrela e a luz pisca por uma fração de segundo.';
  const timedSentence = (text, startMs, durationMs) => {
    const words = text.split(/\s+/);
    return { text, words, startMs, durationMs,
      wordTimes: words.map((_word, index) => index * durationMs / words.length) };
  };
  const scenes = new ScenePlanBuilder().buildScenes({
    steadyNarrative: true,
    hook: { text: hook, visual: { type: 'node-graph', nodes: ['DART', 'Impacto'], cue: 'DART' } },
    mainContent: { sections: [{ title: 'Como mediram', content,
      visual: { type: 'node-graph', nodes: ['Telescópios', 'Luz pisca', 'Medição'], cue: 'luz pisca' } }] },
    timings: [
      { audioOffsetMs: 0, durationMs: 3000, sentences: [timedSentence(hook, 0, 3000)] },
      { audioOffsetMs: 3000, durationMs: 15000, sentences: [timedSentence(content, 0, 15000)] }
    ]
  }, 18000, { 0: { sources: ['hook-image'] }, 1: { sources: ['observatory-image'] } });

  const sectionGraphs = scenes.filter(scene => scene.groupIndex === 1)
    .flatMap(scene => scene.components.filter(component => component.type === 'node-graph'));
  assert.deepEqual(sectionGraphs.map(graph => graph.nodes), [['Telescópios', 'Luz pisca', 'Medição']]);
});

test('explanatory social scenes keep graphics clear of portrait headers and captions', () => {
  const content = 'Search encontra páginas. Fetch recupera o conteúdo.';
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 6,
    channel: 'Pulso IA',
    explanatorySocial: true,
    steadyNarrative: true,
    forceLayout: 'hero',
    hook: null,
    mainContent: { sections: [{
      title: 'Busca e recuperação', content,
      visual: { type: 'node-graph', nodes: ['Search', 'Fetch'], cue: 'Search encontra páginas' }
    }] },
    timings: [{ durationMs: 8000, sentences: [
      { text: 'Search encontra páginas.', words: ['Search', 'encontra', 'páginas.'], startMs: 0, durationMs: 4000 },
      { text: 'Fetch recupera o conteúdo.', words: ['Fetch', 'recupera', 'o', 'conteúdo.'], startMs: 4000, durationMs: 4000 }
    ] }]
  }, 8000, {});

  assert(scenes.length > 0);
  for (const scene of scenes) {
    assert.equal(scene.explanatorySocial, true);
    assert.equal(scene.components.some(component => component.type === 'demo-header'), false);
    assert.equal(scene.components.some(component => component.type === 'timestamp-hud'), false);
    assert(scene.components.some(component => component.type === 'pulse-glow'));
  }
  assert(findComponent(scenes, 'node-graph'), 'the spoken process graphic remains available in social mode');
});

test('timestamp HUD uses the aligned audio offset and remains absent without timing evidence', () => {
  const text = 'A atualização chega ao público nesta semana.';
  const withTiming = new ScenePlanBuilder().buildScenes({
    seed: 3,
    hook: { text: 'Uma mudança recente altera a experiência.' },
    mainContent: { sections: [{ title: 'A mudança', content: text }] },
    timings: [
      { audioOffsetMs: 0, durationMs: 12000, sentences: [{ text: 'Uma mudança recente altera a experiência.', words: ['Uma', 'mudança', 'recente', 'altera', 'a', 'experiência.'], startMs: 0, durationMs: 12000, wordTimes: [0, 500, 1000, 2000, 3000, 4000] }] },
      { audioOffsetMs: 12000, durationMs: 10000, sentences: [{ text, words: text.split(/\s+/), startMs: 2300, durationMs: 7000, wordTimes: [0, 700, 1400, 2200, 3200, 4300, 5100] }] }
    ]
  }, 22000, {});
  const timestamps = withTiming.flatMap(scene => scene.components || [])
    .filter(component => component.type === 'timestamp-hud');
  const timestamp = timestamps.find(component => component.timeMs === 14300);
  assert.ok(timestamp);
  assert.equal(timestamp.value, '00:14');
  assert.equal(timestamp.label, 'Pulso IA');
  const timedSection = withTiming.find(scene => scene.components?.some(component => component.type === 'timestamp-hud'));
  assert.equal(timedSection.components.some(component => component.type === 'watermark'), false,
    'aligned HUD carries channel branding without overlapping a separate watermark');
  assert.equal(timestamps[0].value, '00:00');

  const withoutTiming = new ScenePlanBuilder().buildScenes({ hook: { text: 'Uma frase de abertura simples.' } }, 4000, {});
  assert.equal(findComponent(withoutTiming, 'timestamp-hud'), undefined);
});

test('long-form headers show synchronized chapter metadata while minimal clips stay uncluttered', () => {
  const builder = new ScenePlanBuilder();
  const scenes = builder.buildScenes({
    hook: { text: 'A abertura apresenta o assunto.' },
    mainContent: { sections: [
      { title: 'Primeiro bloco', content: 'O primeiro fato confirmado.' },
      { title: 'Segundo bloco', content: 'O contexto completa a explicação.' }
    ] },
    conclusion: { finalThought: 'A conclusão resume os pontos.' }
  }, 24000, {});
  const headers = scenes.flatMap(scene => scene.components || [])
    .filter(component => component.type === 'demo-header');
  const entries = headers.flatMap(header => header.entries || [header]);
  assert(entries.every(header => header.chapterTotal === 4));
  assert.deepEqual([...new Set(entries.map(header => header.chapterIndex))].sort(), [1, 2, 3, 4]);

  const minimal = builder.buildScenes({ minimal: true, hook: { text: 'Um corte curto sem faixa de capítulos.' } }, 5000, {});
  assert(minimal.flatMap(scene => scene.components || [])
    .filter(component => component.type === 'demo-header')
    .every(header => header.chapterTotal == null));
});

test('coalescing gives process graphs a standalone cutaway and preserves nearby number motion', () => {
  const scenes = new ScenePlanBuilder().coalesceVisualScenes([
    { groupIndex: 0, durationMs: 5000, components: [{ type: 'demo-header', category: 'Abertura' }] },
    { groupIndex: 1, durationMs: 5000, components: [
      { type: 'demo-header', category: 'Medição', chapterIndex: 2, chapterTotal: 2 },
      { type: 'kinetic-number', value: '35%', revealAtMs: 240 },
      { type: 'node-graph', nodes: ['Coleta', 'Análise', 'Resultado'], revealAtMs: 300 }
    ] }
  ], 10000);
  assert.equal(scenes.length, 2);
  const scene = scenes[1];
  const number = scene.components.find(component => component.type === 'kinetic-number');
  const process = scene.components.find(component => component.type === 'node-graph');
  assert.equal(number.sceneWindow, undefined, 'the standalone cutaway owns its full duration');
  assert.equal(process.sceneWindow, undefined, 'the graph is visible for the full standalone cutaway');
  assert.equal(number.revealAtMs, 240);
  assert.equal(process.revealAtMs, 300);
});

test('chapter timeline offsets survive when a long section spans coalesced scenes', () => {
  const builder = new ScenePlanBuilder();
  const makeChunk = startMs => Array.from({ length: 2 }, (_, index) => ({
    groupIndex: 3,
    durationMs: 2500,
    components: [{ type: 'demo-header', category: 'Explicação', chapterIndex: 2, chapterTotal: 3,
      chapterStartMs: startMs + index * 2500, chapterDurationMs: 10000 }]
  }));
  const scenes = builder.coalesceVisualScenes([...makeChunk(0), ...makeChunk(5000)], 5000);
  assert.equal(scenes.length, 2);
  assert.equal(scenes[1].components[0].chapterStartMs, 5000);
  assert.equal(scenes[1].components[0].chapterDurationMs, 10000);
  assert.equal(scenes[1].components[0].entries[0].chapterStartMs, 5000);
});

test('the spoken beat selects a process diagram before a metric or generic card', () => {
  const script = {
    seed: 2,
    forceLayout: 'hero',
    hook: { text: 'O processo tem etapas claras.' },
    mainContent: { sections: [{ title: 'Como funciona', content: 'Primeiro, 12 alertas entram no sistema.' }] }
  };
  const scenes = new ScenePlanBuilder().buildScenes(script, 18000, {
    1: { hero: 'data:image/jpeg;base64,AA==' }
  });
  const components = scenes.flatMap(scene => scene.components || []);
  assert(components.some(component => component.type === 'node-graph'));
  assert.equal(components.some(component => component.type === 'kinetic-number'), false);
});

test('minimal vertical scenes keep timed captions without duplicating them in a large highlight', () => {
  const text = 'O número chama atenção porque não é um mutirão pontual.';
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 31,
    minimal: true,
    forceLayout: 'hero',
    channel: 'Pulso Carreira',
    hook: { text },
    timings: [{
      durationMs: 8000,
      sentences: [{
        text,
        words: text.split(/\s+/),
        startMs: 0,
        durationMs: 8000,
        wordTimes: [0, 700, 1300, 2100, 2800, 3400, 4100, 5200, 6400]
      }]
    }]
  }, 8000, { 0: { sources: ['data:image/jpeg;base64,AA=='] } });

  assert.ok(findComponent(scenes, 'caption'), 'timed karaoke caption remains visible');
  assert.equal(findComponent(scenes, 'highlight'), undefined,
    'sentence-sized highlight must not duplicate and overflow the vertical caption');
  assert.equal(findComponent(scenes, 'clip-title'), undefined,
    'minimal clips rely on the timed caption instead of a fixed duplicate title');
  assert.equal(findComponent(scenes, 'watermark'), undefined,
    'minimal clips carry the channel once in the demo-header; a watermark would duplicate the brand');
  const header = findComponent(scenes, 'demo-header');
  assert.equal(header && header.category, 'Pulso Carreira',
    'demo-header is the single brand carrier in minimal vertical clips');
});

test('minimal vertical captions retain spoken metrics without duplicate chips or progress bars', () => {
  const text = '3,7x de redução e 35% de economia.';
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 83,
    minimal: true,
    forceLayout: 'hero',
    hook: { text },
    timings: [{ durationMs: 7000, sentences: [{
      text,
      words: text.split(/\s+/),
      startMs: 0,
      durationMs: 7000
    }] }]
  }, 7000, {});

  const components = scenes.flatMap(scene => scene.components || []);
  const spokenWords = components.flatMap(component => component.type === 'caption-track'
    ? component.pages.flatMap(page => page.words)
    : component.type === 'caption' ? component.words : []);
  assert.equal(components.some(component => component.type === 'spec-chips'), false);
  assert.equal(components.some(component => component.type === 'progress-bar'), false);
  assert.equal(spokenWords.map(word => word.w).join(' '), text,
    'the exact spoken metrics remain in the timed caption');

  const longForm = new ScenePlanBuilder().buildScenes({
    seed: 83,
    hook: { text },
    timings: [{ durationMs: 7000, sentences: [{ text, words: text.split(/\s+/), startMs: 0, durationMs: 7000 }] }]
  }, 7000, {});
  const longFormComponents = longForm.flatMap(scene => scene.components || []);
  assert.equal(longFormComponents.some(component => component.type === 'spec-chips'), true,
    'long-form keeps the grounded metric callout');
  assert.equal(longFormComponents.some(component => component.type === 'progress-bar'), true,
    'long-form keeps the percentage visualization');
});

test('narrative part indicators stay out of scenes that are rebuilt during capture', () => {
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 44,
    minimal: true,
    forceLayout: 'hero',
    partIndicator: { index: 2, count: 2 },
    hook: { text: 'A segunda parte continua a explicação.' }
  }, 5000, {});
  const indicators = scenes.flatMap(scene => scene.components || [])
    .filter(component => component.type === 'part-indicator');

  assert.equal(indicators.length, 0,
    'the renderer places the part indicator once on the stable composition root');
});

test('steady social narrative keeps a gentle image move across caption pages without rapid cuts', () => {
  const sentences = [
    'A primeira frase explica este fato confirmado.',
    'A outra explica o contexto e as consequências.'
  ].map((text, index) => {
    const words = text.split(/\s+/);
    return {
      text, words, startMs: index * 5000, durationMs: 5000,
      wordTimes: words.map((_, wordIndex) => Math.round(wordIndex * 4600 / words.length))
    };
  });
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 17,
    steadyNarrative: true,
    minimal: true,
    forceLayout: 'hero',
    hook: { text: sentences.map(sentence => sentence.text).join(' ') },
    timings: [{ durationMs: 10_000, sentences }]
  }, 10_000, { 0: { sources: ['data:image/jpeg;base64,AA=='] } });
  const heroes = scenes.flatMap(scene => scene.components || []).filter(component => component.type === 'image-hero');

  assert.equal(heroes.length, 1);
  assert(heroes.every(hero => hero.static === false && hero.noFade === true));
  assert(heroes.every(hero => hero.strong !== true));
  assert.deepEqual(heroes.map(hero => hero.src), ['data:image/jpeg;base64,AA==']);
  assert.equal(heroes[0].durMs, 10_000);
  assert(scenes.every(scene => scene.steadyNarrative === true));
  assert.equal(scenes.flatMap(scene => scene.components || []).some(component => component.type === 'pulse-glow'), false);
  assert.equal(scenes.length, 1, 'visual treatment remains stable while the timed caption track advances');
  const captionTrack = findComponent(scenes, 'caption-track');
  assert.deepEqual(captionTrack.pages.map(page => page.startMs), [0, 5000]);
});

test('a short narrated section keeps its scene image across an authored graph beat', () => {
  const texts = [
    'O navegador envia uma requisição pela rede.',
    'O servidor encontra o recurso pedido.',
    'A resposta retorna para a página.'
  ];
  const sentences = texts.map((text, index) => {
    const words = text.split(/\s+/);
    return { text, words, startMs: index * 3000, durationMs: 3000,
      wordTimes: words.map((_word, wordIndex) => Math.round(wordIndex * 2600 / words.length)) };
  });
  const scenes = new ScenePlanBuilder().buildScenes({
    steadyNarrative: true,
    forceLayout: 'hero',
    hook: null,
    mainContent: { sections: [{ title: 'A resposta HTTP', content: texts.join(' '),
      visual: { type: 'node-graph', nodes: ['Navegador', 'Servidor', 'Resposta'], cue: 'O servidor encontra' } }] },
    timings: [{ durationMs: 9000, sentences }]
  }, 9000, { 0: { sources: ['http-scene.png'] } });
  const components = scenes.flatMap(scene => scene.components || []);
  const repeatedHeroes = components.filter(component => component.type === 'image-hero');

  assert.ok(components.some(component => component.type === 'node-graph'));
  assert.equal(components.some(component => component.type === 'bento-card'), false,
    'a short section must not replace its narration-matched image with a full-sentence card');
  assert(repeatedHeroes.length >= 2);
  assert(repeatedHeroes.some(component => component.static === true),
    'the repeated scene remains legible without resetting its camera move');
});

test('long-form article screenshots get readable sequential dwell without shifting narration', () => {
  const texts = [
    'A abertura apresenta a notícia.',
    'A primeira fonte detalha o anúncio.',
    'O contexto adicional mantém a explicação.',
    'A análise compara os dados publicados.',
    'A conclusão resume os pontos confirmados.'
  ];
  const timings = texts.map((text, index) => {
    const words = text.split(/\s+/);
    return {
      audioOffsetMs: index * 3000,
      durationMs: 3000,
      sentences: [{
        text,
        words,
        startMs: 0,
        durationMs: 3000,
        wordTimes: words.map((_, wordIndex) => Math.round(wordIndex * 2600 / words.length))
      }]
    };
  });
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 215,
    hook: { text: texts[0] },
    mainContent: { sections: [{ title: 'A fonte', content: texts[1], print: {
      src: 'data:image/jpeg;base64,AA==', source: 'Fonte A', time: 'hoje'
    } }, { title: 'Contexto', content: texts[2] }, { title: 'Análise', content: texts[3] }] },
    conclusion: { finalThought: texts[4] },
    prints: [{ src: 'data:image/jpeg;base64,AQ==', source: 'Fonte B', time: 'hoje' }],
    timings
  }, 15_000, {});
  const prints = scenes.flatMap(scene => scene.components || [])
    .filter(component => component.type === 'article-print');
  const captionTrack = scenes.flatMap(scene => scene.components || [])
    .find(component => component.type === 'caption-track');

  assert.equal(prints.length, 2);
  for (const print of prints) {
    assert(print.sceneWindow.endMs - print.sceneWindow.startMs >= ARTICLE_PRINT_MIN_DWELL_MS);
  }
  assert(prints[1].sceneWindow.startMs >= prints[0].sceneWindow.endMs,
    'two source screenshots remain readable one at a time');
  assert.deepEqual(captionTrack.pages.map(page => page.startMs), [0, 3000, 6000, 9000, 12_000],
    'timed narration captions keep their original audio positions');
  assert.equal(scenes.reduce((sum, scene) => sum + scene.durationMs, 0), 15_000,
    'holding the screenshot does not stretch or desynchronize the narration');
});

test('article screenshots in minimal vertical cuts keep their original fast timing', () => {
  const texts = ['Abertura curta.', 'A fonte confirma o ponto.', 'Resumo final.'];
  const timings = texts.map((text, index) => {
    const words = text.split(/\s+/);
    return {
      audioOffsetMs: index * 3000,
      durationMs: 3000,
      sentences: [{ text, words, startMs: 0, durationMs: 3000, wordTimes: [0, 1000, 2000] }]
    };
  });
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 216,
    minimal: true,
    hook: { text: texts[0] },
    mainContent: { sections: [{ title: 'A fonte', content: texts[1], print: {
      src: 'data:image/jpeg;base64,AA==', source: 'Fonte A', time: 'hoje'
    } }] },
    conclusion: { finalThought: texts[2] },
    prints: [{ src: 'data:image/jpeg;base64,AQ==', source: 'Fonte B', time: 'hoje' }],
    timings
  }, 9000, {});
  const prints = scenes.flatMap(scene => scene.components || [])
    .filter(component => component.type === 'article-print');

  assert.equal(prints.length, 2);
  assert.deepEqual(prints.map(print => [print.sceneWindow.startMs, print.sceneWindow.endMs]), [[0, 3000], [3000, 6000]]);
  assert.equal(scenes.reduce((sum, scene) => sum + scene.durationMs, 0), 9000);
});

test('a late article screenshot starts early enough to finish its reading window before the master ends', () => {
  const texts = ['Abertura curta.', 'Contexto.', 'Análise.', 'Fonte no final.', 'Conclusão.'];
  const timings = texts.map((text, index) => {
    const words = text.split(/\s+/);
    return {
      audioOffsetMs: index * 3000,
      durationMs: 3000,
      sentences: [{ text, words, startMs: 0, durationMs: 3000, wordTimes: words.map((_, i) => Math.round(i * 2600 / words.length)) }]
    };
  });
  const scenes = new ScenePlanBuilder().buildScenes({
    seed: 217,
    hook: { text: texts[0] },
    mainContent: { sections: [
      { title: 'Contexto', content: texts[1] },
      { title: 'Análise', content: texts[2] },
      { title: 'A fonte', content: texts[3], print: {
        src: 'data:image/jpeg;base64,AA==', source: 'Fonte', time: 'ontem'
      } }
    ] },
    conclusion: { finalThought: texts[4] },
    prints: [],
    timings
  }, 15_000, {});
  const print = scenes.flatMap(scene => scene.components || [])
    .find(component => component.type === 'article-print');
  const outputDurationMs = scenes.reduce((sum, scene) => sum + scene.durationMs, 0);

  assert.equal(outputDurationMs, 15_000);
  assert.equal(print.sceneWindow.endMs - print.sceneWindow.startMs, ARTICLE_PRINT_MIN_DWELL_MS);
  assert(print.sceneWindow.endMs <= outputDurationMs, 'the final frame is not cut off by the MP4 boundary');
  assert.equal(print.sceneWindow.startMs, outputDurationMs - ARTICLE_PRINT_MIN_DWELL_MS,
    'only the minimum needed part of the screenshot window moves earlier');
});

function pacedNarrative(durationMs, sources) {
  const text = 'O vídeo apresenta os fatos confirmados e explica os limites da informação.';
  const words = text.split(/\s+/);
  return new ScenePlanBuilder().buildScenes({
    seed: 17, minimal: true, steadyNarrative: true, forceLayout: 'hero', maxCaptionWords: 12,
    hook: { text }, timings: [{ durationMs, sentences: [{ text, words, startMs: 0,
      durationMs, wordTimes: words.map((_, index) => Math.round(index * durationMs / words.length)) }] }]
  }, durationMs, { 0: { sources } });
}

function productionNarrative(durationMs, sources) {
  const text = 'O pesquisador observa o objeto, acompanha a mudança e identifica o resultado confirmado pela fonte.';
  const words = text.split(/\s+/);
  return new ScenePlanBuilder().buildScenes({
    seed: 29, forceLayout: 'hero', maxCaptionWords: 12,
    hook: { text }, timings: [{ durationMs, sentences: [{ text, words, startMs: 0,
      durationMs, wordTimes: words.map((_, index) => Math.round(index * durationMs / words.length)) }] }]
  }, durationMs, { 0: { sources } });
}

function visualWindows(scenes) {
  let cursor = 0;
  return scenes.flatMap(scene => {
    const visuals = scene.components.filter(component => component.type === 'image-hero'
      || component.type === 'bento-card' && component.editorialContext);
    const windows = visuals.map(component => ({ ...component,
      start: cursor + component.sceneWindow.startMs, end: cursor + component.sceneWindow.endMs }));
    cursor += scene.durationMs;
    return windows;
  });
}

test('a 48-second social section rotates contextual images with a bounded, readable hold', () => {
  const sources = ['data:image/png;base64,AA==', 'data:image/png;base64,AQ==', 'data:image/png;base64,Ag=='];
  const scenes = pacedNarrative(48000, sources);
  const visuals = visualWindows(scenes);
  assert.equal(visuals[0].start, 0);
  assert.equal(visuals.at(-1).end, 48000);
  assert.equal(scenes.reduce((sum, scene) => sum + scene.durationMs, 0), 48000);
  assert(visuals.length >= 4 && visuals.length <= 8);
  visuals.forEach((visual, index) => {
    assert(visual.end - visual.start >= 6000 && visual.end - visual.start <= 12000);
    assert(sources.includes(visual.src));
    if (index) {
      assert.equal(visual.start, visuals[index - 1].end);
      assert.notEqual(visual.src, visuals[index - 1].src);
    }
  });
  const captions = scenes.flatMap(scene => scene.components).flatMap(component => component.type === 'caption-track'
    ? component.pages.flatMap(page => page.words) : component.type === 'caption' ? component.words : []);
  assert.equal(captions.map(word => word.w).join(' '), 'O vídeo apresenta os fatos confirmados e explica os limites da informação.');
});

test('long-form production follows timed narration with grounded image changes', () => {
  const sources = ['scene-a', 'scene-b', 'scene-c'];
  const scenes = productionNarrative(48_000, sources);
  const visuals = visualWindows(scenes);

  assert(visuals.length >= 4 && visuals.length <= 8,
    'a long narrated beat should use multiple visual moments even after scene coalescing');
  assert.equal(visuals[0].start, 0);
  assert.equal(visuals.at(-1).end, 48_000);
  visuals.forEach((visual, index) => {
    assert(visual.end - visual.start >= 6000 && visual.end - visual.start <= 12_000);
    assert(sources.includes(visual.src));
    if (index) {
      assert.equal(visual.start, visuals[index - 1].end);
      assert.notEqual(visual.src, visuals[index - 1].src);
    }
  });
  assert(visuals.every(visual => visual.type === 'image-hero'),
    'production keeps one continuous story scene instead of split image panels');
});

test('nine seconds do not become a rapid sequence of image changes', () => {
  const visuals = visualWindows(pacedNarrative(9000, ['photo-a', 'photo-b', 'photo-c']));
  assert.equal(visuals.length, 1);
  assert.equal(visuals[0].end, 9000);
});

test('one available photo alternates with actual narration instead of holding for 48 seconds', () => {
  const visuals = visualWindows(pacedNarrative(48000, ['only-photo', 'only-photo']));
  assert(visuals.some(visual => visual.type === 'bento-card'));
  assert(visuals.filter(visual => visual.type === 'bento-card').every(visual => visual.subtitle.length > 0));
  assert(visuals.filter(visual => visual.type === 'bento-card').every(visual => /[.!?…]$/.test(visual.subtitle)),
    'an editorial interlude uses a complete narration sentence, not a cut-off caption fragment');
  assert(visuals.every(visual => visual.end - visual.start <= 12000));
  visuals.forEach((visual, index) => {
    if (index) assert.notEqual(visual.type, visuals[index - 1].type);
  });
});

test('portrait framing preserves every timed image change instead of selecting only the first photo', () => {
  const { sceneForViewport } = require('../utils/portrait-scene-layout');
  const scenes = pacedNarrative(48000, ['photo-a', 'photo-b', 'photo-c']);
  const portrait = scenes.map(scene => sceneForViewport(scene, 1080, 1920));
  assert.deepEqual(visualWindows(portrait).map(({ src, start, end }) => ({ src, start, end })),
    visualWindows(scenes).map(({ src, start, end }) => ({ src, start, end })));
  assert(portrait.flatMap(scene => scene.components).filter(component => component.type === 'image-hero')
    .every(component => component.fit === 'contain'));
});

test('social image windows cover measured audio even when cue timing leaves a small tail', () => {
  const scenes = new ScenePlanBuilder().buildScenes({
    minimal: true, steadyNarrative: true, forceLayout: 'hero',
    hook: 'Uma frase preservada na íntegra.',
    timings: [{ durationMs: 9000, sentences: [{
      text: 'Uma frase preservada na íntegra.', words: ['Uma', 'frase', 'preservada', 'na', 'íntegra.'],
      startMs: 100, durationMs: 8900
    }] }]
  }, 9000, { 0: { sources: ['photo-a', 'photo-b'] } });
  assert.equal(scenes.reduce((sum, scene) => sum + scene.durationMs, 0), 9000);
  assert.equal(visualWindows(scenes).at(-1).end, 9000);
});
