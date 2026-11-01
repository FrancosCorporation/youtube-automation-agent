'use strict';

// Shared by the author and the renderer. This is a choreography contract, not
// a topic template: nouns choose props, verbs choose interactions, word cues
// determine when the interaction starts. Unsupported language stays explicit.
const fold = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const PROPS = [
  ['computer', 'device', /\b(?:computador\w*|notebook\w*|laptop\w*|pc)\b/],
  ['phone', 'device', /\b(?:celular\w*|smartphone\w*|telefone\w*)\b/],
  ['server', 'network', /\b(?:servidor\w*|data center)\b/],
  ['envelope', 'document', /\b(?:e-mail\w*|email\w*|mensage\w*|carta\w*)\b/],
  ['fridge', 'product', /\b(?:geladeira\w*|refrigerador\w*)\b/],
  ['document', 'document', /\b(?:artigo\w*|revista\w*|materia\w*|noticia\w*|relatorio\w*|documento\w*|conta\w*|boleto\w*)\b/],
  ['parcel', 'product', /\b(?:encomenda\w*|caixa\w*|pacote\w*|produto\w*)\b/],
  ['wallet', 'product', /\b(?:carteira\w*|dinheiro|pagamento\w*|orcamento\w*)\b/],
  ['building', 'building', /\b(?:casa\w*|loja\w*|escola\w*|hospital\w*|edificio\w*)\b/],
  ['person', 'person', /\b(?:pessoa\w*|usuario\w*|funcionario\w*|programador\w*|pesquisador\w*|cliente\w*|aluno\w*|familia\w*)\b/],
];

function narrativeEntities(text) {
  const normalized = fold(text);
  return PROPS.flatMap(([visual, kind, expression]) => {
    const match = normalized.match(expression);
    // Accent folding preserves indices for Portuguese. Labels remain verbatim.
    return match ? [{ visual, kind, label: String(text).slice(match.index, match.index + match[0].length), index: match.index }] : [];
  }).sort((a, b) => a.index - b.index);
}

function cueFrame(sentence, expression) {
  const match = (sentence.wordTimings || []).find(word => expression.test(fold(word.text)));
  if (match && Number.isFinite(match.startFrame)) return match.startFrame;
  // No invented alignment: without word timestamps use the sentence boundary.
  return sentence.startFrame;
}

function directNarrativeBeat({ sentence, source, previousSentence, fps = 24 }) {
  const text = fold(sentence.text);
  const entities = narrativeEntities(sentence.text);
  const previous = narrativeEntities(previousSentence?.text || '');
  const devices = entities.filter(e => ['computer', 'phone', 'server'].includes(e.visual));
  const transfer = /\b(?:envi\w*|receb\w*|cheg\w*|entreg\w*|transport\w*)\b/;
  const operate = /\b(?:digit\w*|escrev\w*|acess\w*|invad\w*|hack\w*|atac\w*|oper\w*)\b/;
  const exchange = /\b(?:troc\w*|substitu\w*)\b/;
  const uncertain = /\b(?:nao|nunca|sem|talvez|poderia|tent\w*|supost\w*)\b/.test(text);
  const conditional = /\b(?:imagine|exemplo|simulacao|hipotet\w*|se alguem)\b/.test(text);
  const base = { version: 1, cueSentenceId: sentence.id, startFrame: sentence.startFrame,
    endFrame: sentence.endFrame, entities, conditional, resultAffirmed: !uncertain };
  const operation = (kind, verb, extra = {}) => {
    const actionFrame = Math.min(sentence.endFrame - 1, cueFrame(sentence, verb));
    const resultFrame = Math.min(sentence.endFrame - 1, actionFrame + Math.round(fps * 1.8));
    return { ...base, kind, actionFrame, resultFrame, ...extra };
  };
  if (/\b(?:artigo|revista|materia|noticia|reportagem|publicacao)\b/.test(text)
    && source?.eligible === true && source.sourceTitle && source.sourceUrl) {
    return operation('publication', /\b(?:artigo|revista|materia|noticia|reportagem)\b/);
  }
  const payload = entities.find(e => ['envelope', 'parcel', 'wallet', 'document'].includes(e.visual));
  if (transfer.test(text) && payload && !uncertain) {
    const electronic = payload.visual === 'envelope' && /e-mail|email|mensage/.test(fold(payload.label));
    const contextDevice = electronic ? [...devices, ...previous.filter(e => ['computer', 'phone', 'server'].includes(e.visual))][0] : null;
    const origin = contextDevice || { visual: electronic ? 'computer' : 'person', label: '', kind: electronic ? 'device' : 'person' };
    const destination = devices[1] || (electronic ? { visual: contextDevice?.visual || 'computer', label: '', kind: 'device' }
      : entities.find(e => e.visual === 'building') || { visual: 'person', label: '', kind: 'person' });
    return operation('transfer', transfer, { subject: payload, origin, destination });
  }
  if (operate.test(text) && devices.length) {
    return operation('operate', operate, { subject: devices[0], intrusion: /invad|hack|atac/.test(text) });
  }
  const physical = entities.find(e => ['fridge', 'phone', 'computer', 'parcel'].includes(e.visual));
  if (exchange.test(text) && physical && !uncertain) return operation('exchange', exchange, { subject: physical });
  if (/\b(?:compar\w*|versus|diferenca\w*|enquanto)\b/.test(text) && entities.length >= 2) {
    return operation('compare', /\b(?:compar\w*|versus|diferenca\w*|enquanto)\b/);
  }
  // Do not replace specialist diagrams with a concrete noun that happens to be
  // mentioned. Only a single supported subject gets this conservative closeup.
  if (entities.length === 1 && !uncertain) return operation('inspect', /\b(?:mostr\w*|observ\w*|veja|exib\w*)\b/, { subject: entities[0] });
  return null;
}

function fallbackActionKind(text) {
  const value = fold(text);
  if (/\b(?:nao|nunca|sem|talvez|poderia)\b/.test(value)) return 'reveal-part';
  if (/\b(?:compar\w*|versus|diferenca\w*)\b/.test(value)) return 'compare';
  if (/\b(?:transform\w*|convert\w*|substitu\w*|divid\w*)\b/.test(value)) return 'transform';
  if (/\b(?:envi\w*|cheg\w*|receb\w*|percor\w*|transport\w*)\b/.test(value)) return 'travel';
  return 'reveal-part';
}

module.exports = { directNarrativeBeat, narrativeEntities, fallbackActionKind };
