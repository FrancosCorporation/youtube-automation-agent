'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildPrompt,buildAdaptivePrompt}=require('../utils/narrative-scene-author');
const {CREATIVE_REFERENCE}=require('../utils/narrative-creative-reference');
test('both author routes retain multitheme direction in initial and repair requests',()=>{
  const plan={themeId:'curiosidades',title:'O percurso de um livro',source:{},fps:30};
  const chapterInputs=[{id:'scene-01',sentenceIds:['s1'],narration:[{id:'s1',text:'O livro volta para a estante.',startFrame:0,endFrame:150}]}];
  for(const build of [buildPrompt,buildAdaptivePrompt])for(const retryErrors of [[],['porta fechada no percurso']]){
    const prompt=build({plan,chapterInputs,sourceContext:'Fonte.',retryErrors});
    for(const rule of [/DIRETRIZES MULTITEMA/,/CONTINUIDADE DE PORTAS E ROUPAS/,/DECUPAGEM MULTITEMA/,/não os deixe quinze segundos inertes/,/halo/,/não copie frutas/])assert.match(prompt,rule);
    assert.match(prompt,/O livro volta para a estante/);
  }
  assert.equal(CREATIVE_REFERENCE.revision,2);
});
