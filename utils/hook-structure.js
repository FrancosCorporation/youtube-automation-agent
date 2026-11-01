'use strict';

const { createHash } = require('node:crypto');

const MIN_HOOK_WORDS = 7;
const MAX_HOOK_WORDS = 12;

const STRUCTURES = [
  {
    id: 'pergunta-respondida',
    guidance: 'Abra com uma pergunta específica que o próprio vídeo responde, sem insinuar uma resposta que a fonte não sustenta.'
  },
  {
    id: 'contraste-verificado',
    guidance: 'Abra com um contraste entre uma expectativa comum e um fato confirmado pela fonte; use esta forma apenas se o contraste estiver realmente comprovado.'
  },
  {
    id: 'consequencia-cotidiana',
    guidance: 'Abra com uma consequência prática e delimitada para uma situação cotidiana, sem transformar possibilidade em certeza.'
  },
  {
    id: 'evidencia-e-limite',
    guidance: 'Abra destacando o que a evidência permite afirmar e deixe claro, dentro do vídeo, o limite do que ainda não se sabe.'
  },
  {
    id: 'mecanismo-explicado',
    guidance: 'Abra com a pergunta de como ou por que o fenômeno acontece e prometa somente a explicação que o conteúdo consegue entregar.'
  }
];

function selectHookStructure(topic) {
  const normalized = String(topic || '').trim().toLocaleLowerCase('pt-BR');
  const digest = createHash('sha256').update(normalized || 'pulso').digest();
  return STRUCTURES[digest.readUInt32BE(0) % STRUCTURES.length];
}

function hookStructureGuidance(topic) {
  const structure = selectHookStructure(topic);
  return `ESTRUTURA DE GANCHO DESTA PAUTA (${structure.id}): ${structure.guidance} Mantenha 7–12 palavras, varie a construção entre pautas e não acrescente números, causas, resultados, falas ou certezas ausentes da fonte.`;
}

function countHookWords(hook) {
  return String(hook || '').trim().split(/\s+/).filter(token => /[\p{L}\p{N}]/u.test(token)).length;
}

function isHookWordCountValid(count) {
  return Number.isSafeInteger(count) && count >= MIN_HOOK_WORDS && count <= MAX_HOOK_WORDS;
}

module.exports = {
  MAX_HOOK_WORDS,
  MIN_HOOK_WORDS,
  STRUCTURES,
  countHookWords,
  hookStructureGuidance,
  isHookWordCountValid,
  selectHookStructure
};
