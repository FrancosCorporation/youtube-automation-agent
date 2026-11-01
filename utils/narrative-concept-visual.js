'use strict';

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Select an explanatory drawing from the named object, never inventing a
// measurement. A numeric display is allowed only when the active sentence
// actually contains the percentage being shown.
function narrativeConceptVisual({ label, kind, sentence }) {
  const named = normalize(label);
  const text = String(sentence || '');
  const context = normalize(text);
  const labelInSentence = named.length > 1 && normalize(text).includes(named);
  const percentages = [...text.matchAll(/\b(\d{1,3}(?:[.,]\d+)?)\s*%/g)]
    .map(match => ({ label: `${match[1]}%`, value: Number(match[1].replace(',', '.')) }))
    .filter(item => Number.isFinite(item.value) && item.value >= 0 && item.value <= 100);
  if (labelInSentence && ['chart', 'number'].includes(kind) && percentages.length === 1) return { kind: 'percentage', values: percentages };
  if ((named.match(/\b(?:19|20)\d{2}\b/g) || []).length === 2
    && labelInSentence && percentages.length === 2 && /\b(?:entre|para|de)\b/i.test(text)) {
    return { kind: 'percentage_comparison', values: percentages };
  }
  if (kind === 'number' && labelInSentence) {
    const number = String(label || '').match(/\b\d+(?:[.,]\d+)?\b/)?.[0];
    if (number) return { kind: 'number_text', values: [{ label: number, value: Number(number.replace(',', '.')) }] };
  }
  if (/\b(?:geladeira|geladeiras|refrigerador|refrigeradores)\b/.test(named)) return { kind: 'refrigerator', values: [] };
  if (/\bsubstituicao\b/.test(named) && /\bgeladeiras?\b/.test(context)) return { kind: 'refrigerator', values: [] };
  if (/\bconta(?:s)? de (?:energia|luz)\b/.test(named)) return { kind: 'energy_bill', values: [] };
  if (/\b(?:dinheiro|orcamento|despesas?)\b/.test(named)
    || (/\beconomia\b/.test(named) && /\b(?:energia|familias|conta de luz|orcamento)\b/.test(context))) return { kind: 'wallet', values: [] };
  if (kind === 'person' && labelInSentence && (context.includes(`dona ${named}`)
    || context.includes(`filho ${named}`) || context.includes(`filha ${named}`))) return { kind: 'person', values: [] };
  if (labelInSentence && /\b(?:dez|10) anos\b/.test(named)) return { kind: 'calendar', values: [] };
  // In biological phrases "celular" is an adjective, not a phone.
  const cellularBiology = /\b(?:atividade|respiracao|metabolismo|biologia|tecido|crescimento|divisao|saude|hipoxia|morte) celular\b/;
  if (cellularBiology.test(named) || (named === 'celular' && cellularBiology.test(context))) return { kind: 'cell', values: [] };
  if (/\b(?:celular|telefone)\b/.test(named)) return { kind: 'device', values: [] };
  if (/\b(?:cancer|tumor)\b.*\bpulmao\b|\bpulmao\b.*\b(?:cancer|tumor)\b/.test(named)) return { kind: 'lung_cancer', values: [] };
  if (/\b(?:crescimento|proliferacao) tumoral\b/.test(named)) return { kind: 'tumor_growth', values: [] };
  if (/\bestresse oxidativo\b/.test(named)) return { kind: 'oxidative_stress', values: [] };
  if (/\bcpap\b/.test(named)) return { kind: 'cpap', values: [] };
  if (/\brecuperacao\b/.test(named) && /\b(?:oxigenio|oxigenacao)\b/.test(context)) return { kind: 'oxygen_recovery', values: [] };
  if (/\bhipoxia\b|\bbaixo nivel de oxigenio\b/.test(named)) return { kind: 'low_oxygen', values: [] };
  if (/vias? aereas?|apneia|respiracao/.test(named)) return { kind: 'airway', values: [] };
  if (/ritmo circadiano|relogio biologico/.test(named)) return { kind: 'body_clock', values: [] };
  if (/residuos metabolicos|atividade cerebral|cerebro/.test(named)) return { kind: 'brain', values: [] };
  if (/polissonografia/.test(named)) return { kind: 'sleep_study', values: [] };
  if (/temperatura/.test(named)) return { kind: 'temperature', values: [] };
  if (/luz natural|exposicao a luz/.test(named)) return { kind: 'light', values: [] };
  if (/qualidade do sono|higiene do sono|habitos de sono|fases do sono/.test(named)) return { kind: 'sleep', values: [] };
  const familyContext = /\b(?:crianca|criancas|infancia|infantil|filho|filhos|pais|irmaos|parentificacao)\b/.test(`${named} ${context}`);
  if (/parentificacao/.test(named) || (/inversao de papeis/.test(named) && familyContext)) return { kind: 'role_reversal', values: [] };
  if (/apoio emocional/.test(named) && familyContext) return { kind: 'emotional_support', values: [] };
  if (/irmaos mais novos/.test(named)) return { kind: 'siblings', values: [] };
  if (/criancas sao forcadas/.test(named) || (/carga constante/.test(named) && familyContext)) return { kind: 'child_burden', values: [] };
  if (/desenvolvimento|processo saudavel/.test(named) && familyContext) return { kind: 'child_growth', values: [] };
  if (/terapia familiar/.test(named)) return { kind: 'family', values: [] };
  if (/\b(?:entrevista|entrevistas)\b/.test(named)) return { kind: 'interview', values: [] };
  if (/\b(?:jardinagem|jardineiro|jardineira|rocada|jardim)\b/.test(named)) return { kind: 'gardening', values: [] };
  if (/\bvale[- ]alimentacao\b/.test(named)) return { kind: 'food_benefit', values: [] };
  if (/\b(?:assiduidade|frequencia ao trabalho)\b/.test(named)) return { kind: 'attendance', values: [] };
  if (/\b(?:segunda|terca|quarta|quinta|sexta)[- ]feira\b|\b(?:calendario|data da entrevista)\b/.test(named)) return { kind: 'calendar', values: [] };
  if (/\b(?:jornada|horario de trabalho|carga horaria)\b/.test(named)) return { kind: 'body_clock', values: [] };
  if (/\b(?:rg|cpf|carteira de identidade)\b/.test(named)) return { kind: 'document', values: [] };
  if (/\b(?:ajudante|operador|operadora|candidato|candidata|candidatos)\b/.test(named)) return { kind: 'person', values: [] };
  if ((/\b(?:grupo|secretaria)\b/.test(named) && /\b(?:vagas|emprego|seletivo|contratacao|empregador)\b/.test(context))) return { kind: 'building', values: [] };
  if (/\b(?:site|pagina|portal)\b|\b[a-z0-9-]+(?:\.[a-z0-9-]+){1,3}\b/.test(named)) return { kind: 'webpage', values: [] };
  if (/\bsono\b|\bdormir\b/.test(named)) return { kind: 'sleep', values: [] };
  if (/\b(?:fome|apetite)\b/.test(named)) return { kind: 'appetite', values: [] };
  if (/\b(?:obesidade|excesso de peso)\b/.test(named)) return { kind: 'body_weight', values: [] };
  // The model's generic object kind is not evidence that a symbol depicts
  // its label. Keep only categories supported by the actual label; otherwise
  // use the literal words rather than silently drawing an unrelated object.
  const supported = {
    person: /\b(?:pessoa|pessoas|populacao|cliente|clientes|crianca|criancas|jovem|adulto|adultos|irmao|irmaos|pais|familia|familias|medico|medica|psicologo|psicologa|psiquiatra|policia|cientista|cientistas|pesquisador|pesquisadores|professor|paciente)\b/,
    document: /\b(?:documento|documentos|laudo|exame|exames|relatorio|artigo|estudo|lei|contrato|papel|livro|boletim)\b/,
    device: /\b(?:computador|notebook|smartphone|tablet|aparelho|televisao|camera)\b/,
    vehicle: /\b(?:carro|carros|veiculo|veiculos|caminhao|onibus|aviao|bicicleta)\b/,
    building: /\b(?:casa|casas|imovel|predio|edificio|hospital|escola|instituto|empresa|edificacao)\b/,
    nature: /\b(?:arvore|arvores|planta|plantas|floresta|vegetacao|natureza)\b/,
    cell: /\b(?:celula|celulas|bacteria|bacterias)\b/,
    network: /\b(?:rede|redes|internet|conexao|conexoes)\b/,
    map: /\b(?:mapa|mapas|trajeto|trajetos|rota|rotas|caminho|caminhos)\b/,
    product: /\b(?:produto|produtos|embalagem|caixa)\b/
  };
  if (supported[kind]?.test(named)) return { kind, values: [] };
  return { kind: 'concept_text', values: [] };
}

// Keep the audit and renderer on the same mapping, including the special
// drawings supported by the narrative episode renderer.
function narrativeObjectVisual(object, sentence) {
  const label = normalize(object?.label);
  const context = normalize(sentence?.text);
  if (object?.labelType === 'literal' && label === 'algo estragado' && /\balgo estragado\b/.test(context)) {
    return { kind: /\bdescartar\s+algo\s+estragado\b/.test(context) ? 'discard-spoiled' : 'spoiled-item', values: [] };
  }
  if (object?.labelType === 'literal' && label === 'lembranca da escassez' && /\blembranca da escassez\b/.test(context)) return { kind: 'memory-scarcity', values: [] };
  if (object?.labelType === 'literal' && /^(?:familia|familias)$/.test(label) && /\bfamilias?\b/.test(context)) {
    if (/\bfamilias?\s+de\s+(?:modelos?|linguagens?|produtos?|algoritmos?|sistemas?|dispositivos?|cores|elementos?)\b/.test(context)) return { kind: 'concept_text', values: [] };
    return { kind: 'family', values: [] };
  }
  const foodContext = /\b(?:comida|alimentos?|cozinh\w*|refeic\w*|armazenad\w*|porc(?:ao|oes))\b/.test(context);
  if (object?.labelType === 'literal' && (/\b(?:comida|alimentos?)\b/.test(label) || /\bsobras?\b/.test(label) && foodContext)) {
    return { kind: /\barmazenad\w*\b/.test(context) && /\bsobras?\b/.test(label) ? 'food-storage' : 'food', values: [] };
  }
  if (object?.labelType === 'literal' && /\b(?:pote|potes)\b/.test(label)) return { kind: 'empty-containers', values: [] };
  if (object?.labelType === 'literal' && /\b(?:receita|receitas)\b/.test(label)
    && /\b(?:comida|alimentos?|cozinh\w*|refeic\w*|sobras?|porc(?:ao|oes))\b/.test(context)) return { kind: 'recipe-book', values: [] };
  if (object?.labelType === 'literal' && /\b(?:compra|compras)\b/.test(label)) return { kind: 'shopping-bag', values: [] };
  if (object?.labelType === 'literal' && /\b(?:porcao|porcoes)\b/.test(label)) return { kind: 'food', values: [] };
  if (object?.labelType === 'literal' && /\bplaneta\b/.test(label)) return { kind: 'planet', values: [] };
  if (object?.labelType === 'literal' && /\bbolso\b/.test(label)) return { kind: 'wallet', values: [] };
  if (object?.labelType === 'literal' && /\b(?:sofrimento|angustia)\b/.test(label)) return { kind: 'anxiety', values: [] };
  if (object?.labelType === 'literal' && label === 'escassez' && /\bescassez\b/.test(context)) return { kind: 'scarcity', values: [] };
  if (object?.labelType === 'literal' && label === 'ansiedade' && /\bansiedade\b/.test(context)) return { kind: 'anxiety', values: [] };
  if (object?.labelType === 'literal' && label === 'escolha' && /\bescolha\b/.test(context)) return { kind: 'choice', values: [] };
  if (object?.labelType === 'literal' && label === 'unidade de saude' && /\bunidade de saude\b/.test(context)) return { kind: 'healthcare-facility', values: [] };
  if (object?.labelType === 'literal' && /\b(?:algo|alguma coisa)\s+vai\s+para\s+o\s+lixo\b/.test(context)) {
    if (/^(?:algo|alguma coisa)$/.test(label)) return { kind: 'discarded-item', values: [] };
    if (label === 'lixo') return { kind: 'waste-bin', values: [] };
  }
  if (object?.labelType === 'literal' && /\broteadores?\b/.test(label)) return { kind: 'router', values: [] };
  if (object?.labelType === 'literal' && /\b(?:computador(?:es)?|notebooks?)\b/.test(label)) return { kind: 'computer', values: [] };
  if (object?.labelType === 'literal' && object.kind === 'product' && /\bsticks?\b/.test(label)) return { kind: 'sachet', values: [] };
  if (object?.labelType === 'literal' && object.kind === 'product' && /\b(?:vitaminas?|minerais|ingredientes?)\b/.test(label)) return { kind: 'ingredients', values: [] };
  if (object?.labelType === 'literal' && /\bpacotes?\b/.test(label) && /\b(?:dados|internet|rede|mensagem|roteadores?)\b/.test(context)) return { kind: 'data-packet', values: [] };
  return narrativeConceptVisual({ label: object?.label, kind: object?.kind, sentence: sentence?.text });
}

module.exports = { narrativeConceptVisual, narrativeObjectVisual };
