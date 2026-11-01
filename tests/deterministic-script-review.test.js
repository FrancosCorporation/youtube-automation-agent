'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('past-tense scientific uncertainty stays explicit when translated to Portuguese', () => {
  const { verifyScriptEvidence } = require('../utils/deterministic-script-review');
  for (const [en, pt] of [['indicated', 'indicaram'], ['suggested', 'sugeriram']]) {
    const quote = `The results ${en} that oxygen remains within the structure in the tested samples.`;
    const source = `${quote} The scientists tested the samples in the laboratory and reported the measurements with the stated experimental limits. `.repeat(3);
    const title = `Os resultados ${pt} que o oxigênio permanece na estrutura das amostras testadas.`;
    assert.equal(verifyScriptEvidence({ title, claimEvidence: [{ path: 'title', quote }] }, source).status, 'approved');
    const certain = verifyScriptEvidence({ title: 'O oxigênio permanece na estrutura das amostras testadas.',
      claimEvidence: [{ path: 'title', quote }] }, source);
    assert(certain.errors.some(e => e.code === 'claim_uncertainty_not_preserved'));
  }
});
const { normalizeEvidenceText, verifyEditorialMetadata, verifyScriptEvidence } = require('../utils/deterministic-script-review');

test('scientific translations preserve ability, future possibility and explicit unanswered questions', () => {
  const examples = [
    ['The compounds absorb ultraviolet light, which humans cannot see, and reemit energy as visible light.',
      'Os compostos absorvem luz ultravioleta, que os humanos não conseguem ver, e reemitem energia como luz visível.',
      'Os humanos conseguem ver luz ultravioleta.'],
    ['Determining which molecule produces the glow could help explain how the fluorescence develops.',
      'Determinar qual molécula produz o brilho poderá ajudar a explicar como a fluorescência se desenvolve.',
      'Determinar qual molécula produz o brilho explica como a fluorescência se desenvolve.'],
    ['One of the biggest unanswered questions concerns the substance responsible for the fluorescence.',
      'Uma das maiores questões sem resposta diz respeito à substância responsável pela fluorescência.',
      'Uma das maiores questões respondidas diz respeito à substância responsável pela fluorescência.'],
    ["We still don't know what the compound responsible for this fluorescence is, but everything indicates an unknown molecule.",
      'Ainda não sabemos qual é o composto responsável pela fluorescência, mas tudo indica uma molécula desconhecida.',
      'Sabemos qual é o composto responsável pela fluorescência, mas tudo indica uma molécula desconhecida.'],
    ['One possibility is that the glow may help individuals recognize each other.',
      'Uma possibilidade é que o brilho ajude os indivíduos a se reconhecerem.',
      'O brilho ajuda os indivíduos a se reconhecerem.']
  ];
  for (const [quote, translated, contradicted] of examples) {
    const context = `${quote} Researchers described the laboratory observations and the experimental methods in the publication. `.repeat(4);
    const script = title => ({ title, claimEvidence: [{ path: 'title', quote }] });
    assert.equal(verifyScriptEvidence(script(translated), context).status, 'approved', translated);
    const rejected = verifyScriptEvidence(script(contradicted), context);
    assert.equal(rejected.status, 'rejected', contradicted);
    assert(rejected.errors.some(error => ['claim_negation_not_preserved', 'claim_uncertainty_not_preserved'].includes(error.code)));
  }
});

const source = [
  'O relatório informa que a empresa registrou alta de 20% nas vendas no trimestre. A publicação também explica que o resultado veio de pedidos feitos por clientes de diferentes regiões.',
  'O documento descreve o período, os números e a metodologia usada para apresentar o resultado. A empresa divulgou os dados em comunicado e informou que a comparação considera o trimestre anterior.',
  'O texto não atribui o resultado a uma causa única e não apresenta projeções para os próximos períodos. A reportagem registra somente os dados informados pela empresa e os limites da comparação.'
].join(' ');

function makeScript() {
  return {
    title: 'Empresa registra alta de 20% nas vendas',
    hook: 'O que explica a alta de 20% nas vendas?',
    sections: [{
      title: 'O número divulgado',
      content: 'A empresa registrou alta de 20% no trimestre.'
    }],
    conclusion: 'O texto não atribui a alta a uma causa única.',
    claimEvidence: [
      { path: 'title', quote: 'A empresa registrou alta de 20% nas vendas no trimestre.' },
      { path: 'hook#1', quote: 'A empresa registrou alta de 20% nas vendas no trimestre.' },
      { path: 'sections.0.title', quote: 'O relatório informa que a empresa registrou alta de 20% nas vendas no trimestre.' },
      { path: 'sections.0.content#1', quote: 'A empresa registrou alta de 20% nas vendas no trimestre.' },
      { path: 'conclusion#1', quote: 'O texto não atribui o resultado a uma causa única.' }
    ]
  };
}

test('HTML named Portuguese entities preserve negation and trend evidence', () => {
  const quote = 'O texto n&atilde;o explica por que as refer&ecirc;ncias &agrave; ansiedade aumentaram, enquanto as men&ccedil;&otilde;es &agrave; tristeza ca&iacute;ram.';
  const claim = 'O texto não explica por que as referências à ansiedade aumentaram, enquanto as menções à tristeza caíram.';
  const source = Array(8).fill(quote).join(' ');
  const script = {
    sections: [{ content: claim }],
    claimEvidence: [{ path: 'sections.0.content#1', quote }]
  };

  assert.equal(normalizeEvidenceText('conclus&atilde;o e m&uacute;sica'), normalizeEvidenceText('conclusão e música'));
  assert.deepEqual(verifyScriptEvidence(script, source).errors, []);
});

test('Portuguese Unicode word boundaries distinguish semântico from the negation sem', () => {
  const quote = 'Most modern language models tokenize by subwords, that is, by chunks of text containing semantic meaning.';
  const script = makeScript();
  script.sections[0].content = 'Os modelos modernos usam subpalavras com significado semântico.';
  script.claimEvidence.find(e => e.path === 'sections.0.content#1').quote = quote;
  const context = Array(8).fill(quote).join(' ');
  const result = verifyScriptEvidence(script, context);
  assert.ok(!result.errors.some(e => e.path === 'sections.0.content#1' && e.code === 'claim_negation_not_preserved'));
  script.sections[0].content = 'Os modelos modernos usam subpalavras sem significado.';
  assert.ok(verifyScriptEvidence(script, context).errors.some(e => e.path === 'sections.0.content#1' && e.code === 'claim_negation_not_preserved'));
});

test('negation repair feedback preserves the condition in the cited claim', () => {
  const { feedbackForEvidenceErrors } = require('../utils/deterministic-script-review');
  const feedback = feedbackForEvidenceErrors([{ path: 'sections.1.title', code: 'claim_negation_not_preserved' }]);
  assert.match(feedback, /mantenha explícitas na mesma fala a negação e a condição/);
  assert.match(feedback, /não há novidades/);
  assert.match(feedback, /não as retire nem generalize/);
});

test('approves a complete script whose claims map to exact source quotes', () => {
  const result = verifyScriptEvidence(makeScript(), source);
  assert.equal(result.verdict, 'aprovado');
  assert.equal(result.claimCount, 5);
  assert.equal(result.evidenceCount, 5);
  assert.equal(result.errors.length, 0);
  assert.match(result.sourceHash, /^[a-f0-9]{64}$/);
});

test('rejects missing, duplicate, and fabricated source evidence', () => {
  const script = makeScript();
  script.claimEvidence.pop();
  script.claimEvidence[0].quote = 'A empresa inventou uma alta de 20% nos resultados publicados.';
  script.claimEvidence.push({ path: 'title', quote: 'A empresa registrou alta de 20% nas vendas no trimestre.' });
  const result = verifyScriptEvidence(script, source);
  assert.equal(result.verdict, 'reprovado');
  assert(result.errors.some(error => error.code === 'claim_evidence_missing'));
  assert(result.errors.some(error => error.code === 'duplicate_claim_evidence_path'));
  assert(result.errors.some(error => error.code === 'quote_not_in_source'));
});

test('rejects claim numbers absent from the cited passage', () => {
  const script = makeScript();
  script.sections[0].content = 'A empresa registrou alta de 80% no trimestre.';
  script.claimEvidence.find(item => item.path === 'sections.0.content#1').quote =
    'A empresa registrou alta de 20% nas vendas no trimestre.';
  const result = verifyScriptEvidence(script, source);
  assert(result.errors.some(error => error.code === 'claim_number_not_in_quote'));
});

test('supports translated narration when the exact source-language passage is cited', () => {
  const translated = {
    title: 'Empresa amplia vendas em 20%',
    hook: 'O que mudou nas vendas?',
    sections: [{ title: 'O resultado', content: 'A companhia relatou alta de 20% no trimestre.' }],
    conclusion: 'A matéria atribui o dado à empresa.',
    claimEvidence: [
      { path: 'title', quote: 'The company reported a 20% increase in quarterly sales.' },
      { path: 'hook#1', quote: 'The company reported a 20% increase in quarterly sales.' },
      { path: 'sections.0.title', quote: 'The company reported a 20% increase in quarterly sales.' },
      { path: 'sections.0.content#1', quote: 'The company reported a 20% increase in quarterly sales.' },
      { path: 'conclusion#1', quote: 'The report attributes the figure to the company.' }
    ]
  };
  const englishSource = 'The company reported a 20% increase in quarterly sales. The report attributes the figure to the company and does not provide a forecast for future periods. '.repeat(3);
  assert.equal(verifyScriptEvidence(translated, englishSource).verdict, 'aprovado');
});

test('recognizes translated English inability and modal qualifiers', () => {
  const examples = [
    {
      quote: 'These movements allow astronomers to detect black hole activity even when the objects themselves cannot be seen directly.',
      claim: 'Esses movimentos permitem detectar a atividade dos buracos negros mesmo quando os objetos não podem ser vistos diretamente.'
    },
    {
      quote: 'The telescope could not resolve the two central black holes as separate points of light.',
      claim: 'O telescópio não podia resolvê-los como dois pontos de luz separados.'
    }
  ];

  for (const { quote, claim } of examples) {
    const script = makeScript();
    script.sections[0].content = claim;
    script.claimEvidence.find(item => item.path === 'sections.0.content#1').quote = quote;
    const result = verifyScriptEvidence(script, Array(8).fill(quote).join(' '));
    assert.deepEqual(result.errors.filter(error => error.path === 'sections.0.content#1'
      && ['claim_negation_not_preserved', 'claim_uncertainty_not_preserved'].includes(error.code)), []);
  }
});

test('does not treat different directions for separate quantities as a contradiction', () => {
  const quote = 'Its smaller neighbor, with a mass of roughly 600,000 suns, is accumulating matter at a much higher rate.';
  const script = makeScript();
  script.sections[0].content = 'Seu vizinho menor acumula matéria a uma taxa muito maior.';
  script.claimEvidence.find(item => item.path === 'sections.0.content#1').quote = quote;
  const result = verifyScriptEvidence(script, Array(8).fill(quote).join(' '));
  assert.deepEqual(result.errors.filter(error => error.path === 'sections.0.content#1'
    && error.code === 'claim_direction_conflicts_with_quote'), []);
});

test('não transfere a eficiência do substituto para os equipamentos antigos', () => {
  const quote = 'A substituição gratuita de geladeiras antigas por equipamentos mais eficientes vai muito além da troca.';
  const context = Array(8).fill(quote).join(' ');
  const review = title => verifyScriptEvidence({ title, claimEvidence: [{ path: 'title', quote }] }, context);
  assert(review('Programa troca geladeiras antigas e eficientes na cidade').errors
    .some(error => error.code === 'claim_replacement_attribute_conflict'));
  assert(!review('Programa troca geladeiras antigas por equipamentos mais eficientes').errors
    .some(error => error.code === 'claim_replacement_attribute_conflict'));
  assert(!review('Programa troca geladeiras antigas e ineficientes').errors
    .some(error => error.code === 'claim_replacement_attribute_conflict'));
});

test('não apresenta como realizada uma quantidade prevista pela fonte', () => {
  const quote = 'O programa chegou a 750 geladeiras; até o final do mês, serão 900 equipamentos entregues à população.';
  const context = Array(8).fill(quote).join(' ');
  const review = title => verifyScriptEvidence({ title, claimEvidence: [{ path: 'title', quote }] }, context);
  assert(review('Programa troca 900 geladeiras').errors.some(error => error.code === 'claim_future_quantity_as_completed'));
  assert(!review('Programa prevê 900 equipamentos').errors.some(error => error.code === 'claim_future_quantity_as_completed'));
  assert(!review('Programa chegou a 750 geladeiras').errors.some(error => error.code === 'claim_future_quantity_as_completed'));
});

test('não narra uma fala pessoal da fonte sem atribuição', () => {
  const quote = '“Minha geladeira estava enferrujada e estou desempregada”, contou a moradora.';
  const context = Array(8).fill(quote).join(' ');
  const review = title => verifyScriptEvidence({ title, claimEvidence: [{ path: 'title', quote }] }, context);
  assert(review('Minha geladeira estava enferrujada e estou desempregada').errors
    .some(error => error.code === 'claim_quote_attribution_missing'));
  assert(!review('A moradora disse que sua geladeira estava enferrujada e que estava desempregada').errors
    .some(error => error.code === 'claim_quote_attribution_missing'));
});

test('metadata grounding rejects new numeric claims and headline terms', () => {
  const script = makeScript();
  const result = verifyEditorialMetadata({
    youtubeTitle: 'Empresa registra 20% de alta nas vendas',
    thumbnailHeadline: 'Recorde histórico garantido',
    description: 'Veja o que a empresa informou sobre as vendas.'
  }, script, source);
  assert.equal(result.valid, false);
  assert(result.errors.some(error => error.code === 'thumbnail_term_not_in_script'));

  const numeric = verifyEditorialMetadata({
    youtubeTitle: 'Empresa registra alta de 80%',
    thumbnailHeadline: 'Alta nas vendas',
    description: 'Dados do trimestre divulgados pela empresa.'
  }, script, source);
  assert(numeric.errors.some(error => error.code === 'metadata_number_not_in_script'));
});
