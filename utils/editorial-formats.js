'use strict';

const crypto = require('node:crypto');

const FORMATS = Object.freeze([
  { id: 'question-payoff', name: 'Pergunta e resposta', structure: 'Abra com uma pergunta específica que a fonte responde. Entregue a resposta curta no início, desenvolva a evidência e feche retomando a pergunta.' },
  { id: 'myth-correction', name: 'Mito e correção', structure: 'Apresente uma interpretação comum somente se ela aparecer na pauta; corrija com evidência da fonte, explique a nuance e declare o que ainda não se sabe.' },
  { id: 'three-steps', name: 'Explicação em três passos', structure: 'Organize a explicação em três etapas causais ou temporais sustentadas pela fonte. Cada etapa acrescenta um fato e prepara a próxima.' },
  { id: 'documented-case', name: 'Caso documentado', structure: 'Conte o caso na ordem contexto, ação observada e consequência documentada. Não invente personagens, falas ou detalhes de cena.' },
  { id: 'visual-analogy', name: 'Analogia visual', structure: 'Explique a ideia com uma analogia visual explicitamente hipotética; se a fonte não sustentar uma analogia fiel, explique diretamente sem inventar fatos.' },
  { id: 'direct-answer', name: 'Resposta direta', structure: 'Dê a conclusão principal nos primeiros 15 segundos, depois apresente evidências, limites e implicação prática sem suspense artificial.' },
  { id: 'short-list', name: 'Lista com exemplo', structure: 'Apresente de dois a quatro pontos distintos, cada um ligado a um exemplo concreto citado na fonte; não complete a lista com conhecimento externo.' },
  { id: 'context-change-result', name: 'Contexto, mudança e resultado', structure: 'Construa o arco contexto, mudança observada, resultado e limite da evidência, mantendo cada afirmação rastreável à fonte.' }
]);

const byId = new Map(FORMATS.map(format => [format.id, format]));

function resolveEditorialFormat({ formatId, seed = '' } = {}) {
  if (formatId !== undefined && formatId !== null && formatId !== '') {
    const explicit = byId.get(String(formatId));
    if (!explicit) throw new TypeError('formatId editorial inválido');
    return explicit;
  }
  const hash = crypto.createHash('sha256').update(String(seed)).digest();
  return FORMATS[hash.readUInt32BE(0) % FORMATS.length];
}

function editorialFormatPrompt(formatId) {
  const format = byId.get(String(formatId));
  if (!format) throw new TypeError('formatId editorial inválido');
  return `FORMATO EDITORIAL ${format.id} — ${format.name}: ${format.structure} Preserve rigorosamente todos os limites factuais e a revisão independente.`;
}

module.exports = { FORMATS, resolveEditorialFormat, editorialFormatPrompt };
