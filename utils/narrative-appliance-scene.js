'use strict';

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// This scene illustrates the exchange itself, not eligibility or savings.
function applianceExchangeBeat({ title, sentence }) {
  const subject = normalize(title);
  const text = normalize(sentence?.text);
  return /\bgeladeiras?\b/.test(subject) && /\bgeladeiras?\b/.test(text)
    && /\b(?:substituicao|substituid[ao]s?|troca|trocad[ao]s?)\b/.test(text);
}

function applianceContextBeat({ title, sentence }) {
  if (!/\bgeladeiras?\b/.test(normalize(title))) return null;
  const text = normalize(sentence?.text);
  if (/\b(?:filho|filha)\b/.test(text) && /\bbeneficiad[ao]s?\b/.test(text) && /\bgeladeiras?\b/.test(text)) return 'family';
  if (/\b1600\b/.test(text) && /\b(?:serao|previst[oa]s?)\b/.test(text) && /\beletrodomesticos\b/.test(text)) return 'forecast';
  if (/\b(?:economia|dinheiro)\b/.test(text) && /\b(?:energia|familias|orcamento|conta)\b/.test(text)) return 'savings';
  if (/\b(?:cliente|consumo|conta|titular|documentos|unidade antiga)\b/.test(text)
    && /\b(?:enel|kwh|geladeiras?|energia|documentos|dez anos)\b/.test(text)) return 'criteria';
  return null;
}

function applianceVisualMode(input) {
  return applianceContextBeat(input) || (applianceExchangeBeat(input) ? 'exchange' : null);
}

function applianceCueReached(sentence, frame, prefixes) {
  const cue = (Array.isArray(sentence?.wordTimings) ? sentence.wordTimings : [])
    .find(word => prefixes.some(prefix => normalize(word.text).startsWith(prefix)));
  return Boolean(cue && Number.isFinite(cue.startFrame) && frame >= cue.startFrame);
}

function applianceExchangeLabel(sentence, frame) {
  const text = normalize(sentence?.text);
  const forecast900 = /\b(?:serao|previst[oa]s?)\s+900\b/.test(text) && /\boutubro\b/.test(text);
  if (forecast900 && applianceCueReached(sentence, frame, ['900'])) return '900 PREVISTAS ATÉ OUTUBRO';
  const replaced750 = /\b750\s+geladeiras\s+substituidas\b/.test(text)
    && !/\b(?:serao|sera|previst\w*|esperad\w*|nao)\b[^.!?]{0,45}\b750\s+geladeiras\s+substituidas\b/.test(text);
  return replaced750 && applianceCueReached(sentence, frame, ['750']) && applianceCueReached(sentence, frame, ['substituid']) ? '750 SUBSTITUÍDAS' : '';
}

function applianceExchangeProgress(sentence, frame, fps) {
  const cue = (Array.isArray(sentence?.wordTimings) ? sentence.wordTimings : [])
    .find(word => /^(?:substitu|troca)/.test(normalize(word.text)) && Number.isFinite(word.startFrame));
  if (!cue || !Number.isFinite(fps) || fps <= 0) return 0;
  const duration = Math.max(1, Math.min(Math.round(fps * 1.8), sentence.endFrame - cue.startFrame));
  const p = Math.max(0, Math.min(1, (frame - cue.startFrame) / duration));
  return p * p * (3 - 2 * p);
}

function applianceSavingsSequence(sentence, frame) {
  const text = normalize(sentence?.text);
  if (/\b(?:nao|nunca)\b/.test(text)) return null;
  const words = Array.isArray(sentence?.wordTimings) ? sentence.wordTimings : [];
  const has = prefix => words.some(word => normalize(word.text).startsWith(prefix) && Number.isFinite(word.startFrame));
  if (/\beconomia\b/.test(text) && /\bequipamento\b/.test(text) && /\beficiente\b/.test(text) && /\bfamilias\b/.test(text)) {
    return ['economia', 'equipamento', 'eficiente', 'pode', 'familias'].every(has) ? 'efficiency' : null;
  }
  if (!/\bdinheiro\b/.test(text) || !/\bconta de energia\b/.test(text) || !/\bpode\b/.test(text)
    || !/\bdespesas\b/.test(text) || !/\bpasseio\b/.test(text) || !/\btranquilidade\b/.test(text)
    || !['dinheiro', 'energia', 'pode', 'despesas', 'passeio', 'tranquilidade'].every(has)) return null;
  if (applianceCueReached(sentence, frame, ['tranquilidade', 'fechar'])) return 'closing';
  if (applianceCueReached(sentence, frame, ['passeio', 'lazer', 'filhos'])) return 'leisure';
  return 'budget';
}

function applianceFamilyDetails(sentence) {
  const text = String(sentence?.text || '');
  const match = text.match(/\bDona\s+([^,]{3,45}),\s+de\s+(\d{1,3})\s+anos,\s+e\s+o\s+filho\s+([^,]{3,45}),\s+de\s+(\d{1,3})\s+anos,\s+foram\s+beneficiados\s+pela\s+troca\s+de\s+geladeira\b/iu);
  if (!match) return null;
  const { narrativeLabelCueFrame } = require('./narrative-word-cue');
  const first = match[1].trim(), second = match[3].trim();
  const firstFrame = narrativeLabelCueFrame(first, sentence), firstAgeFrame = narrativeLabelCueFrame(match[2], sentence);
  const secondFrame = narrativeLabelCueFrame(second, sentence), secondAgeFrame = narrativeLabelCueFrame(match[4], sentence);
  const benefitFrame = narrativeLabelCueFrame('beneficiados', sentence), exchangeFrame = narrativeLabelCueFrame('troca', sentence);
  if ([firstFrame, firstAgeFrame, secondFrame, secondAgeFrame, benefitFrame, exchangeFrame].some(frame => frame === null)) return null;
  return { first, firstAge: match[2], second, secondAge: match[4], firstFrame, firstAgeFrame, secondFrame, secondAgeFrame, benefitFrame, exchangeFrame };
}

// The appliance-specific renderer has its own staging. Check that it can
// time the spoken facts, rather than relying on an unrelated generic object.
function applianceSceneCoverage({ title, sentence }) {
  const mode = applianceVisualMode({ title, sentence });
  if (!mode) return null;
  const text = normalize(sentence?.text);
  const heard = (...prefixes) => applianceCueReached(sentence, Number.POSITIVE_INFINITY, prefixes);
  if (mode === 'savings') return Boolean(applianceSavingsSequence(sentence, sentence.startFrame || 0));
  if (mode === 'family') return Boolean(applianceFamilyDetails(sentence));
  if (mode === 'forecast') return !/\b(?:nao|nunca|sem)\b/.test(text) && heard('1600');
  if (mode === 'criteria') {
    const words = String(sentence?.text || '').split(/\s+/).map((word, index) => ({ text: word, startFrame: index }));
    const required = applianceCriteriaMilestones({ ...sentence, wordTimings: words });
    const available = new Set(applianceCriteriaMilestones(sentence).map(item => item.label));
    return required.length > 0 && required.every(item => available.has(item.label));
  }
  if (/\b(?:nao|nunca|sem)\b/.test(text) || !heard('substitu', 'troca')) return false;
  const numbers = text.match(/\b\d+(?:[.,]\d+)*\b/g) || [];
  if (numbers.some(number => !['750', '900'].includes(number))) return false;
  if (numbers.includes('750') && (!/\b750\s+geladeiras\s+substituidas\b/.test(text) || !heard('750') || !heard('substituid'))) return false;
  if (numbers.includes('900') && (!/\b(?:serao|previst[oa]s?)\s+900\b/.test(text) || !/\boutubro\b/.test(text) || !heard('900') || !heard('outubro'))) return false;
  return true;
}

// Show each requirement only after the relevant words are spoken. These
// descriptions deliberately preserve the conditions in the narration rather
// than claiming that anyone shown is eligible.
function applianceCriteriaMilestones(sentence) {
  const text = normalize(sentence?.text);
  const positive = !/\b(?:nao|nunca|sem|dispensad\w*)\b/.test(text);
  const words = Array.isArray(sentence?.wordTimings) ? sentence.wordTimings : [];
  const items = [];
  const add = (condition, cue, label, icon) => {
    if (!condition) return;
    const word = words.find(item => cue(normalize(item.text)) && Number.isFinite(item.startFrame));
    if (word) items.push({ label, icon, startFrame: word.startFrame });
  };
  add(positive && /\bcliente\b/.test(text) && /\benel\b/.test(text), word => word.startsWith('enel'), 'CLIENTE DA ENEL', 'person');
  add(positive && /\bcontas?\b/.test(text) && /\bem dia\b/.test(text), word => /^dia\b/.test(word), 'CONTAS EM DIA', 'bill');
  add(positive && /\bate\s+250\s*kwh\b/.test(text), word => /^250\b/.test(word), 'ATÉ 250 kWh', 'energy');
  add(positive && /\bmedi[ao]\b/.test(text) && /\bate\s+250\s*kwh\b/.test(text) && /\bultimos\s+(?:12|doze) meses\b/.test(text), word => /^(?:12|doze)\b/.test(word), 'MÉDIA DOS ÚLTIMOS 12 MESES', 'calendar');
  add(/\btitular\b/.test(text) && /\bnao\b/.test(text) && /\bbeneficiad[ao]/.test(text) && /\bdez anos\b/.test(text), word => /^titular\b/.test(word), 'HISTÓRICO DO TITULAR', 'person');
  add(/\bnao\b/.test(text) && /\bbeneficiad[ao]/.test(text) && /\bdez anos\b/.test(text), word => /^dez\b/.test(word), 'NÃO TER SIDO BENEFICIADO NOS ÚLTIMOS DEZ ANOS', 'calendar');
  add(positive && /\bunidade antiga\b/.test(text) && /\bsinais de funcionamento\b/.test(text), word => /^funcionamento\b/.test(word), 'UNIDADE ANTIGA COM SINAIS DE FUNCIONAMENTO', 'fridge');
  add(positive && /\bconta de energia\b/.test(text) && /\bmais recente\b/.test(text), word => /^recente\b/.test(word), 'CONTA DE ENERGIA MAIS RECENTE', 'bill');
  add(positive && /\bconta de energia\b/.test(text) && /\bnome do titular\b/.test(text), word => /^titular\b/.test(word), 'CONTA EM NOME DO TITULAR', 'person');
  add(positive && /\bdocumentos pessoais\b/.test(text), word => /^pessoais\b/.test(word), 'DOCUMENTOS PESSOAIS', 'person');
  return items.sort((a, b) => a.startFrame - b.startFrame);
}

module.exports = { applianceExchangeBeat, applianceContextBeat, applianceVisualMode, applianceCueReached, applianceCriteriaMilestones, applianceExchangeLabel, applianceExchangeProgress, applianceSavingsSequence, applianceFamilyDetails, applianceSceneCoverage };
