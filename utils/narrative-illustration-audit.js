'use strict';

const { narrativeObjectVisual } = require('./narrative-concept-visual');
const { transitBeat } = require('./narrative-transit-scene');
const { gratitudeResearchBeat } = require('./narrative-research-gratitude');
const { cueRequiresPairedVisual } = require('./narrative-visual-semantics');
const { cueHasExplicitFlow, narrativeBeatRelation } = require('./narrative-beat-relation');
const { applianceSceneCoverage } = require('./narrative-appliance-scene');
const { normalizeIllustrations } = require('./narrative-illustration-plan');

// This is a minimum coverage gate, not a claim of artistic approval. It
// prevents a sentence whose only on-screen content is its own label from
// being treated as an illustrated beat.
function auditNarrativeIllustration(plan) {
  const sentences = Array.isArray(plan?.sentences) ? plan.sentences : [];
  const episodeText = sentences.map(sentence => sentence.text || '').join(' ');
  const missing = [];
  for (const sentence of sentences) {
    const scene = (plan.scenes || []).find(item => (item.sentenceIds || []).includes(sentence.id));
    if (!scene) { missing.push(sentence.id); continue; }
    const illustration = scene.illustrations?.find(item => item.cueSentenceId === sentence.id);
    if (illustration) {
      try { normalizeIllustrations(scene.illustrations, sentences.filter(cue => scene.sentenceIds.includes(cue.id)), plan.fps); }
      catch { missing.push(sentence.id); }
      continue;
    }
    if (gratitudeResearchBeat(sentence)) {
      const words = Array.isArray(sentence.wordTimings) ? sentence.wordTimings : [];
      const normalized = word => String(word.text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (![/^(?:gratidao|agradec)/, /^(?:ajud|colabor)/].every(pattern => words.some(word => Number.isFinite(word.startFrame) && pattern.test(normalized(word))))) missing.push(sentence.id);
      continue;
    }
    const transit = transitBeat({ title: plan.title, episodeText, sentence });
    if (transit) {
      if (transit === 'gratitude' && !(sentence.wordTimings || []).some(word => /^agradec/.test(String(word.text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()) && Number.isFinite(word.startFrame))) missing.push(sentence.id);
      continue;
    }
    const applianceCoverage = applianceSceneCoverage({ title: plan.title, sentence });
    if (applianceCoverage !== null) {
      if (!applianceCoverage) missing.push(sentence.id);
      continue;
    }
    const shots = (scene.cameraShots || []).filter(item => item.cueSentenceId === sentence.id);
    const actionIds = (scene.actions || []).filter(item => item.cueSentenceId === sentence.id).map(item => item.targetObjectId);
    const relation = narrativeBeatRelation({ sentence: sentence.text, objects: scene.objects });
    if (cueHasExplicitFlow(sentence.text) && relation?.kind !== 'flow') { missing.push(sentence.id); continue; }
    if (relation?.kind === 'flow' && relation.objectIds.some(id => {
      const object = (scene.objects || []).find(item => item.id === id);
      return !object || narrativeObjectVisual(object, sentence).kind === 'concept_text';
    })) { missing.push(sentence.id); continue; }
    const hasDrawingAtShot = shot => {
      const ids = new Set(actionIds);
      if (shot?.focusObjectId) ids.add(shot.focusObjectId);
      if (cueRequiresPairedVisual(sentence.text)) for (const camera of shots) ids.add(camera.focusObjectId);
      if (relation && new Set([...ids, ...relation.objectIds]).size <= 8) for (const id of relation.objectIds) ids.add(id);
      let visible = (scene.objects || []).filter(item => ids.has(item.id));
      if (!visible.length) visible = (scene.objects || []).slice(0, 1);
      return visible.some(object => narrativeObjectVisual(object, sentence).kind !== 'concept_text');
    };
    if (!(shots.length ? shots : [null]).every(hasDrawingAtShot)) missing.push(sentence.id);
  }
  return { complete: sentences.length > 0 && missing.length === 0, missing };
}

function assertNarrativeIllustration(plan) {
  const audit = auditNarrativeIllustration(plan);
  if (!audit.complete) throw Object.assign(new Error('fala sem encenação ilustrada; plano retido'), {
    code: 'NARRATIVE_ILLUSTRATION_MISSING', missingNarrativeCues: audit.missing
  });
  if (plan?.schemaVersion === 'pulso.narrative-episode/v2') {
    const { findNarrativeEnrichmentCues } = require('./narrative-illustration-repair');
    const missing = findNarrativeEnrichmentCues(plan);
    if (missing.length) throw Object.assign(new Error('fala com elementos visuais relevantes ausentes; plano retido'), {
      code: 'NARRATIVE_STORYTELLING_INCOMPLETE', missingNarrativeCues: missing
    });
  }
  return audit;
}

async function authorWithIllustrationRepair({ author, options, visualCritique = [], attempts = 2 }) {
  let feedback = [...(Array.isArray(visualCritique) ? visualCritique : [])];
  for (let index = 0; index < attempts; index++) {
    const plan = await author({ ...options, visualCritique: feedback.length ? feedback : null });
    const audit = auditNarrativeIllustration(plan);
    let targets = audit.missing;
    if (plan?.schemaVersion === 'pulso.narrative-episode/v2') {
      const { findNarrativeEnrichmentCues, repairNarrativeIllustrations } = require('./narrative-illustration-repair');
      const { validateNarrativeEpisodePlan } = require('./narrative-episode-plan');
      targets = [...new Set([...audit.missing, ...findNarrativeEnrichmentCues(plan)])];
      const repaired = repairNarrativeIllustrations(plan, targets);
      if (repaired.repaired.length && validateNarrativeEpisodePlan(repaired.plan).valid
        && auditNarrativeIllustration(repaired.plan).complete && !findNarrativeEnrichmentCues(repaired.plan).length) {
        const previous = Array.isArray(repaired.plan.author?.deterministicVisualRepair?.sentenceIds)
          ? repaired.plan.author.deterministicVisualRepair.sentenceIds : [];
        repaired.plan.author = { ...repaired.plan.author, deterministicVisualRepair: {
          revision: 'literal-cue-repair-v1', sentenceIds: [...new Set([...previous, ...repaired.repaired])]
        } };
        return repaired.plan;
      }
    }
    if (audit.complete && !targets.length) return plan;
    if (index + 1 === attempts) {
      if (!audit.complete) return assertNarrativeIllustration(plan);
      throw Object.assign(new Error('fala com elementos visuais relevantes ausentes; plano retido'), {
        code: 'NARRATIVE_STORYTELLING_INCOMPLETE', missingNarrativeCues: targets
      });
    }
    feedback = [...feedback, { issue: `Frases com explicação visual incompleta: ${targets.join(', ')}`,
      recommendedFix: 'Para cada frase indicada, mostre os elementos e ações concretos relevantes, na ordem da fala; uma expressão escrita sozinha não é uma cena.' }];
  }
  throw new Error('tentativas de autoria visual inválidas');
}

module.exports = { auditNarrativeIllustration, assertNarrativeIllustration, authorWithIllustrationRepair };
