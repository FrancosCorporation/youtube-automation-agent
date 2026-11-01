'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { applyScriptRepair, withScriptValidationRetry } = require('../utils/script-repair');

const draft = {
  title: 'O estudo sobre alimentação',
  hook: 'Comer frutas melhora a saúde mental de todos?',
  sections: [{
    title: 'O resultado', content: 'O estudo garante uma melhora da saúde mental.',
    emotion: 'curiosity', imagePrompt: 'A bowl of fruit on a wooden table.'
  }],
  conclusion: 'Veja os limites do estudo.',
  formatId: 'direct-answer'
};

test('source-ID repairs survive parsing; malformed IDs never silently fall back to quotes', () => {
  const update = value => applyScriptRepair(draft, { edits: [{ path: 'claimEvidence', value }] });
  const evidence = [{ path: 'title', sourceIds: ['S001'] }];
  assert.deepEqual(update(evidence).claimEvidence, evidence);
  for (const sourceIds of [[], ['unknown'], ['S001', null], 'S001']) {
    assert.throws(() => update([{ path: 'title', sourceIds, quote: 'This quote cannot conceal invalid IDs.' }]), {
      code: 'INVALID_SCRIPT_REPAIR'
    });
  }
});

test('text repair replaces only requested fields and preserves previous corrections and visual fields', () => {
  const updated = applyScriptRepair(draft, { edits: [
    { path: 'hook', value: 'Frutas e vegetais estão associados a uma saúde mental melhor?' },
    { path: 'sections.0.content', value: 'O estudo encontrou uma associação, sem demonstrar causalidade.' }
  ] });
  assert.equal(draft.sections[0].content, 'O estudo garante uma melhora da saúde mental.');
  assert.equal(updated.title, draft.title);
  assert.equal(updated.sections[0].imagePrompt, draft.sections[0].imagePrompt);
  assert.equal(updated.formatId, draft.formatId);
  const next = applyScriptRepair(updated, { edits: [{ path: 'title', value: 'Uma associação, com limites' }] });
  assert.equal(next.hook, updated.hook);
  assert.equal(next.sections[0].content, updated.sections[0].content);
});

test('repair rejects arbitrary paths, missing sections, duplicates and unbounded output', () => {
  for (const edits of [
    [{ path: '__proto__.polluted', value: 'unsafe' }],
    [{ path: 'sections.9.content', value: 'missing' }],
    [{ path: 'sections.0.imagePrompt', value: 'unrequested' }],
    [{ path: 'hook', value: 'changed' }, { path: 'hook', value: 'twice' }],
    [{ path: 'title', value: '' }],
    [{ path: 'title', value: 'x'.repeat(20001) }],
    []
  ]) assert.throws(() => applyScriptRepair(draft, { edits }), { code: 'INVALID_SCRIPT_REPAIR' });
  assert.equal({}.polluted, undefined);
});

test('empty or unchanged repairs never cause a re-review of the same draft', () => {
  assert.throws(() => applyScriptRepair(draft, { edits: [{ path: 'title', value: draft.title }] }), {
    code: 'INVALID_SCRIPT_REPAIR'
  });
  assert.throws(() => applyScriptRepair(draft, { title: 'A full rewrite is not an edit response' }), {
    code: 'INVALID_SCRIPT_REPAIR'
  });
});

test('a malformed model response gets one retry with a concrete correction', async () => {
  const feedbacks = [];
  const result = await withScriptValidationRetry(async feedback => {
    feedbacks.push(feedback);
    if (!feedback) throw Object.assign(new Error('invalid'), { code: 'SCRIPT_JSON_INVALID' });
    return { title: 'Resposta válida' };
  });
  assert.equal(feedbacks.length, 2);
  assert.match(feedbacks[1], /JSON anterior era inválido/);
  assert.equal(result.title, 'Resposta válida');
});

test('validation retries stay bounded and never retry provider failures or exhausted budgets', async () => {
  for (const code of ['BUDGET_EXHAUSTED', 'ETIMEDOUT', 'SCRIPT_JSON_INVALID']) {
    let calls = 0;
    await assert.rejects(withScriptValidationRetry(async () => {
      calls++;
      throw Object.assign(new Error('failed'), { code });
    }), { code });
    assert.equal(calls, code === 'SCRIPT_JSON_INVALID' ? 2 : 1);
  }
});
