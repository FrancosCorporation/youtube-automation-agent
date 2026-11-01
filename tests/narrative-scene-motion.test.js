'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { narrativeActionMotion } = require('../utils/narrative-visual-motion');
const { transitBeat, transitCueProgress } = require('../utils/narrative-transit-scene');
const { auditNarrativeIllustration, authorWithIllustrationRepair } = require('../utils/narrative-illustration-audit');
const { applianceExchangeBeat, applianceContextBeat, applianceVisualMode, applianceCueReached, applianceCriteriaMilestones, applianceExchangeLabel, applianceExchangeProgress, applianceSavingsSequence, applianceFamilyDetails, applianceSceneCoverage } = require('../utils/narrative-appliance-scene');
const { gratitudeResearchBeat, gratitudeResearchMotion } = require('../utils/narrative-research-gratitude');

test('cena de pesquisa sobre gratidão exige pesquisa, gratidão e ajuda ou colaboração', () => {
  assert.equal(gratitudeResearchBeat({ text: 'Pesquisas investigaram a gratidão e a disposição para ajudar.' }), true);
  assert.equal(gratitudeResearchBeat({ text: 'Outra pesquisa observou que agradecimentos podem estimular colaboração.' }), true);
  assert.equal(gratitudeResearchBeat({ text: 'Um estudo investigou a saúde dos motoristas.' }), false);
  assert.equal(gratitudeResearchBeat({ text: 'A gratidão pode estimular ajuda.' }), false);
  assert.equal(gratitudeResearchBeat({ text: 'Pesquisas não investigaram a gratidão e a ajuda.' }), false);
});

test('auditoria exige tempos das palavras e suporte real nas cenas específicas de geladeiras', () => {
  const title = 'Troca de geladeiras';
  const text = '750 geladeiras substituídas; até o final de outubro, serão 900 novas geladeiras.';
  const wordTimings = ['750', 'geladeiras', 'substituídas;', 'outubro,', 'serão', '900'].map((word, i) => ({ text: word, startFrame: i * 10 }));
  const sentence = { id: 's1', text, wordTimings };
  assert.equal(applianceSceneCoverage({ title, sentence }), true);
  assert.equal(applianceSceneCoverage({ title, sentence: { ...sentence, wordTimings: wordTimings.filter(word => word.text !== 'outubro,') } }), false);
  assert.equal(applianceSceneCoverage({ title, sentence: { ...sentence, text: text.replace('750', '751') } }), false);
  assert.equal(applianceSceneCoverage({ title, sentence: { ...sentence, text: `Não foram ${text}` } }), false);
  assert.equal(applianceSceneCoverage({ title, sentence: { text: 'Não serão 1600 novos eletrodomésticos entregues.', wordTimings: [{ text: '1600', startFrame: 10 }] } }), false);
  assert.equal(applianceSceneCoverage({ title: 'Outro tema', sentence }), null);
  const scene = { sentenceIds: ['s1'], objects: [], actions: [], cameraShots: [] };
  assert.deepEqual(auditNarrativeIllustration({ title, sentences: [{ ...sentence, wordTimings: [] }], scenes: [scene] }), { complete: false, missing: ['s1'] });
});

test('gestos de gratidão e ajuda esperam as palavras correspondentes e são reproduzíveis', () => {
  const sentence = { wordTimings: [{ text: 'gratidão', startFrame: 20 }, { text: 'ajudar', startFrame: 60 }] };
  assert.deepEqual(gratitudeResearchMotion(sentence, 19), { gratitude: 0, help: 0 });
  assert.deepEqual(gratitudeResearchMotion(sentence, 38), { gratitude: 1, help: 0 });
  assert.deepEqual(gratitudeResearchMotion(sentence, 78), { gratitude: 1, help: 1 });
  assert.deepEqual(gratitudeResearchMotion(sentence, 38), { gratitude: 1, help: 0 });
});

test('o destaque acompanha o início da palavra e é determinístico no retorno', () => {
  const sentence = { wordTimings: [{ text: 'passeio,', startFrame: 120 }, { text: 'filhos', startFrame: 155 }] };
  assert.equal(applianceCueReached(sentence, 119, ['passeio', 'lazer']), false);
  assert.equal(applianceCueReached(sentence, 120, ['passeio', 'lazer']), true);
  assert.equal(applianceCueReached(sentence, 119, ['passeio', 'lazer']), false);
  assert.equal(applianceCueReached({}, 999, ['250']), false);
});

test('critérios preservam as condições ditas e só ganham marcos nas palavras narradas', () => {
  const sentence = { text: 'Ser cliente da Enel, estar com as contas de energia em dia e apresentar consumo médio mensal de até 250 kWh nos últimos 12 meses.',
    wordTimings: [{ text: 'Enel,', startFrame: 10 }, { text: 'dia', startFrame: 40 }, { text: '250', startFrame: 80 }, { text: '12', startFrame: 100 }] };
  assert.deepEqual(applianceCriteriaMilestones(sentence), [
    { label: 'CLIENTE DA ENEL', icon: 'person', startFrame: 10 },
    { label: 'CONTAS EM DIA', icon: 'bill', startFrame: 40 },
    { label: 'ATÉ 250 kWh', icon: 'energy', startFrame: 80 },
    { label: 'MÉDIA DOS ÚLTIMOS 12 MESES', icon: 'calendar', startFrame: 100 }
  ]);
  const noPreviousBenefit = { text: 'O titular não tenha sido beneficiado por um programa de troca de geladeiras nos últimos dez anos.', wordTimings: [{ text: 'dez', startFrame: 55 }] };
  assert.match(applianceCriteriaMilestones(noPreviousBenefit)[0].label, /NÃO TER SIDO BENEFICIADO/);
  assert.deepEqual(applianceCriteriaMilestones({ ...sentence, wordTimings: [] }), []);
  assert.deepEqual(applianceCriteriaMilestones({ text: 'O consumo médio ultrapassa 250 kWh.', wordTimings: [{ text: '250', startFrame: 80 }] }), []);
  assert.deepEqual(applianceCriteriaMilestones({ text: 'Não é necessário ser cliente da Enel.', wordTimings: [{ text: 'Enel.', startFrame: 80 }] }), []);
});

test('rótulos de troca distinguem quantidade efetiva de previsão', () => {
  const timings = [{ text: '750', startFrame: 10 }, { text: 'substituídas;', startFrame: 15 }, { text: '900', startFrame: 30 }];
  const sentence = { text: '750 geladeiras substituídas; até o final de outubro, serão 900 novas geladeiras.', endFrame: 80, wordTimings: timings };
  assert.equal(applianceExchangeLabel(sentence, 9), '');
  assert.equal(applianceExchangeLabel(sentence, 10), '');
  assert.equal(applianceExchangeLabel(sentence, 15), '750 SUBSTITUÍDAS');
  assert.equal(applianceExchangeLabel(sentence, 30), '900 PREVISTAS ATÉ OUTUBRO');
  assert.equal(applianceExchangeProgress(sentence, 14, 24), 0);
  assert(applianceExchangeProgress(sentence, 35, 24) > 0);
  assert.equal(applianceExchangeLabel({ text: 'Serão 750 geladeiras substituídas.', wordTimings: timings }, 10), '');
  assert.equal(applianceExchangeLabel({ text: '900 geladeiras já foram substituídas.', wordTimings: timings }, 30), '');
});

test('o exemplo financeiro muda de fase nas palavras faladas e preserva a possibilidade', () => {
  const sentence = { text: 'O dinheiro da conta de energia pode ajudar nas despesas e num passeio, trazendo tranquilidade.',
    wordTimings: ['dinheiro', 'energia', 'pode', 'despesas'].map((text, index) => ({ text, startFrame: index * 5 }))
      .concat([{ text: 'passeio,', startFrame: 50 }, { text: 'tranquilidade.', startFrame: 90 }]) };
  assert.equal(applianceSavingsSequence(sentence, 49), 'budget');
  assert.equal(applianceSavingsSequence(sentence, 50), 'leisure');
  assert.equal(applianceSavingsSequence(sentence, 90), 'closing');
  assert.equal(applianceSavingsSequence({ text: 'O dinheiro paga a conta de energia.' }, 100), null);
  assert.equal(applianceSavingsSequence({ ...sentence, wordTimings: [] }, 100), null);
});

test('cena de família só usa nomes e idades literalmente presentes e temporizados', () => {
  const sentence = { text: 'Dona Maria das Mercês, de 85 anos, e o filho Getúlio Abreu, de 55 anos, foram beneficiados pela troca de geladeira.',
    wordTimings: ['Dona', 'Maria', 'das', 'Mercês,', 'de', '85', 'anos,', 'e', 'o', 'filho', 'Getúlio', 'Abreu,', 'de', '55', 'anos,', 'foram', 'beneficiados', 'pela', 'troca', 'de', 'geladeira.']
      .map((text, index) => ({ text, startFrame: index * 5 })) };
  const detail = applianceFamilyDetails(sentence);
  assert.equal(detail.first, 'Maria das Mercês');
  assert.equal(detail.firstAge, '85');
  assert.equal(detail.second, 'Getúlio Abreu');
  assert.equal(detail.secondAgeFrame, 65);
  assert.equal(applianceFamilyDetails({ ...sentence, wordTimings: [] }), null);
  assert.equal(applianceFamilyDetails({ ...sentence, text: sentence.text.replace('foram beneficiados', 'não foram beneficiados') }), null);
});

test('a cena de troca só é usada na fala que realmente trata de geladeiras e troca', () => {
  const title = 'Troca de geladeiras';
  assert.equal(applianceExchangeBeat({ title, sentence: { text: 'A substituição de geladeiras é gratuita.' } }), true);
  assert.equal(applianceExchangeBeat({ title, sentence: { text: 'A conta de energia pode diminuir.' } }), false);
  assert.equal(applianceExchangeBeat({ title: 'Uma notícia diferente', sentence: { text: 'A troca de geladeiras começou.' } }), false);
  assert.equal(applianceContextBeat({ title, sentence: { text: 'A economia de energia ajuda as famílias.' } }), 'savings');
  assert.equal(applianceContextBeat({ title, sentence: { text: 'O cliente deve apresentar documentos.' } }), 'criteria');
  assert.equal(applianceContextBeat({ title: 'Outro assunto', sentence: { text: 'A economia de energia ajuda as famílias.' } }), null);
  assert.equal(applianceVisualMode({ title, sentence: { text: 'O titular da conta não pode ter sido beneficiado por troca de geladeiras nos últimos dez anos.' } }), 'criteria');
  assert.equal(applianceVisualMode({ title, sentence: { text: 'Maria e seu filho foram beneficiados pela troca de geladeira.' } }), 'family');
  assert.equal(applianceVisualMode({ title, sentence: { text: 'Serão 1600 novos eletrodomésticos entregues.' } }), 'forecast');
});

test('movimento segue a trajetória durante a fala e reproduz o mesmo ponto após seek', () => {
  const action = { kind: 'travel', startFrame: 0, endFrame: 32,
    trajectories: { landscape: { from: { x: 0.2, y: 0.2, scale: 1 }, to: { x: 0.3, y: 0.3, scale: 1.1 } } } };
  const input = { action, sentence: { startFrame: 0, endFrame: 240 }, aspect: 'landscape', width: 1000, height: 562.5 };
  const earlier = narrativeActionMotion({ ...input, frame: 48 });
  const later = narrativeActionMotion({ ...input, frame: 120 });
  assert(later.dx > earlier.dx && later.dy > earlier.dy);
  assert.deepEqual(narrativeActionMotion({ ...input, frame: 48 }), earlier);
  assert.equal(narrativeActionMotion({ ...input, frame: 220 }).progress, 1);
});

test('cena de ônibus exige assunto correspondente e não transforma estudo em prova visual sobre motoristas', () => {
  const base = { title: 'Por que agradecer ao motorista?', episodeText: 'Em um ônibus cheio.' };
  assert.equal(transitBeat({ ...base, sentence: { text: 'Os passageiros estão no ônibus.' } }), 'journey');
  assert.equal(transitBeat({ ...base, sentence: { text: 'Ela agradece ao motorista.' } }), 'gratitude');
  assert.equal(transitBeat({ ...base, sentence: { text: 'Esses estudos não analisaram motoristas de ônibus.' } }), null);
  assert.equal(transitBeat({ ...base, sentence: { text: 'A empatia considera os sentimentos de outras pessoas.' } }), null);
  assert.equal(transitBeat({ ...base, sentence: { text: 'O motorista agradece ao passageiro.' } }), null);
  assert.equal(transitBeat({ ...base, sentence: { text: 'Ela não agradece ao motorista.' } }), null);
  assert.equal(transitBeat({ ...base, sentence: { text: 'Os passageiros saíram do ônibus.' } }), null);
  assert.equal(transitBeat({ ...base, title: 'Nova descoberta espacial', sentence: { text: 'O ônibus saiu.' } }), null);
});

test('gesto começa na palavra narrada, e não no início da frase', () => {
  const sentence = { startFrame: 0, endFrame: 120, wordTimings: [{ text: 'agradecer', startFrame: 40, endFrame: 55 }] };
  assert.equal(transitCueProgress(sentence, 30, ['agradec']), 0);
  assert(transitCueProgress(sentence, 80, ['agradec']) > 0);
  assert.equal(transitCueProgress(sentence, 120, ['agradec']), 1);
});

test('bloqueia plano cuja fala aparece só como texto e aceita desenho concreto ligado à frase', () => {
  const sentence = { id: 's1', text: 'A gentileza melhora a convivência.' };
  const scene = { sentenceIds: ['s1'], objects: [{ id: 'o1', kind: 'person', label: 'gentileza', labelType: 'literal' }],
    actions: [{ targetObjectId: 'o1', cueSentenceId: 's1' }], cameraShots: [] };
  const plan = { title: 'Convivência', sentences: [sentence], scenes: [scene] };
  assert.deepEqual(auditNarrativeIllustration(plan), { complete: false, missing: ['s1'] });
  sentence.text = 'Uma pessoa usa o celular.';
  scene.objects[0] = { id: 'o1', kind: 'device', label: 'celular', labelType: 'literal' };
  assert.deepEqual(auditNarrativeIllustration(plan), { complete: true, missing: [] });
});

test('pede reparo ao autor quando a verificação local detecta frase sem ilustração', async () => {
  const sentence = { id: 's1', text: 'Uma pessoa usa o celular.' };
  const scene = { sentenceIds: ['s1'], objects: [{ id: 'o1', kind: 'person', label: 'usa', labelType: 'literal' }],
    actions: [{ targetObjectId: 'o1', cueSentenceId: 's1' }], cameraShots: [] };
  const plan = { title: 'Aparelho', sentences: [sentence], scenes: [scene] };
  let calls = 0;
  const result = await authorWithIllustrationRepair({ options: {}, author: async options => {
    calls++;
    if (calls === 2) {
      assert.match(options.visualCritique[0].issue, /s1/);
      scene.objects[0] = { id: 'o1', kind: 'device', label: 'celular', labelType: 'literal' };
    }
    return plan;
  } });
  assert.equal(calls, 2);
  assert.equal(result, plan);
});

test('audita cada foco de câmera e usa a mesma classificação de objeto que o renderer', () => {
  const sentence = { id: 's1', text: 'A gentileza e o celular.' };
  const scene = { sentenceIds: ['s1'], objects: [
    { id: 'words', kind: 'person', label: 'gentileza', labelType: 'literal' },
    { id: 'phone', kind: 'device', label: 'celular', labelType: 'literal' }
  ], actions: [], cameraShots: [
    { cueSentenceId: 's1', focusObjectId: 'words' },
    { cueSentenceId: 's1', focusObjectId: 'phone' }
  ] };
  const plan = { title: 'Exemplo', sentences: [sentence], scenes: [scene] };
  assert.deepEqual(auditNarrativeIllustration(plan), { complete: false, missing: ['s1'] });
  scene.actions.push({ cueSentenceId: 's1', targetObjectId: 'phone' });
  assert.deepEqual(auditNarrativeIllustration(plan), { complete: true, missing: [] });
  sentence.text = 'O stick é apresentado.';
  scene.objects = [{ id: 'words', kind: 'person', label: 'stick', labelType: 'literal' }];
  scene.actions = [];
  scene.cameraShots = [{ cueSentenceId: 's1', focusObjectId: 'words' }];
  assert.deepEqual(auditNarrativeIllustration(plan), { complete: false, missing: ['s1'] });
});

test('uma relação dirigida exige ilustrações para origem e destino', () => {
  const sentence = { id: 's1', text: 'O documento segue para o computador.' };
  const scene = { sentenceIds: ['s1'], objects: [
    { id: 'source', kind: 'document', label: 'documento', labelType: 'literal' },
    { id: 'target', kind: 'person', label: 'computador', labelType: 'literal' }
  ], actions: [{ cueSentenceId: 's1', targetObjectId: 'source' }], cameraShots: [] };
  const plan = { title: 'Informação', sentences: [sentence], scenes: [scene] };
  // The shared renderer recognizes a literal computer despite the supplied kind.
  assert.deepEqual(auditNarrativeIllustration(plan), { complete: true, missing: [] });
  sentence.text = 'O documento segue para o destino.';
  scene.objects[1].label = 'destino';
  assert.deepEqual(auditNarrativeIllustration(plan), { complete: false, missing: ['s1'] });
  scene.objects.pop();
  assert.deepEqual(auditNarrativeIllustration(plan), { complete: false, missing: ['s1'] });
});

test('geladeiras recebem ilustração específica independentemente do tipo sugerido', () => {
  const sentence = { id: 's1', text: 'A troca de geladeiras antigas.' };
  const scene = { sentenceIds: ['s1'], objects: [{ id: 'o1', kind: 'token', label: 'troca de geladeiras', labelType: 'literal' }],
    actions: [{ cueSentenceId: 's1', targetObjectId: 'o1' }], cameraShots: [] };
  assert.equal(require('../utils/narrative-concept-visual').narrativeObjectVisual(scene.objects[0], sentence).kind, 'refrigerator');
  assert.deepEqual(auditNarrativeIllustration({ title: 'Troca', sentences: [sentence], scenes: [scene] }), { complete: true, missing: [] });
});
