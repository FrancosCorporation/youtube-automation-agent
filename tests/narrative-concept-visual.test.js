'use strict';

const { narrativeObjectVisual } = require('../utils/narrative-concept-visual');

require('node:test')('objetos financeiros e pessoas citadas recebem desenhos ancorados ao texto', () => {
  const assert = require('node:assert/strict');
  const visual = (label, kind, text) => narrativeObjectVisual({ label, kind, labelType: 'literal' }, { text }).kind;
  assert.equal(visual('conta de energia', 'document', 'A conta de energia pesa no orçamento.'), 'energy_bill');
  assert.equal(visual('economia', 'product', 'A economia na conta de energia ajuda as famílias.'), 'wallet');
  assert.equal(visual('Maria das Mercês', 'person', 'Dona Maria das Mercês recebeu uma geladeira.'), 'person');
  assert.equal(visual('economia', 'product', 'A economia global cresceu.'), 'concept_text');
  assert.equal(visual('João Silva', 'person', 'A empresa informou resultados.'), 'concept_text');
  assert.equal(visual('dez anos', 'document', 'O limite é de dez anos.'), 'calendar');
  assert.equal(visual('substituição', 'device', 'A substituição de geladeiras é gratuita.'), 'refrigerator');
  assert.equal(visual('substituição', 'device', 'A substituição de funcionários aconteceu.'), 'concept_text');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { narrativeConceptVisual } = require('../utils/narrative-concept-visual');

test('objetos de sono, vias aéreas e cérebro têm desenhos distintos', () => {
  const kinds = ['qualidade do sono', 'vias aéreas', 'resíduos metabólicos', 'ritmo circadiano', 'polissonografia']
    .map(label => narrativeConceptVisual({ label, kind: 'step', sentence: '' }).kind);
  assert.deepEqual(kinds, ['sleep', 'airway', 'brain', 'body_clock', 'sleep_study']);
  assert.equal(narrativeConceptVisual({ label: 'câncer de pulmão', kind: 'cell', sentence: 'câncer de pulmão' }).kind, 'lung_cancer');
  assert.equal(narrativeConceptVisual({ label: 'hipóxia', kind: 'step', sentence: 'hipóxia' }).kind, 'low_oxygen');
  assert.equal(narrativeConceptVisual({ label: 'crescimento tumoral', kind: 'cell', sentence: 'crescimento tumoral' }).kind, 'tumor_growth');
  assert.equal(narrativeConceptVisual({ label: 'estresse oxidativo', kind: 'document', sentence: 'estresse oxidativo' }).kind, 'oxidative_stress');
  assert.equal(narrativeConceptVisual({ label: 'CPAP, alguns', kind: 'device', sentence: 'CPAP, alguns estudos' }).kind, 'cpap');
  assert.equal(narrativeConceptVisual({ label: 'recuperação', kind: 'cell', sentence: 'queda e recuperação dos níveis de oxigênio' }).kind, 'oxygen_recovery');
  assert.equal(narrativeConceptVisual({ label: 'recuperação', kind: 'cell', sentence: 'recuperação do mercado' }).kind, 'concept_text');
});

test('conceitos da pauta sobre infância usam representações ligadas à fala', () => {
  const labels = ['Inversão de papéis', 'apoio emocional', 'irmãos mais novos', 'carga constante', 'processo saudável', 'terapia familiar'];
  const kinds = labels.map(label => narrativeConceptVisual({ label, kind: 'step', sentence: `Na infância, ${label} envolve crianças.` }).kind);
  assert.deepEqual(kinds, ['role_reversal', 'emotional_support', 'siblings', 'child_burden', 'child_growth', 'family']);
  assert.equal(narrativeConceptVisual({ label: 'parentificação', kind: 'step', sentence: 'parentificação' }).kind, 'role_reversal');
  assert.equal(narrativeConceptVisual({ label: 'apoio emocional', kind: 'step', sentence: 'O apoio emocional entre colegas é importante.' }).kind, 'concept_text');
  assert.equal(narrativeConceptVisual({ label: 'desenvolvimento', kind: 'step', sentence: 'O desenvolvimento do software continua.' }).kind, 'concept_text');
});

test('celular é representado como aparelho, mesmo que o modelo escolha cell', () => {
  assert.equal(narrativeConceptVisual({ label: 'Celular e documentos', kind: 'cell', sentence: 'Celular e documentos não foram localizados.' }).kind, 'device');
  assert.equal(narrativeConceptVisual({ label: 'metabolismo celular', kind: 'device', sentence: 'O metabolismo celular foi estudado.' }).kind, 'cell');
  assert.equal(narrativeConceptVisual({ label: 'celular', kind: 'device', sentence: 'A hipóxia celular foi estudada.' }).kind, 'cell');
});

test('o tipo escolhido pelo modelo não cria figuras incompatíveis com o termo narrado', () => {
  assert.equal(narrativeConceptVisual({ label: 'estado de decomposição', kind: 'nature', sentence: 'estado de decomposição' }).kind, 'concept_text');
  assert.equal(narrativeConceptVisual({ label: 'apoio financeiro', kind: 'step', sentence: 'apoio financeiro' }).kind, 'concept_text');
  assert.equal(narrativeConceptVisual({ label: 'fossa no quintal', kind: 'building', sentence: 'fossa no quintal' }).kind, 'concept_text');
  assert.equal(narrativeConceptVisual({ label: 'carro vermelho', kind: 'vehicle', sentence: 'carro vermelho' }).kind, 'vehicle');
  assert.equal(narrativeConceptVisual({ label: 'obesidade', kind: 'step', sentence: 'obesidade' }).kind, 'body_weight');
  assert.equal(narrativeConceptVisual({ label: 'apetite', kind: 'step', sentence: 'apetite' }).kind, 'appetite');
  assert.equal(narrativeConceptVisual({ label: 'dados', kind: 'chart', sentence: 'os dados foram analisados' }).kind, 'concept_text');
});

test('trechos de uma seleção de emprego escolhem figuras relacionadas ao que foi dito', () => {
  const sentence = 'As entrevistas para vagas de ajudante de jardinagem serão na próxima quarta-feira; leve RG, CPF e consulte o portal.';
  const labels = ['entrevistas', 'ajudante de jardinagem', 'próxima quarta-feira', 'RG, CPF', 'portal'];
  const kinds = labels.map(label => narrativeConceptVisual({ label, kind: 'step', sentence }).kind);
  assert.deepEqual(kinds, ['interview', 'gardening', 'calendar', 'document', 'webpage']);
  assert.equal(narrativeConceptVisual({ label: 'vale-alimentação', kind: 'document', sentence: 'Receberá vale-alimentação.' }).kind, 'food_benefit');
  assert.equal(narrativeConceptVisual({ label: 'Grupo Provac', kind: 'building', sentence: 'O Grupo Provac oferece vagas.' }).kind, 'building');
  assert.equal(narrativeConceptVisual({ label: 'Grupo Provac', kind: 'building', sentence: 'O Grupo Provac se apresentou no festival.' }).kind, 'concept_text');
});

test('percentual vem da fala atual e nunca é aplicado a outro objeto ou inventado', () => {
  const sentence = 'Em 2024, 62,6% dos adultos apresentavam excesso de peso.';
  assert.deepEqual(narrativeConceptVisual({ label: 'excesso de peso', kind: 'chart', sentence }),
    { kind: 'percentage', values: [{ label: '62,6%', value: 62.6 }] });
  assert.notEqual(narrativeConceptVisual({ label: 'obesidade', kind: 'chart', sentence }).kind, 'percentage');
  assert.notEqual(narrativeConceptVisual({ label: 'excesso de peso', kind: 'chart', sentence: 'Não há percentual nesta frase.' }).kind, 'percentage');
  assert.notEqual(narrativeConceptVisual({ label: 'excesso de peso', kind: 'chart', sentence: '150% de excesso de peso' }).kind, 'percentage');
});

test('comparação mostra os dois valores explícitos sem criar série', () => {
  const result = narrativeConceptVisual({ label: '2006 e 2024', kind: 'step',
    sentence: 'Entre 2006 e 2024 passou de 11,8% para 25,7%.' });
  assert.deepEqual(result, { kind: 'percentage_comparison', values: [
    { label: '11,8%', value: 11.8 }, { label: '25,7%', value: 25.7 }
  ] });
});

test('um número literal é apresentado como número, não como gráfico inventado', () => {
  assert.deepEqual(narrativeConceptVisual({ label: '200 comorbidades', kind: 'number',
    sentence: 'O excesso de peso está associado a cerca de 200 comorbidades.' }),
  { kind: 'number_text', values: [{ label: '200', value: 200 }] });
});
