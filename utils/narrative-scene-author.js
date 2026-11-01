'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { requestNvidiaChatCompletion } = require('./nvidia-chat-completions');
const { reserveCall } = require('./api-usage');
const { cueHasLongBeatVariation } = require('./narrative-visual-semantics');
const { narrativeBeatRelation } = require('./narrative-beat-relation');
const { directNarrativeBeat, narrativeEntities, fallbackActionKind } = require('./narrative-direction');
const { normalizeIllustrations, illustrationPrompt } = require('./narrative-illustration-plan');
const { CREATIVE_REFERENCE, creativeReferencePrompt } = require('./narrative-creative-reference');
const {
  ACTION_KINDS, CAMERA_KINDS, OBJECT_KINDS, ROOT, SCHEMA_VERSION,
  sha256, stableJson, validateCueVisualGrounding, validateNarrativeEpisodePlan
} = require('./narrative-episode-plan');

const AUTHOR_REVISION = 'narrative-scene-author-v2.12';
const MAX_MODEL_ATTEMPTS = 2;
const CHAPTER_FIRST_THRESHOLD = 4;
const MAX_CHAPTER_REPAIRS = 5;
const FALLBACK_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
const GEMINI_SCENE_MODEL = 'gemini:gemini-3.5-flash-lite';
const GENERIC_LABELS = new Set([
  'entrada', 'processo', 'resultado', 'contexto', 'exemplo', 'fonte', 'pergunta',
  'resposta', 'sinal', 'etapa', 'possibilidade', 'limite', 'comparação', 'ponto de partida'
].map(label => label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')));
const THEMES = require('../config/themes.json').themes;

// Only classify known validation failures; never log provider responses or
// arbitrary exception messages, which may contain credentials or source text.
function sceneFailureTag(error) {
  if (error?.name === 'TimeoutError') return 'timeout';
  if (typeof error?.code === 'string') return error.code;
  const message = String(error?.message || '');
  if (/posição fora dos limites/.test(message)) return 'invalid_position';
  if (/^illustration:/.test(message)) return 'invalid_adaptive_illustration';
  if (/rótulo longo/.test(message)) return 'invalid_label_length';
  if (/rótulo literal/.test(message)) return 'unsupported_literal_label';
  if (/rótulo genérico/.test(message)) return 'invalid_generic_label';
  if (/símbolos genéricos repetidos/.test(message)) return 'invalid_repeated_generic_visuals';
  if (/gráfico sem valor verificável/.test(message)) return 'invalid_chart_without_verified_values';
  if (/^scene-\d+: frase [a-z\d_-]+ acima de 12 segundos precisa mudar o foco visual(?:;|$)/i.test(message)) return 'invalid_visual_rhythm';
  if (/^scene-\d+: frase [a-z\d_-]+ sobre trajetos diferentes precisa de mapa ou rede em foco$/i.test(message)) return 'invalid_visual_routes';
  if (/objeto|objetos/.test(message)) return 'invalid_objects';
  if (/ação|ações/.test(message)) return 'invalid_actions';
  if (/câmera/.test(message)) return 'invalid_camera';
  if (/enquadramento|gesto|síntese visual/.test(message)) return 'invalid_presenter';
  if (/cena|cenas/.test(message)) return 'invalid_scene_response';
  return 'error';
}

function parseJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const text = String(value || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw Object.assign(new Error('plano narrativo sem JSON'), { code: 'NARRATIVE_SCENE_JSON_MISSING' });
  const raw = text.slice(start, end + 1);
  try { return JSON.parse(raw); }
  catch {
    try { return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')); }
    catch { throw Object.assign(new Error('JSON do plano narrativo inválido'), { code: 'NARRATIVE_SCENE_JSON_INVALID' }); }
  }
}

function cleanText(value, limit = 200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function literalLabelChoices(text) {
  const value = cleanText(text, 4000);
  const words = [...value.matchAll(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu)];
  const stop = new Set(['a', 'as', 'o', 'os', 'e', 'de', 'da', 'das', 'do', 'dos', 'em', 'no', 'na',
    'nos', 'nas', 'um', 'uma', 'que', 'se', 'ao', 'aos', 'para', 'por', 'com', 'foi', 'são', 'é']);
  const choices = [];
  for (const length of [3, 2, 1]) {
    for (let i = 0; i + length <= words.length; i++) {
      if (stop.has(words[i][0].toLowerCase()) || stop.has(words[i + length - 1][0].toLowerCase())) continue;
      const last = words[i + length - 1];
      const label = value.slice(words[i].index, last.index + last[0].length);
      if (label.length < 3 || label.length > 24 || choices.includes(label)) continue;
      choices.push(label);
    }
  }
  return choices.slice(0, 32);
}

function buildChapterInputs(plan) {
  const sentenceById = new Map(plan.sentences.map(sentence => [sentence.id, sentence]));
  const assetsByGroup = new Map();
  for (const asset of plan.assets || []) {
    const current = assetsByGroup.get(asset.groupIndex) || [];
    current.push(asset);
    assetsByGroup.set(asset.groupIndex, current);
  }
  return plan.chapters.map((chapter, chapterIndex) => {
    const sentences = chapter.sentenceIds.map(id => sentenceById.get(id)).filter(Boolean);
    const firstSentenceIndex = plan.sentences.findIndex(sentence => sentence.id === sentences[0]?.id);
    const previousSentence = firstSentenceIndex > 0 ? plan.sentences[firstSentenceIndex - 1] : null;
    return {
      id: `scene-${String(chapterIndex + 1).padStart(2, '0')}`,
      chapterId: chapter.id, chapterTitle: chapter.title, chapterKind: chapter.kind,
      startFrame: chapter.startFrame, durationInFrames: chapter.durationInFrames,
      sentenceIds: sentences.map(sentence => sentence.id),
      previousSentence: previousSentence ? { id: previousSentence.id, text: previousSentence.text } : null,
      narration: sentences.map(sentence => ({ id: sentence.id, text: sentence.text,
        startFrame: sentence.startFrame, endFrame: sentence.endFrame, wordTimings: sentence.wordTimings })),
      assetId: (assetsByGroup.get(chapterIndex) || [])[0]?.id || null
    };
  });
}

function buildPrompt({ plan, chapterInputs, sourceContext, retryErrors = [], visualCritique = null }) {
  const theme = THEMES.find(item => item.id === plan.themeId);
  const context = String(sourceContext || '').replace(/\s+/g, ' ').trim().slice(0, 16000);
  const compact = chapterInputs.map(scene => ({
    id: scene.id, chapter: scene.chapterTitle, kind: scene.chapterKind,
    maximumObjects: Math.min(32, Math.max(4, scene.sentenceIds.length * 4)),
    previousSentence: scene.previousSentence?.text || null,
    assetAvailable: Boolean(scene.assetId), sentences: scene.narration.map(sentence => ({
      id: sentence.id, text: sentence.text, literalLabels: literalLabelChoices(sentence.text),
      minimumDistinctCameraFocuses: sentence.endFrame - sentence.startFrame > 12 * plan.fps ? 2 : 1,
      durationSeconds: Number(((sentence.endFrame - sentence.startFrame) / plan.fps).toFixed(2))
    }))
  }));
  const firstScene = chapterInputs[0];
  const firstCue = firstScene?.narration[0]?.id || '';
  const secondCue = firstScene?.narration[1]?.id || firstCue;
  const point = (x, y, scale = 1) => ({ x, y, scale });
  // The example itself must satisfy the minimum schema and use the actual
  // scene/cue IDs. A one-object, one-action example encouraged invalid output.
  const exampleLabel = cleanText(firstScene?.narration[0]?.text || plan.title, 24).trim();
  const secondExampleLabel = cleanText(firstScene?.narration[1]?.text || firstScene?.narration[0]?.text || plan.title, 24).trim();
  const example = { scenes: [{ id: firstScene?.id || '', visualThesis: 'Dois elementos da fala são relacionados.',
    objects: [{ id: 'obj-1', label: exampleLabel, kind: 'person', labelType: 'literal' },
      { id: 'obj-2', label: secondExampleLabel, kind: 'document', labelType: 'literal' }],
    layouts: { landscape: { objects: { 'obj-1': point(0.2, 0.3), 'obj-2': point(0.5, 0.4) } },
      portrait: { objects: { 'obj-1': point(0.3, 0.2), 'obj-2': point(0.7, 0.3) } } },
    actions: [{ targetObjectId: 'obj-1', cueSentenceId: firstCue, kind: 'travel',
      trajectories: { landscape: { from: point(0.2, 0.3), to: point(0.35, 0.3) },
        portrait: { from: point(0.3, 0.2), to: point(0.5, 0.2) } } },
    { targetObjectId: 'obj-2', cueSentenceId: secondCue, kind: 'reveal-part',
      trajectories: { landscape: { from: point(0.45, 0.4), to: point(0.5, 0.4) },
        portrait: { from: point(0.6, 0.3), to: point(0.7, 0.3) } } }],
    cameraShots: [{ cueSentenceId: firstCue, kind: 'wide', focusObjectId: 'obj-1' },
      { cueSentenceId: secondCue, kind: 'result', focusObjectId: 'obj-2' }],
    presenter: { side: 'right', framing: 'medium', gestureCues: [{ cueSentenceId: firstCue, gesture: 'explain' }] } }] };
  const critiqueText = Array.isArray(visualCritique) && visualCritique.length
    ? `\nVISUAL QA: corrija estes defeitos observados. Os IDs referem-se ao render anterior; aplique cada orientação à cena nova que represente o mesmo trecho. ${JSON.stringify(visualCritique.map(item => ({
      issue: cleanText(item.issue, 500), recommendedFix: cleanText(item.recommendedFix, 500), correction: item.correction || null
    })))}\n` : '';
  return `Você é diretor de arte e animador editorial do Pulso, em português do Brasil. Crie a encenação visual deste episódio de ${theme?.brand || plan.themeId}.
TEMA: ${plan.themeId}. TÍTULO: ${plan.title}.
FONTE PARA CONFERÊNCIA: ${plan.source.sourceTitle || 'não informada'} ${plan.source.sourceUrl || ''}
CONTEXTO: """${context}"""
ROTEIRO E TEMPOS REAIS DE TTS (não reescreva nem complete o texto): ${JSON.stringify(compact)}

Responda somente JSON válido com exatamente esta estrutura:
${JSON.stringify(example)}

REGRAS OBRIGATÓRIAS:
- O exemplo acima mostra apenas a estrutura: não copie seus objetos nem sua tese; crie cenas próprias para a pauta. A referência aprovada alterna apresentador, objeto concreto, transformação, percurso e resultado conforme a fala; não mantenha a mesma cena durante o capítulo inteiro.
- Retorne um item para cada ID de cena fornecido, na mesma ordem e sem adicionar cenas. Reutilize os IDs e os cueSentenceIds exatos.
- Valores permitidos: kind de objeto device, document, person, map, chart, product, token, vehicle, building, nature, cell, network, step ou number; labelType literal, illustrative ou generic; ação travel, reveal-part, transform, rearrange ou compare; câmera wide, detail, follow ou result; lado left ou right; enquadramento full, medium ou close; gesto hook, explain, point, compare, emphasize ou conclusion.
- Analise cada frase como uma explicação: identifique seus conceitos, objetos e relação explicitamente narrada, e faça cada ação e foco representá-los. Antes de escolher o kind, considere o desenho real: device é aparelho eletrônico, document é folha, person é pessoa, vehicle é carro, building é edifício, nature é árvore, cell é célula biológica, network é rede de nós, map é mapa e step são três pontos. Nunca escolha uma dessas figuras apenas porque o tema é abstrato: um celular é device, não cell; um processo ou decomposição não é uma árvore. Quando houver relação bidirecional ou comparação explícita, dê foco aos dois termos literais da frase; não acrescente causalidade ou números que a fonte não afirma.
- Encene o contexto, não apenas o substantivo: quando a fala estiver apresentando uma matéria, use um objeto document que funcione como página/site da publicação e inclua domínio ou título literal da fonte quando esses termos estiverem disponíveis; quando houver uma ação concreta, combine o agente e o objeto envolvidos (por exemplo, person + device para alguém operando um computador) e mova o objeto entre estados; quando houver emoção ou consequência, mostre a pessoa, o objeto e a relação/reação narrada. Adapte a forma ao cenário — notícia, documento, pessoa, computador, mapa, entrega, troca ou transformação — e não repita um cartão genérico para assuntos diferentes.
- Siga a explicação visual de AiAnswerExplainerPortrait: se a frase relata um objeto seguindo, sendo enviado, convertido ou substituído por outro, mostre origem e destino concretos da própria frase ao mesmo tempo e faça o movimento explicar essa relação; não use um único pictograma, uma fotografia decorativa ou só o texto da fala. Os dois rótulos devem ser expressões literais distintas da frase, e o sentido da seta deve seguir exatamente o que ela diz. Não desenhe uma seta afirmativa para uma relação negada ou hipotética.
- Em cada capítulo, crie objetos concretos ligados aos trechos que serão narrados. Use 1 a 3 objetos simultâneos e acrescente objetos diferentes quando o assunto mudar; uma frase longa com fluxo explícito pode usar até 8 objetos distribuídos em fases, nunca todos ao mesmo tempo. Cada cena deve ter de 2 até seu maximumObjects objetos, com IDs únicos. Use formas e esquemas editoriais legíveis, não decoração abstrata genérica. A cena precisa tornar visível o mecanismo, transformação, relação ou comparação da fala.
- Não represente conceitos físicos ou de saúde como step (três pontos) apenas para ter um objeto. Escolha a forma que ajude a explicar o trecho: por exemplo, sono, vias aéreas, relógio biológico e cérebro devem aparecer ligados ao conceito falado. Use chart/number apenas quando a fala contém um valor ou comparação real; não insinue números ou tendências ausentes. Não repita o mesmo pictograma em trechos diferentes só trocando o rótulo.
- Copie trechos curtos e específicos da narração ou fonte para os rótulos literais: nomes, grandezas, valores ou conceitos que expliquem esta pauta. Em cenas com 3 ou 4 objetos, pelo menos 2 rótulos devem ser específicos e literais; com 2 objetos, pelo menos 1. Não substitua os dados por cartões como “entrada”, “processo” e “resultado”. Se houver comparação de valores, apresente os valores reais como rótulos separados, sem inventar tendência.
- Cada rótulo deve ter no máximo 24 caracteres, contando espaços: escolha uma expressão literal curta em vez de uma frase inteira, legível em ambos os formatos.
- Em objetos labelType literal, copie exatamente um dos literalLabels da frase em que o objeto estará em foco, ou da frase imediatamente anterior: são trechos extraídos localmente, sem reescrita. Não troque singular/plural, não acrescente palavras nem combine trechos separados num rótulo literal. Escolha um termo curto disponível quando o nome completo ultrapassar 24 caracteres. A tese e os objetos ainda devem explicar a ação real da frase; a lista não é uma sequência de cartões pronta.
- Para cada frase, pelo menos um objeto em foco deve ter rótulo literal presente nessa frase ou na frase imediatamente anterior; uma representação hipotética pode ser marcada illustrative. Ao mostrar algo sendo dividido ou transformado em outra coisa, focalize os dois objetos presentes na fala. Não mantenha o mesmo foco e a mesma ação durante todas as frases de um capítulo longo.
- Se a frase falar em trajetos, caminhos ou rotas diferentes, inclua em foco um objeto map ou network que represente os percursos de forma ilustrativa, sem alegar uma rota real.
- Distribua ações pelas frases do capítulo, com até 3 ações por frase ou até 8 quando houver fluxo explícito e fases diferentes. Cada frase precisa ter seu próprio foco ou ação; alterne planos gerais, detalhes e resultados conforme o que a frase realmente afirma. A ação precisa ter objeto e resultado visual sustentados pela fala. Use os tipos permitidos; não use apenas fade/pulso. Não invente trajetos, causalidade, números ou relações para criar movimento.
- Em cada frase com minimumDistinctCameraFocuses=2, use pelo menos dois planos de câmera, focando dois objetos com rótulos ou kinds diferentes ligados à fala; o segundo plano ocorrerá durante a frase. IDs diferentes com mesmo rótulo e mesmo kind não mudam o foco visual. Nas demais frases basta um foco. Não deixe um único ícone na tela durante uma frase longa.
- Cada objeto precisa de uma posição nos dois formatos; respeite as zonas seguras: landscape x 0.12–0.56, y 0.16–0.58; portrait x 0.16–0.84, y 0.12–0.36. Deixe o robô, a imagem e a legenda livres.
- Trajetórias devem caber nessas zonas nos dois formatos, usar escala 0.55–1.35, e ligar estados coerentes. Não criar texto, número, nome, marca, instituição, conselho ou fato. Rótulo literal deve aparecer exatamente na fala ou fonte; rótulo generic deve ser exatamente um destes: entrada, processo, resultado, contexto, exemplo, fonte, pergunta, resposta, sinal, etapa, possibilidade, limite, comparação, ponto de partida. Qualquer exemplo pedagógico tem labelType illustrative e fica claramente esquemático.
- Câmera: ao menos 2 planos por capítulo, com foco em objeto existente; use até 2 planos por frase, distribuídos pelas frases do capítulo, alternando geral/detalhe/acompanhar/resultado quando houver mudança explicativa.
- O apresentador é o mesmo robô aprovado, usado na abertura e no encerramento; as demais frases são explicadas com objetos e planos adequados ao assunto. Indique lado e enquadramento; gestos em cues reais.
- O asset disponível é ilustrativo, nunca uma prova da notícia. Use-o apenas como apoio quando fizer sentido.
- Não inclua código executável, HTML, CSS ou URLs de assets. Geometria SVG/3D somente dentro do campo illustrations descrito abaixo.
${critiqueText}
${illustrationPrompt()}
${retryErrors.length ? `CORRIJA os problemas de validação anteriores, sem omitir cenas: ${retryErrors.slice(0, 18).join('; ')}` : ''}`;
}

function normalizePoint(point, label, aspect = '') {
  const x = Number(point?.x), y = Number(point?.y), scale = Number(point?.scale);
  const minX = aspect === 'landscape' ? 0.12 : aspect === 'portrait' ? 0.16 : 0.08;
  const maxX = aspect === 'landscape' ? 0.56 : aspect === 'portrait' ? 0.84 : 0.92;
  const minY = aspect === 'landscape' ? 0.16 : aspect === 'portrait' ? 0.12 : 0.08;
  const maxY = aspect === 'landscape' ? 0.58 : aspect === 'portrait' ? 0.36 : 0.92;
  if (![x, y, scale].every(Number.isFinite) || x < minX || x > maxX || y < minY || y > maxY
    || scale < 0.5 || scale > 1.6) throw new Error(`posição fora dos limites em ${label}: `
      + `x=${x}, y=${y}, scale=${scale}; esperado x=${minX}–${maxX}, y=${minY}–${maxY}, scale=0.5–1.6`);
  return { x, y, scale };
}

function buildAdaptivePrompt({ plan, chapterInputs, sourceContext, retryErrors = [], visualCritique = null }) {
  return `Você cria ilustrações animadas editoriais para explicar a narração em português. Entregue uma cena própria, concreta, desenhada com cuidado e legível, sem reduzir a fala a ícones em fila.
${creativeReferencePrompt()}
Título: ${plan.title}. Fonte: ${JSON.stringify(plan.source)}.
Contexto para conferência: ${String(sourceContext || '').slice(0, 9000)}
Cenas e narração exata: ${JSON.stringify(chapterInputs.map(input => ({ id: input.id, title: input.chapterTitle, previousSentence: input.previousSentence?.text, sentences: input.narration.map(sentence => ({ id: sentence.id, text: sentence.text, durationSeconds: (sentence.endFrame - sentence.startFrame) / plan.fps })) })))}
Responda somente JSON válido, sem markdown, neste formato: {"scenes":[{"id":"ID fornecido", "visualThesis":"o mecanismo que será visível", "illustrations":[COMPOSIÇÕES NO SCHEMA ABAIXO]}]}.
Retorne exatamente as cenas solicitadas. Não gere os antigos campos objects, layouts, actions, cameraShots ou presenter: eles serão derivados localmente; concentre a autoria nas composições illustrations. Não reescreva a narração.
${illustrationPrompt()}
${visualCritique?.length ? `Direção da revisão: ${JSON.stringify(visualCritique.map(item => ({ issue: item.issue, recommendedFix: item.recommendedFix })))}` : ''}
${retryErrors.length ? `Corrija estas falhas locais: ${retryErrors.join('; ')}` : ''}`;
}

function normalizeScene(raw, input, plan, textCorpus) {
  if (raw?.id !== input.id) throw new Error(`ID de cena não corresponde: esperado ${input.id}`);
  // The adaptive author specifies the drawing itself. Legacy metadata is
  // derived locally for existing audit/renderer consumers, never requested as
  // a second competing scene from the model.
  if (raw.illustrations?.length && !raw.objects) {
    for (const drawing of raw.illustrations) if (drawing.dimension === '3d') {
      for (const track of drawing.tracks || []) if (track.property === 'position3d' && track.targetId !== 'camera') {
        if (!(drawing.spatialChecks || []).some(check => check.subject?.nodeId === track.targetId && (track.meshIndex == null || check.subject.meshIndex === track.meshIndex))) {
          throw new Error(`illustration: spatialChecks ausente para a peça móvel ${track.targetId}[${track.meshIndex ?? 'node'}]`);
        }
      }
    }
    raw = { ...buildDeterministicScene(input, plan, textCorpus), ...raw };
  }
  // The contract permits a literal label from either the verified source or
  // this chapter's approved narration. Do not invent or accept other labels.
  const normalizedCorpus = [textCorpus, input.previousSentence?.text, ...input.narration.map(sentence => sentence.text)]
    .map(text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR'));
  const objects = (Array.isArray(raw.objects) ? raw.objects : []).map((object, index) => {
    const id = cleanText(object?.id, 40);
    const label = cleanText(object?.label, 72);
    const kind = String(object?.kind || '');
    let labelType = String(object?.labelType || '');
    if (!/^[a-z][a-z0-9_-]{0,39}$/i.test(id) || !label || !OBJECT_KINDS.has(kind)
      || !['literal', 'illustrative', 'generic'].includes(labelType)) {
      throw new Error(`${input.id}: objeto ${index + 1} inválido`);
    }
    if (label.length > 24) throw new Error(`${input.id}: rótulo longo; escolha até 24 caracteres da fala ou fonte`);
    const normalizedLabel = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
    const appearsInSourceOrNarration = normalizedCorpus.some(text => text.includes(normalizedLabel));
    // Models sometimes call a grounded topic-specific term "generic". It is
    // safe to classify it as literal only when its exact text is supported.
    if (labelType === 'generic' && !GENERIC_LABELS.has(normalizedLabel) && appearsInSourceOrNarration) {
      labelType = 'literal';
    }
    if (labelType === 'literal' && !appearsInSourceOrNarration) {
      throw new Error(`${input.id}: rótulo literal sem correspondência na fala/fonte: ${label}`);
    }
    if (labelType === 'generic' && !GENERIC_LABELS.has(normalizedLabel)) {
      throw new Error(`${input.id}: rótulo genérico não permitido: ${label}`);
    }
    return { id, label, kind, labelType, illustrative: labelType === 'illustrative' };
  });
  const maxObjects = Math.min(32, Math.max(4, input.sentenceIds.length * 4));
  if (objects.length < 2 || objects.length > maxObjects || new Set(objects.map(item => item.id)).size !== objects.length) {
    throw new Error(`${input.id}: são necessários 2–${maxObjects} objetos com IDs únicos`);
  }
  const groundedLabels = objects.filter(object => object.labelType === 'literal'
    && object.label.length >= 3 && !GENERIC_LABELS.has(object.label.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')));
  if (groundedLabels.length < (objects.length >= 3 ? 2 : 1)) {
    throw new Error(`${input.id}: objetos precisam de rótulos específicos literais da fala ou fonte, não apenas rótulos genéricos`);
  }
  const objectIds = new Set(objects.map(item => item.id));
  const layouts = {};
  for (const aspect of ['landscape', 'portrait']) {
    const source = raw.layouts?.[aspect]?.objects || {};
    const positions = {};
    for (const object of objects) positions[object.id] = normalizePoint(source[object.id], `${input.id}/${aspect}/${object.id}`, aspect);
    layouts[aspect] = { objects: positions };
  }
  const sentenceMap = new Map(input.narration.map(sentence => [sentence.id, sentence]));
  const actionsPerCue = new Map();
  const actions = (Array.isArray(raw.actions) ? raw.actions : []).map((action, index) => {
    const cue = sentenceMap.get(String(action?.cueSentenceId || ''));
    const targetObjectId = String(action?.targetObjectId || '');
    const kind = String(action?.kind || '');
    if (!cue || !objectIds.has(targetObjectId) || !ACTION_KINDS.has(kind)) {
      throw new Error(`${input.id}: ação ${index + 1} sem alvo/cue/tipo válido`);
    }
    const trajectories = {};
    for (const aspect of ['landscape', 'portrait']) {
      const source = action.trajectories?.[aspect];
      trajectories[aspect] = {
        from: normalizePoint(source?.from, `${input.id}/${aspect}/ação-${index + 1}/from`, aspect),
        to: normalizePoint(source?.to, `${input.id}/${aspect}/ação-${index + 1}/to`, aspect)
      };
    }
    const sameCueActionsBefore = actionsPerCue.get(cue.id) || 0;
    actionsPerCue.set(cue.id, sameCueActionsBefore + 1);
    const startFrame = Math.min(cue.endFrame - 1, input.startFrame + input.durationInFrames - 1,
      cue.startFrame + Math.round(sameCueActionsBefore * plan.fps * 0.32));
    const endFrame = Math.min(cue.endFrame, input.startFrame + input.durationInFrames,
      Math.max(startFrame + 1, startFrame + Math.min(Math.round(plan.fps * 1.35), Math.round((cue.endFrame - cue.startFrame) * 0.65))));
    if (startFrame < input.startFrame || endFrame > input.startFrame + input.durationInFrames) {
      throw new Error(`${input.id}: ação extrapola a duração da cena`);
    }
    return { targetObjectId, cueSentenceId: cue.id, kind, startFrame, endFrame, trajectories };
  });
  const maxActions = Math.min(64, Math.max(12, input.sentenceIds.length * 8));
  if (actions.length < 2 || actions.length > maxActions) throw new Error(`${input.id}: são necessárias 2–${maxActions} ações`);
  const rawCameraShots = Array.isArray(raw.cameraShots) ? raw.cameraShots : [];
  const shotsPerCue = new Map();
  for (const camera of rawCameraShots) {
    const cueId = String(camera?.cueSentenceId || '');
    shotsPerCue.set(cueId, (shotsPerCue.get(cueId) || 0) + 1);
  }
  const shotsSeenPerCue = new Map();
  const cameraShots = rawCameraShots.map((camera, index) => {
    const cue = sentenceMap.get(String(camera?.cueSentenceId || ''));
    const focusObjectId = String(camera?.focusObjectId || '');
    const kind = String(camera?.kind || '');
    if (!cue || !objectIds.has(focusObjectId) || !CAMERA_KINDS.has(kind)) {
      throw new Error(`${input.id}: plano de câmera ${index + 1} inválido`);
    }
    const shotIndex = shotsSeenPerCue.get(cue.id) || 0;
    shotsSeenPerCue.set(cue.id, shotIndex + 1);
    const shotCount = shotsPerCue.get(cue.id) || 1;
    const cueDuration = Math.max(1, cue.endFrame - cue.startFrame);
    const startFrame = cue.startFrame + Math.min(cueDuration - 1, Math.floor(shotIndex * cueDuration / shotCount));
    return { cueSentenceId: cue.id, kind, focusObjectId, startFrame, _sourceIndex: index };
  });
  const maxCameras = Math.min(64, Math.max(8, input.sentenceIds.length * 2));
  if (cameraShots.length < 2 || cameraShots.length > maxCameras) throw new Error(`${input.id}: são necessários 2–${maxCameras} planos de câmera`);
  cameraShots.sort((a, b) => a.startFrame - b.startFrame || a._sourceIndex - b._sourceIndex);
  for (const camera of cameraShots) delete camera._sourceIndex;
  const rhythm = [];
  for (const [cueIndex, sentenceId] of input.sentenceIds.entries()) {
    if (!actions.some(action => action.cueSentenceId === sentenceId)
      && !cameraShots.some(camera => camera.cueSentenceId === sentenceId)) {
      throw new Error(`${input.id}: frase ${sentenceId} sem ação ou câmera`);
    }
    const ids = new Set([...actions.filter(action => action.cueSentenceId === sentenceId).map(action => action.targetObjectId),
      ...cameraShots.filter(camera => camera.cueSentenceId === sentenceId).map(camera => camera.focusObjectId)]);
    const cue = sentenceMap.get(sentenceId);
    const flow = narrativeBeatRelation({ sentence: cue?.text, objects });
    if (ids.size > 4 && !(ids.size <= 8 && flow?.kind === 'flow')) throw new Error(`${input.id}: frase ${sentenceId} tem objetos demais em foco`);
    const previousCue = cueIndex ? sentenceMap.get(input.sentenceIds[cueIndex-1]) : input.previousSentence;
    const grounding = validateCueVisualGrounding({ scene: { objects, actions, cameraShots }, cue, previousCue });
    if (!grounding.grounded) throw new Error(`${input.id}: rótulo literal em foco sem vínculo com a frase ${sentenceId}`);
    if (!grounding.paired) throw new Error(`${input.id}: transformação na frase ${sentenceId} precisa de dois objetos em foco`);
    if (!grounding.routes) throw new Error(`${input.id}: frase ${sentenceId} sobre trajetos diferentes precisa de mapa ou rede em foco`);
    if (!cueHasLongBeatVariation({ cue, scene: { objects, cameraShots }, fps: plan.fps })) {
      const focusedLabels = cameraShots.filter(shot => shot.cueSentenceId === sentenceId)
        .map(shot => objects.find(object => object.id === shot.focusObjectId))
        .filter(Boolean).slice(0, 4).map(object => `${object.id}(${object.label}/${object.kind})`).join(', ');
      throw new Error(`${input.id}: frase ${sentenceId} acima de 12 segundos precisa mudar o foco visual; use 2 planos com rótulos ou kinds distintos; focos atuais: ${focusedLabels || 'nenhum'}`);
    }
    rhythm.push(grounding.signature);
  }
  if (rhythm.length >= 4 && new Set(rhythm).size < 2) throw new Error(`${input.id}: cena repetitiva sem mudança de foco ou ação`);
  const side = raw.presenter?.side === 'left' ? 'left' : raw.presenter?.side === 'right' ? 'right' : '';
  const framing = ['full', 'medium', 'close'].includes(raw.presenter?.framing) ? raw.presenter.framing : '';
  if (!side || !framing) throw new Error(`${input.id}: enquadramento do apresentador inválido`);
  const visualThesis = cleanText(raw.visualThesis, 200);
  if (!visualThesis) throw new Error(`${input.id}: síntese visual vazia`);
  const gestureCues = (Array.isArray(raw.presenter?.gestureCues) ? raw.presenter.gestureCues : []).map(item => {
    if (!sentenceMap.has(item?.cueSentenceId) || !['hook', 'explain', 'point', 'compare', 'emphasize', 'conclusion'].includes(item?.gesture)) {
      throw new Error(`${input.id}: gesto sem frase/alvo permitido`);
    }
    return { cueSentenceId: item.cueSentenceId, gesture: item.gesture };
  });
  if (!gestureCues.length || gestureCues.length > 6) throw new Error(`${input.id}: gestos narrativos ausentes ou excessivos`);
  const asset = plan.assets.find(item => item.id === input.assetId);
  return {
    id: input.id, chapterId: input.chapterId, title: input.chapterTitle,
    visualThesis,
    startFrame: input.startFrame, durationInFrames: input.durationInFrames,
    sentenceIds: input.sentenceIds, claimRefs: input.sentenceIds.map(id => `claim-${id}`), objects, actions, cameraShots,
    presenter: { side, framing, gestureCues }, layouts,
    illustrations: normalizeIllustrations(raw.illustrations, input.narration, plan.fps),
    direction: input.narration.map((sentence, index) => directNarrativeBeat({ sentence,
      previousSentence: input.narration[index - 1] || input.previousSentence, source: plan.source, fps: plan.fps })).filter(Boolean),
    ...(asset ? { assetId: asset.id } : {})
  };
}

function fallbackObjectKind(text) {
  const value = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  if (/trajet|rota|caminho|percurso/.test(value)) return 'map';
  if (/rede|conexao|conexoes|servidor|navegador|internet/.test(value)) return 'network';
  if (/\b\d+(?:[,.]\d+)?\b|por cento|%|bilhao|milhao|numero|quantidade/.test(value)) return 'number';
  if (/dna|celula|embriao|espermatozoide|gene|epigen|histona|rna|metilacao/.test(value)) return 'cell';
  if (/estudo|artigo|revista|revisao|fonte|evidencia|pesquisa|publicad/.test(value)) return 'document';
  if (/homem|mulher|casal|pessoa|medic|autor|paciente|profissional/.test(value)) return 'person';
  if (/produto|marca|aparelho|celular|computador|dispositivo/.test(value)) return 'device';
  return 'token';
}

function fallbackPoint(index, aspect) {
  const landscape = aspect === 'landscape';
  const xs = landscape ? [0.18, 0.31, 0.44, 0.54] : [0.20, 0.40, 0.60, 0.78];
  const ys = landscape ? [0.20, 0.36, 0.52] : [0.14, 0.24, 0.34];
  return { x: xs[index % xs.length], y: ys[Math.floor(index / xs.length) % ys.length], scale: 0.82 + (index % 3) * 0.06 };
}

function fallbackTrajectory(point, index, aspect) {
  const next = fallbackPoint(index + 1, aspect);
  return { from: point, to: next };
}

function buildDeterministicScene(input, plan, sourceContext) {
  const chapterTexts = input.narration.map(sentence => sentence.text);
  const allTexts = [input.previousSentence?.text, ...chapterTexts, plan.title, sourceContext].filter(Boolean);
  const labelPool = allTexts.flatMap(text => literalLabelChoices(text));
  const objects = [];
  const objectForSentence = [];
  const usedLabels = new Set();
  for (const [index, sentence] of input.narration.entries()) {
    const grounded = narrativeEntities(sentence.text);
    const sentenceLabels = [...grounded.map(entity => entity.label), ...literalLabelChoices(sentence.text)];
    const label = sentenceLabels.find(candidate => !usedLabels.has(candidate))
      || sentenceLabels[0]
      || null;
    if (label) usedLabels.add(label);
    const id = `fallback-object-${String(index + 1).padStart(2, '0')}`;
    objects.push({ id, label: label || 'ilustração', kind: grounded.find(entity => entity.label === label)?.kind || fallbackObjectKind(label || sentence.text),
      labelType: label ? 'literal' : 'illustrative' });
    objectForSentence.push(id);
  }
  if (objects.length < 2) {
    const label = labelPool.find(candidate => candidate !== objects[0]?.label) || objects[0]?.label || 'ilustração';
    objects.push({ id: 'fallback-object-02', label, kind: fallbackObjectKind(plan.title),
      labelType: label === 'ilustração' ? 'illustrative' : 'literal' });
  }
  const literalObject = objects.find(object => object.labelType === 'literal');
  if (objects.length >= 3 && literalObject && objects.filter(object => object.labelType === 'literal').length < 2) {
    const second = objects.find(object => object !== literalObject);
    second.label = literalObject.label;
    second.labelType = 'literal';
  }
  const layouts = { landscape: { objects: {} }, portrait: { objects: {} } };
  objects.forEach((object, index) => {
    layouts.landscape.objects[object.id] = fallbackPoint(index, 'landscape');
    layouts.portrait.objects[object.id] = fallbackPoint(index, 'portrait');
  });
  const actions = [];
  const cameraShots = [];
  const gestures = [];
  for (const [index, sentence] of input.narration.entries()) {
    const targetId = objectForSentence[index] || objects[0].id;
    const targetIndex = objects.findIndex(object => object.id === targetId);
    const target = objects[targetIndex >= 0 ? targetIndex : 0];
    const trajectories = {
      landscape: fallbackTrajectory(layouts.landscape.objects[target.id], targetIndex >= 0 ? targetIndex : 0, 'landscape'),
      portrait: fallbackTrajectory(layouts.portrait.objects[target.id], targetIndex >= 0 ? targetIndex : 0, 'portrait')
    };
    actions.push({ targetObjectId: target.id, cueSentenceId: sentence.id,
      kind: fallbackActionKind(sentence.text), trajectories });
    cameraShots.push({ cueSentenceId: sentence.id, kind: fallbackActionKind(sentence.text) === 'travel' ? 'follow' : 'wide', focusObjectId: target.id });
    const normalized = String(sentence.text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
    const paired = /\b(?:divid\w*|separ\w*|fragment\w*|transform\w*|convert\w*)\b.{0,100}\b(?:em|para|entre)\b/.test(normalized);
    const route = /\b(?:trajet|rota|caminho|percurso)/.test(normalized);
    if (paired || route || sentence.endFrame - sentence.startFrame > 12 * plan.fps) {
      const alternateIndex = (targetIndex + 1) % objects.length;
      const alternate = objects[alternateIndex];
      actions.push({ targetObjectId: alternate.id, cueSentenceId: sentence.id,
        kind: paired ? 'transform' : 'reveal-part', trajectories: {
          landscape: fallbackTrajectory(layouts.landscape.objects[alternate.id], alternateIndex, 'landscape'),
          portrait: fallbackTrajectory(layouts.portrait.objects[alternate.id], alternateIndex, 'portrait')
        } });
      cameraShots.push({ cueSentenceId: sentence.id, kind: 'detail', focusObjectId: alternate.id });
    }
    if (index === 0 || index === input.narration.length - 1 || sentence.endFrame - sentence.startFrame > 12 * plan.fps) {
      gestures.push({ cueSentenceId: sentence.id, gesture: index === 0 ? 'hook' : index === input.narration.length - 1 ? 'conclusion' : 'explain' });
    }
  }
  if (cameraShots.length < 2) {
    const first = input.narration[0];
    cameraShots.push({ cueSentenceId: first.id, kind: 'detail', focusObjectId: objects[1].id });
    actions.push({ targetObjectId: objects[1].id, cueSentenceId: first.id, kind: 'reveal-part', trajectories: {
      landscape: fallbackTrajectory(layouts.landscape.objects[objects[1].id], 1, 'landscape'),
      portrait: fallbackTrajectory(layouts.portrait.objects[objects[1].id], 1, 'portrait')
    } });
  }
  if (!gestures.length) gestures.push({ cueSentenceId: input.narration[0].id, gesture: 'explain' });
  return {
    id: input.id,
    visualThesis: `Explicação visual de ${cleanText(input.chapterTitle, 120)}`,
    objects, layouts, actions, cameraShots,
    presenter: { side: input.id.endsWith('02') ? 'left' : 'right', framing: input.chapterKind === 'hook' ? 'close' : 'medium', gestureCues: gestures.slice(0, 6) }
  };
}

function validateAuthoredPlan(plan, inputs, sourceContext) {
  const errors = [];
  if (!Array.isArray(plan.scenes) || plan.scenes.length !== inputs.length) errors.push('quantidade de cenas divergente');
  const source = `${sourceContext || ''} ${plan.title || ''}`;
  (plan.scenes || []).forEach((scene, index) => {
    try { plan.scenes[index] = normalizeScene(scene, inputs[index], plan, source); }
    catch (error) { errors.push(error.message); }
  });
  if (errors.length) return { valid: false, errors };
  const result = validateNarrativeEpisodePlan(plan);
  return { valid: result.valid, errors: result.errors.map(error => `contract:${error}`) };
}

async function writeAtomic(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, contents, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

async function readCache(cachePath, inputSha256) {
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    if (parsed?.authorRevision === AUTHOR_REVISION && parsed?.inputSha256 === inputSha256
      && parsed.author?.scenesSha256 === sha256(Buffer.from(stableJson(parsed.plan?.scenes || [])))
      && validateNarrativeEpisodePlan(parsed.plan).valid) return parsed;
  } catch { /* invalid cache is replaced atomically; source assets remain untouched */ }
  return null;
}

async function requestGeminiScene({ prompt, model }) {
  const { AITextService } = require('./ai-text-service');
  const service = new AITextService({ gemini: { apiKey: process.env.GEMINI_API_KEY, model, timeoutMs: 90000 } });
  return service.generateText(prompt, { model, maxTokens: 16000, temperature: 0.2, signal: AbortSignal.timeout(90000) });
}

async function authorNarrativeScenes({ plan, sourceContext = '', model = process.env.NARRATIVE_ILLUSTRATION_MODEL || process.env.NARRATIVE_SCENE_MODEL || 'z-ai/glm-5.3-flash',
  visualCritique = null, cacheDir = path.join(ROOT, 'data', 'cache', 'narrative-scenes'), logger = console,
  reserve = reserveCall, request = requestNvidiaChatCompletion,
  geminiEnabled = Boolean(process.env.GEMINI_API_KEY), geminiFirst = true, geminiRequest = requestGeminiScene } = {}) {
  if (!plan || plan.schemaVersion !== SCHEMA_VERSION) throw new TypeError('plano-base narrativo inválido');
  if (plan.chapters?.length < 1 || plan.sentences?.length < 1
    || plan.claims?.length !== plan.sentences.length
    || !/^[a-f0-9]{64}$/i.test(String(plan.inputSha256 || ''))) throw new Error('plano-base sem narração, claims ou hash');
  const contextHash = sha256(Buffer.from(String(sourceContext || '').replace(/\s+/g, ' ').trim()));
  const critiqueHash = Array.isArray(visualCritique) && visualCritique.length
    ? sha256(Buffer.from(stableJson(visualCritique))) : 'none';
  // scriptSha256 also contains volatile news age and screenshot metadata.
  // Scene authorship depends on the actual reviewed narration/visual inputs;
  // a retry must retain completed chapters when only that metadata changes.
  const visualInputs = {
    creativeReference: CREATIVE_REFERENCE,
    schemaVersion: plan.schemaVersion, jobId: plan.jobId, themeId: plan.themeId, title: plan.title,
    narrationSha256: plan.narrationSha256, source: plan.source, fps: plan.fps,
    durationMs: plan.durationMs, durationInFrames: plan.durationInFrames, seed: plan.seed,
    speechEnvelopeSha256: plan.speechEnvelopeSha256, chapters: plan.chapters,
    sentences: plan.sentences, claims: plan.claims, assets: plan.assets, palette: plan.palette || null
  };
  const visualInputSha256 = sha256(Buffer.from(stableJson(visualInputs)));
  const inputSha256 = sha256(Buffer.from(`${AUTHOR_REVISION}:${visualInputSha256}:${contextHash}:${model}:${critiqueHash}`));
  const cachePath = path.join(cacheDir, `${plan.themeId}-${inputSha256}.json`);
  const legacyInputSha256 = sha256(Buffer.from(`${AUTHOR_REVISION}:${plan.inputSha256}:${contextHash}:${model}:${critiqueHash}`));
  const legacyCachePath = path.join(cacheDir, `${plan.themeId}-${legacyInputSha256}.json`);
  const cached = await readCache(cachePath, inputSha256);
  if (cached) {
    logger.info?.(`plano de cenas reutilizado por hash (${cached.plan.scenes.length} cenas)`);
    const rebound = { ...plan, scenes: cached.plan.scenes };
    if (!validateNarrativeEpisodePlan(rebound).valid) throw new Error('cache visual não corresponde ao contrato atual');
    return { ...rebound, author: cached.author, cachePath, cached: true };
  }
  const chapterInputs = buildChapterInputs(plan);
  const key = process.env.NVIDIA_API_KEY;
  const deterministicFallback = process.env.PULSO_DETERMINISTIC_SCENE_FALLBACK === '1';
  if (!key && !geminiEnabled && !deterministicFallback) {
    throw Object.assign(new Error('chave de autoria das cenas ausente'), { code: 'NVIDIA_API_KEY_MISSING' });
  }
  const enriched = { ...plan, scenes: [] };
  let retryErrors = [];
  let lastError = null;
  // A stalled model must not consume both attempts on every scheduler retry.
  // The second writer still goes through the exact same scene validation.
  const models = [model, model === FALLBACK_MODEL ? 'z-ai/glm-5.3-flash' : FALLBACK_MODEL];
  // Preserve already validated work when upgrading the cache key. Only the
  // exact legacy input hash is eligible, and every scene is validated again.
  for (const input of chapterInputs) {
    const destination = `${cachePath}.${input.id}.partial`;
    try {
      await fs.access(destination);
      continue;
    } catch { /* No entry under the new key yet. */ }
    try {
      const partial = JSON.parse(await fs.readFile(`${legacyCachePath}.${input.id}.partial`, 'utf8'));
      if (partial.inputSha256 !== legacyInputSha256
        || partial.sceneSha256 !== sha256(Buffer.from(stableJson(partial.scene)))) continue;
      const scene = normalizeScene(partial.scene, input, plan, `${sourceContext || ''} ${plan.title || ''}`);
      await writeAtomic(destination, `${JSON.stringify({ ...partial, scene, inputSha256,
        sceneSha256: sha256(Buffer.from(stableJson(scene))) })}\n`);
      logger.info?.(`${input.id}: cache anterior validado e preservado`);
    } catch { /* Incompatible legacy entries are never reused. */ }
  }
  let hasValidPartial = false;
  for (const input of chapterInputs) {
    try {
      const partial = JSON.parse(await fs.readFile(`${cachePath}.${input.id}.partial`, 'utf8'));
      if (partial.inputSha256 !== inputSha256
        || partial.sceneSha256 !== sha256(Buffer.from(stableJson(partial.scene)))) continue;
      normalizeScene(partial.scene, input, plan, `${sourceContext || ''} ${plan.title || ''}`);
      hasValidPartial = true;
      break;
    } catch { /* missing or invalid partial cache does not skip full batch */ }
  }
  for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt += 1) {
    // Large batches repeatedly timed out or returned incomplete schemas in
    // production. Start with bounded chapters for those episodes and retain
    // the exact same validation and per-chapter cache.
    if (!key || hasValidPartial || (geminiEnabled && geminiFirst) || chapterInputs.length >= CHAPTER_FIRST_THRESHOLD) break;
    const attemptModel = models[attempt - 1];
    try {
      await reserve('nvidia', Number(process.env.NVIDIA_CALLS_PER_DAY || 200), {
        jobId: plan.jobId, operation: 'narrative-scene-author'
      });
      const response = await request({
        apiKey: key,
        timeoutMs: 180_000,
        body: {
          model: attemptModel, stream: false, max_tokens: Math.min(16000, Math.max(5000, chapterInputs.length * 1800)),
          temperature: 0.2,
          ...(attemptModel.startsWith('z-ai/glm') ? { reasoning_effort: 'low', chat_template_kwargs: { clear_thinking: true } }
            : attemptModel === FALLBACK_MODEL ? { reasoning_budget: 1024 } : {}),
          messages: [{ role: 'user', content: buildAdaptivePrompt({ plan, chapterInputs, sourceContext, retryErrors, visualCritique }) }]
        }
      });
      if (!response.ok) throw Object.assign(new Error(`NVIDIA scene author HTTP ${response.status}`), {
        code: `NVIDIA_HTTP_${response.status}`
      });
      const body = await response.json();
      if (body.choices?.[0]?.finish_reason === 'length') throw Object.assign(new Error('resposta do autor de cenas truncada'), {
        code: 'NARRATIVE_SCENE_RESPONSE_TRUNCATED'
      });
      const parsed = parseJson(body.choices?.[0]?.message?.content);
      if (!Array.isArray(parsed.scenes) || parsed.scenes.length !== chapterInputs.length) {
        throw new Error(`modelo retornou ${parsed.scenes?.length || 0}/${chapterInputs.length} cenas`);
      }
      enriched.scenes = parsed.scenes.map((scene, index) => normalizeScene(scene, chapterInputs[index], plan,
        `${sourceContext || ''} ${plan.title || ''}`));
      const result = validateNarrativeEpisodePlan(enriched);
      if (!result.valid) throw Object.assign(new Error(`plano narrativo reprovado: ${result.errors.slice(0, 20).join(', ')}`), {
        code: 'NARRATIVE_SCENE_PLAN_INVALID', validationErrors: result.errors
      });
      const author = { model: attemptModel, revision: AUTHOR_REVISION, createdAt: new Date().toISOString(), attempt,
        inputSha256, scenesSha256: sha256(Buffer.from(stableJson(enriched.scenes))) };
      const entry = { authorRevision: AUTHOR_REVISION, inputSha256, author, plan: enriched };
      await writeAtomic(cachePath, `${JSON.stringify(entry, null, 2)}\n`);
      return { ...enriched, author, cachePath, cached: false };
    } catch (error) {
      lastError = error;
      const failureTag = sceneFailureTag(error);
      retryErrors = Array.isArray(error.validationErrors) ? error.validationErrors
        : /^invalid_|^unsupported_literal_label$|^NARRATIVE_SCENE_(?:JSON_MISSING|JSON_INVALID|RESPONSE_TRUNCATED)$/.test(failureTag)
          ? [cleanText(error.message, 300)] : [];
      logger.warn?.(`autoria de cenas ${attempt}/${MAX_MODEL_ATTEMPTS} (${attemptModel}) falhou (${failureTag})`);
      if (attempt === MAX_MODEL_ATTEMPTS || error?.code === 'BUDGET_EXHAUSTED') break;
    }
  }
  // Large multi-chapter responses can time out or be truncated. Recover with
  // small, individually validated requests and persist each completed chapter
  // so an interrupted job does not start those successful calls over.
  if (chapterInputs.length > 1 || geminiEnabled || deterministicFallback) {
    const partialScenes = [];
    const modelsByScene = {};
    for (const input of chapterInputs) {
      const chapterCachePath = `${cachePath}.${input.id}.partial`;
      let scene = null;
      let sceneModel = 'unknown';
      try {
        const partial = JSON.parse(await fs.readFile(chapterCachePath, 'utf8'));
        if (partial.inputSha256 === inputSha256
          && partial.sceneSha256 === sha256(Buffer.from(stableJson(partial.scene)))) {
          scene = normalizeScene(partial.scene, input, plan, `${sourceContext || ''} ${plan.title || ''}`);
          if (/^[a-zA-Z0-9:._/-]{1,120}$/.test(String(partial.model || ''))) sceneModel = partial.model;
        }
      } catch { /* invalid or missing partial is regenerated */ }
      if (!scene) {
        let chapterError = null;
        let chapterFeedback = [];
        // Gemini produced a validated scene quickly in the configured runtime;
        // try it first while preserving the other provider as fallback.
        const chapterModels = [...(geminiEnabled && geminiFirst ? [GEMINI_SCENE_MODEL] : []), ...(key ? [process.env.NARRATIVE_ILLUSTRATION_MODEL || FALLBACK_MODEL] : []),
          ...(geminiEnabled && !geminiFirst ? [GEMINI_SCENE_MODEL] : []), ...(key ? [model] : [])]
          .filter((item, index, all) => all.indexOf(item) === index);
        let repairCount = 0;
        const repairErrors = new Set();
        for (let modelIndex = 0; modelIndex < chapterModels.length; modelIndex += 1) {
          const attemptModel = chapterModels[modelIndex];
          try {
            const prompt = buildAdaptivePrompt({ plan, chapterInputs: [input], sourceContext, retryErrors: chapterFeedback, visualCritique });
            let content;
            if (attemptModel === GEMINI_SCENE_MODEL) {
              const limit = Number(process.env.GEMINI_CALLS_PER_DAY || process.env.AI_PROVIDER_CALLS_PER_DAY || 200);
              await reserve('script-gemini', limit, { jobId: plan.jobId, operation: 'narrative-scene-author' });
              content = await geminiRequest({ prompt, model: attemptModel.slice('gemini:'.length) });
            } else {
              await reserve('nvidia', Number(process.env.NVIDIA_CALLS_PER_DAY || 200), {
                jobId: plan.jobId, operation: 'narrative-scene-author'
              });
              const response = await request({ apiKey: key, timeoutMs: 180_000, body: {
                model: attemptModel, stream: false, max_tokens: 16000, temperature: 0.2,
                response_format: { type: 'json_object' },
                ...(attemptModel.startsWith('z-ai/glm') ? { reasoning_effort: 'low', chat_template_kwargs: { clear_thinking: true } }
                  : attemptModel === FALLBACK_MODEL ? { reasoning_budget: 1024 } : {}),
                messages: [{ role: 'user', content: prompt }]
              } });
              if (!response.ok) throw Object.assign(new Error(`NVIDIA scene author HTTP ${response.status}`), { code: `NVIDIA_HTTP_${response.status}` });
              const body = await response.json();
              if (body.choices?.[0]?.finish_reason === 'length') throw Object.assign(new Error('resposta de cena truncada'), { code: 'NARRATIVE_SCENE_RESPONSE_TRUNCATED' });
              content = body.choices?.[0]?.message?.content;
            }
            const parsed = parseJson(content);
            if (!Array.isArray(parsed.scenes) || parsed.scenes.length !== 1) throw new Error('resposta não contém exatamente uma cena');
            scene = normalizeScene(parsed.scenes[0], input, plan, `${sourceContext || ''} ${plan.title || ''}`);
            sceneModel = attemptModel;
            await writeAtomic(chapterCachePath, `${JSON.stringify({ inputSha256, scene, model: sceneModel,
              sceneSha256: sha256(Buffer.from(stableJson(scene))) })}\n`);
            break;
          } catch (error) {
            scene = null;
            chapterError = error;
            const failureTag = sceneFailureTag(error);
            const repairable = /^invalid_|^unsupported_literal_label$/.test(failureTag)
              || /^NARRATIVE_SCENE_(?:JSON_MISSING|JSON_INVALID|RESPONSE_TRUNCATED)$/.test(failureTag);
            // Show only a known local validation message, never provider or
            // network exception text. The path identifies the faulty cue.
            const localDetail = repairable && !error?.code && /^scene-\d+: /.test(String(error?.message || ''))
              ? cleanText(error.message, 300) : '';
            logger.warn?.(`autoria de ${input.id} (${attemptModel}) falhou (${failureTag})${localDetail ? `: ${localDetail}` : ''}`);
            // Never send an arbitrary provider/network error to another API.
            const feedback = repairable ? cleanText(error.message, 300) : '';
            if (feedback && !chapterFeedback.includes(feedback)) chapterFeedback.push(feedback);
            // Validation reports the first defect, so repairing objects can
            // reveal a separate geometry defect. Allow a bounded correction
            // for each new message, carrying prior feedback forward. Never
            // repeat an identical failure, timeout or infrastructure error.
            if (repairable && feedback && repairCount < MAX_CHAPTER_REPAIRS && !repairErrors.has(feedback)) {
              chapterModels.splice(modelIndex + 1, 0, attemptModel);
              repairErrors.add(feedback);
              repairCount += 1;
            }
          }
        }
        if (!scene) {
          if (deterministicFallback) {
            try {
              scene = normalizeScene(buildDeterministicScene(input, plan, sourceContext), input, plan,
                `${sourceContext || ''} ${plan.title || ''}`);
              sceneModel = 'deterministic-fallback';
              await writeAtomic(chapterCachePath, `${JSON.stringify({ inputSha256, scene, model: sceneModel,
                sceneSha256: sha256(Buffer.from(stableJson(scene))) })}\n`);
              logger.warn?.(`autoria de ${input.id}: usando fallback determinístico validado`);
            } catch (error) {
              chapterError = error;
              logger.warn?.(`fallback determinístico de ${input.id} falhou (${sceneFailureTag(error)})`);
              scene = null;
            }
          }
        }
        if (!scene) {
          lastError = chapterError || lastError;
          break;
        }
      }
      partialScenes.push(scene);
      modelsByScene[input.id] = sceneModel;
    }
    if (partialScenes.length === chapterInputs.length) {
      enriched.scenes = partialScenes;
      const result = validateNarrativeEpisodePlan(enriched);
      if (result.valid) {
        const author = { model: 'chapter-fallback', modelsByScene, revision: AUTHOR_REVISION, createdAt: new Date().toISOString(),
          inputSha256, scenesSha256: sha256(Buffer.from(stableJson(enriched.scenes))) };
        await writeAtomic(cachePath, `${JSON.stringify({ authorRevision: AUTHOR_REVISION, inputSha256, author, plan: enriched }, null, 2)}\n`);
        return { ...enriched, author, cachePath, cached: false };
      }
      const safeErrors = result.errors.filter(item => /^[A-Za-z0-9:_.-]{1,180}$/.test(String(item))).slice(0, 24);
      logger.warn?.(`plano narrativo por capítulos reprovado: ${safeErrors.join(', ') || 'contrato inválido'}`);
      lastError = Object.assign(new Error('plano narrativo por capítulos reprovado'), { code: 'NARRATIVE_SCENE_PLAN_INVALID' });
    }
  }
  // Invalid, incomplete or timed-out model responses are retryable even when
  // no chapter was saved yet: the script, narration and job identity remain
  // reusable. Keep explicit infrastructure/configuration error codes intact.
  const transientResponse = !lastError?.code || lastError?.name === 'TimeoutError'
    || /^NARRATIVE_SCENE_(?:JSON_MISSING|JSON_INVALID|RESPONSE_TRUNCATED|PLAN_INVALID)$/.test(lastError.code);
  const failureCode = transientResponse ? 'NARRATIVE_SCENE_PROVIDER_UNAVAILABLE' : lastError.code;
  throw Object.assign(new Error(`não foi possível criar um plano visual validado: ${failureCode}`), {
    // safeErrorTag follows causes before codes. Do not let a nested scene
    // validation error mask the retryable wrapper and discard the job.
    code: failureCode, ...(transientResponse ? {} : { cause: lastError })
  });
}

module.exports = { AUTHOR_REVISION, authorNarrativeScenes, buildChapterInputs, buildPrompt, buildAdaptivePrompt, buildDeterministicScene, normalizeScene,
  literalLabelChoices, parseJson, sceneFailureTag, validateAuthoredPlan };
