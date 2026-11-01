'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildThumbnailHtml,
  chooseThumbnailHeadline,
  chooseLocalizedThumbnailHeadline,
  fallbackThumbnailHeadline,
  isGroundedThumbnailHeadline,
  restoreSourceConnectors,
  safeThumbnailImage,
  selectThumbnailHeroImage
} = require('../utils/thumbnail-design');
const { buildThumbnailFallbackArt, classifyThumbnailConcept } = require('../utils/thumbnail-fallback-art');

test('capa de lançamento identifica o produto em vez de terminar em uma palavra genérica', () => {
  const title = 'A Nutrify anunciou o lançamento da Creatine HMB em formato stick, uma nova apresentação do suplemento.';
  const headline = chooseThumbnailHeadline({ title, sourceText: title });
  assert.equal(headline, 'Creatine HMB em formato stick');
  assert.equal(isGroundedThumbnailHeadline(headline, title, title), true);
});

test('capa não transforma o tema de uma pergunta em fato eleitoral incerto', () => {
  const title = 'Reeleição de Lula: O que o mercado espera?';
  assert.equal(isGroundedThumbnailHeadline('Reeleição de Lula?', title, title), false);
  const headline = chooseThumbnailHeadline({ title });
  assert.match(headline, /mercado|espera/i);
});

test('capa usa o tema da fonte quando o título do roteiro é só uma anedota', () => {
  const sourceTitle = 'Segundo a psicologia, pessoas que gostam de postar tudo nas redes sociais nem sempre procuram aprovação, e a intenção pode mudar de uma publicação para outra';
  const displayTitle = 'Você sai para almoçar, encontra amigos ou conhece um lugar diferente e pensa em publicar uma fotografia';
  const headline = chooseLocalizedThumbnailHeadline({ sourceTitle, displayTitle, script: {} });
  assert.equal(headline, 'postar tudo nas redes sociais?');
  assert.doesNotMatch(headline, /almoçar|amigos/i);
});

test('gráfico decorativo financeiro não inventa direção de mercado', () => {
  const art = buildThumbnailFallbackArt({ topic: 'mercado financeiro', accent: '#22cc88' });
  assert.doesNotMatch(art, /M310 376 463 292|m692 175/);
  assert.match(art, /stroke-dasharray="28 18"/);
});

test('thumbnail uses the video title and contextual hero without adding clickbait claims', () => {
  const title = 'Como a nova IA está mudando os diagnósticos médicos';
  const headline = chooseThumbnailHeadline({ title });
  const hero = 'data:image/jpeg;base64,YWJjZA==';
  const html = buildThumbnailHtml({ title, headline, heroImage: hero, accent: '#12ABEF' });

  assert.match(html.replace(/<[^>]+>/g, ''), new RegExp(headline));
  assert.ok(headline.length <= 34);
  assert.ok(headline.split(/\s+/).length <= 5);
  assert.match(html, new RegExp(hero));
  assert.match(html, /#12ABEF/);
  assert.doesNotMatch(html, /você não vai acreditar|chocante|segredo revelado|imperdível/i);
});

test('thumbnail escapes markup and falls back from untrusted image URLs', () => {
  const html = buildThumbnailHtml({
    title: '<script>alert(1)</script>',
    heroImage: 'https://example.test/unrelated.jpg',
    accent: 'red'
  });

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /https:\/\/example\.test/);
  assert.match(html, /fallback-illustration/);
  assert.doesNotMatch(html, /<script>/i);
  assert.equal(safeThumbnailImage('data:image/png;base64,YWJjZA=='), 'data:image/png;base64,YWJjZA==');
  assert.equal(safeThumbnailImage('data:image/svg+xml;base64,PHN2Zz4='), '');
});

test('thumbnail fallback draws a local illustration grounded in the topic when image generation is unavailable', () => {
  const cases = [
    ['Canetas emagrecedoras e alterações no organismo', 'saúde', 'medicine'],
    ['Inflação e custo de vida', 'dinheiro', 'money'],
    ['Treino de força para iniciantes', 'fitness', 'fitness'],
    ['Dia Mundial da Alimentação DECO apresenta estudo sobre comportamento dos consumidores', 'psicologia', 'shopping'],
    ['Comportamento e ansiedade', 'psicologia', 'psychology'],
    ['Novas vagas de trabalho', 'carreira', 'career'],
    ['Como a inteligência artificial aprende', 'IA', 'technology'],
    ['Mesada e educação financeira', 'economize', 'savings'],
    ['O mistério do universo', 'mistérios', 'mystery']
  ];

  for (const [title, topic, expected] of cases) {
    assert.equal(classifyThumbnailConcept({ title, topic }), expected, title);
    const svg = buildThumbnailFallbackArt({ title, topic, accent: '#12ABEF' });
    assert.match(svg, new RegExp(`data-concept="${expected}"`));
    assert.match(svg, /<svg[\s\S]*<\/svg>/);
    assert.match(svg, /#12ABEF/);
    assert.doesNotMatch(svg, /<script|<image\b|href\s*=/i);
  }

  const html = buildThumbnailHtml({
    title: 'Canetas emagrecedoras e alterações no organismo',
    headline: 'CANETAS EMAGRECEDORAS ALTERAÇÕES',
    topic: 'saúde',
    accent: '#12ABEF'
  });
  assert.match(html, /data-concept="medicine"/);
  assert.match(html, /fallback-illustration/);
  assert.doesNotMatch(html, /hero-fallback/);
});

test('cover hooks restore only short grammatical connectors present in the source title', () => {
  const title = 'Canetas emagrecedoras e alterações no organismo';
  const candidate = 'CANETAS EMAGRECEDORAS ALTERAÇÕES';
  const connected = restoreSourceConnectors(candidate, title);

  assert.equal(connected, 'CANETAS EMAGRECEDORAS E ALTERAÇÕES');
  assert.equal(chooseThumbnailHeadline({ candidate, title }), connected);
  assert.ok(connected.length <= 34);
  assert.equal(restoreSourceConnectors('STARBUCKS COMPRA CHIPOTLE', 'Starbucks avalia compra da Chipotle'),
    'STARBUCKS COMPRA DA CHIPOTLE');
  assert.equal(restoreSourceConnectors('NOT IN SOURCE', title), 'NOT IN SOURCE');
});

test('thumbnail prefers the cleaner isometric image and falls back to close-up or opening image', () => {
  const wide = 'data:image/jpeg;base64,d2lkZQ==';
  const closeUp = 'data:image/jpeg;base64,Y2xvc2V1cA==';
  const isometric = 'data:image/jpeg;base64,aXNvbWV0cmlj';

  assert.equal(selectThumbnailHeroImage({ thumbnailImage: closeUp, sources: [wide] }), closeUp);
  assert.equal(selectThumbnailHeroImage({
    thumbnailImage: closeUp,
    thumbnailCandidates: [
      { variant: 'b', image: closeUp },
      { variant: 'c', image: isometric }
    ],
    sources: [wide]
  }), isometric);
  assert.equal(selectThumbnailHeroImage({
    thumbnailCandidates: [
      { variant: 'c', image: 'https://unrelated.test/image.jpg' },
      { variant: 'b', image: closeUp }
    ],
    sources: [wide]
  }), closeUp);
  assert.equal(selectThumbnailHeroImage({ thumbnailImage: 'https://unrelated.test/image.jpg', sources: [wide] }), wide);
  assert.equal(selectThumbnailHeroImage({ sources: ['https://unrelated.test/image.jpg'] }), '');
});

test('thumbnail prefers dedicated cover art without changing the video scene image', () => {
  const sceneImage = 'data:image/jpeg;base64,c2NlbmU=';
  const coverImage = 'data:image/jpeg;base64,Y292ZXI=';

  assert.equal(selectThumbnailHeroImage({ thumbnailImage: sceneImage }, coverImage), coverImage);
  assert.equal(selectThumbnailHeroImage({ thumbnailImage: sceneImage }, 'https://bad.test/cover.jpg'), sceneImage);
});

test('thumbnail can use a short high-impact hook grounded in the real script', () => {
  const title = 'Starbucks avalia compra da Chipotle em mega-acordo';
  const malformedHeadline = 'STARBUCKS AVALIA COMPRA CHIPOTLE?';
  const headline = 'AVALIA COMPRA DA CHIPOTLE?';
  const sourceText = `${title} A empresa avalia a aquisição, sem acordo confirmado.`;

  assert.equal(isGroundedThumbnailHeadline(headline, sourceText, title), true);
  assert.equal(chooseThumbnailHeadline({ candidate: malformedHeadline, title, sourceText }), headline);
  assert.equal(chooseThumbnailHeadline({ title, sourceText }), 'avalia compra da Chipotle');

  const html = buildThumbnailHtml({ title, headline, heroImage: 'data:image/jpeg;base64,YWJjZA==' });
  assert.match(html, /AVALIA COMPRA DA <span class="impact">CHIPOTLE\?/);
  assert.doesNotMatch(html, /em mega-acordo/);
  assert.match(html, /<span class="impact">CHIPOTLE\?<\/span>/);
  assert.match(html, /\.hero\{[^}]*object-fit:cover/);
});

test('generated SEO clickbait cannot override the original source title or article context', () => {
  const sourceTitle = 'Fundat divulga novas vagas de emprego para esta terça-feira, 13';
  const unsupported = 'Fundat: O segredo por trás das 300 vagas que somem em minutos';
  const sourceText = `${sourceTitle} A Prefeitura orienta candidatos sobre vagas disponíveis e os requisitos para inscrição.`;
  const headline = chooseThumbnailHeadline({
    candidate: unsupported,
    seoTitle: unsupported,
    title: sourceTitle,
    sourceText
  });

  assert.equal(headline, 'Fundat divulga novas vagas');
  assert.equal(isGroundedThumbnailHeadline(headline, sourceText, sourceTitle), true);
  assert.doesNotMatch(headline, /300|segredo|somem|minutos/i);

  const html = buildThumbnailHtml({ title: sourceTitle, headline });
  assert.match(html, /<h1>Fundat divulga novas <span class="impact">vagas<\/span><\/h1>/);
});

test('thumbnail rejects invented certainty and preserves source negation', () => {
  const title = 'OpenAI não lança novo modelo nesta semana';
  const sourceText = `${title} A publicação oficial nega o lançamento.`;

  assert.equal(isGroundedThumbnailHeadline('OPENAI LANÇA MODELO', sourceText, title), false);
  assert.equal(isGroundedThumbnailHeadline('OPENAI CONFIRMA LANÇAMENTO', sourceText, title), false);
  assert.equal(chooseThumbnailHeadline({
    candidate: 'OPENAI CONFIRMA LANÇAMENTO',
    seoTitle: 'OPENAI não lança novo modelo nesta semana',
    title,
    sourceText
  }), 'OpenAI não lança novo modelo');
});

test('thumbnail rejects headlines cut after an auxiliary and preserves the full claim', () => {
  const title = 'Treino e resistência à insulina: por que exercício não deve ser medido apenas pelas calorias gastas';
  const sourceText = `${title} A explicação compara o gasto calórico com outros aspectos do exercício.`;

  assert.equal(isGroundedThumbnailHeadline('EXERCÍCIO NÃO DEVE SER', sourceText, title), false);
  const headline = chooseThumbnailHeadline({
    candidate: 'EXERCÍCIO NÃO DEVE SER',
    seoTitle: 'EXERCÍCIO NÃO DEVE SER',
    title,
    sourceText
  });

  assert.equal(headline, 'não apenas pelas calorias');
  assert.equal(isGroundedThumbnailHeadline(headline, sourceText, title), true);
  assert.match(headline, /^não\b.*\bapenas\b.*\bcalorias$/i);
  assert.ok(headline.length <= 34);
});

test('thumbnail rejects a headline cut directly after a negation marker', () => {
  const title = 'Especialistas em psicologia concordam: quem desliga as notificações do grupo da família pode não estar sendo rude';
  const sourceText = `${title} Silenciar o grupo pode reduzir a sensação de disponibilidade constante sem significar rejeição.`;
  const incomplete = 'GRUPO DA FAMÍLIA PODE NÃO';

  assert.equal(isGroundedThumbnailHeadline(incomplete, sourceText, title), false);
  const headline = chooseThumbnailHeadline({ candidate: incomplete, title, sourceText });
  assert.equal(headline, 'pode não estar sendo rude');
  assert.equal(isGroundedThumbnailHeadline(headline, sourceText, title), true);
  assert.ok(!/\b(?:não|nunca|nem)$/i.test(headline));
});

test('thumbnail counts every displayed word and replaces a six-word headline with a concise source phrase', () => {
  const title = 'Menopausa e Treino: O que realmente muda após os 40';
  const sourceText = `${title}. O treino pode precisar mudar depois dos 40.`;
  const overlong = 'PODE PRECISAR MUDAR DEPOIS DOS 40';

  assert.equal(overlong.split(/\s+/).length, 6);
  assert.equal(isGroundedThumbnailHeadline(overlong, sourceText, title), false);
  const headline = chooseThumbnailHeadline({ candidate: overlong, title, sourceText });
  assert.equal(headline, 'realmente muda após os 40');
  assert.equal(isGroundedThumbnailHeadline(headline, sourceText, title), true);
  assert.ok(headline.length <= 34);
  assert.ok(headline.split(/\s+/).length <= 5);
  assert.throws(() => buildThumbnailHtml({ title, headline: overlong }), {
    code: 'thumbnail_headline_constraints_unmet'
  });
});

test('thumbnail preserves uncertainty and question framing from the source title', () => {
  const tentativeTitle = 'Starbucks avalia compra da Chipotle';
  const sourceText = `${tentativeTitle}, sem acordo confirmado.`;

  assert.equal(isGroundedThumbnailHeadline('STARBUCKS COMPRA CHIPOTLE', sourceText, tentativeTitle), false);
  assert.equal(isGroundedThumbnailHeadline('STARBUCKS AVALIA COMPRA CHIPOTLE', sourceText, tentativeTitle), true);
  assert.equal(chooseThumbnailHeadline({ candidate: 'STARBUCKS COMPRA CHIPOTLE', title: tentativeTitle, sourceText }), 'avalia compra da Chipotle');

  const questionTitle = 'A nova IA pode mudar a medicina?';
  assert.equal(isGroundedThumbnailHeadline('IA MUDA MEDICINA', questionTitle, questionTitle), false);
  assert.equal(isGroundedThumbnailHeadline('IA PODE MUDAR MEDICINA?', questionTitle, questionTitle), true);
  assert.equal(chooseThumbnailHeadline({ candidate: 'IA MUDA MEDICINA', title: questionTitle, sourceText: questionTitle }), 'IA pode mudar a medicina?');
});

test('thumbnail copy stays in the reviewed Brazilian Portuguese title when the source and SEO are English', () => {
  const localizedTitle = 'Adoçantes podem inibir bactérias intestinais em testes de laboratório';
  const script = {
    hook: 'Como os adoçantes podem inibir bactérias intestinais em laboratório?',
    mainContent: { sections: [{
      title: 'Testes de laboratório',
      content: 'O roteiro descreve os efeitos observados em bactérias intestinais.'
    }] },
    conclusion: { finalThought: 'Os efeitos precisam de mais estudos.' }
  };
  const localizedSource = [localizedTitle, script.hook, script.mainContent.sections[0].title,
    script.mainContent.sections[0].content, script.conclusion.finalThought].join(' ');
  const headline = chooseLocalizedThumbnailHeadline({
    candidate: 'SCIENTISTS TESTED 39 SWEETENERS',
    seoTitle: '39 adoçantes surpreenderam cientistas',
    displayTitle: localizedTitle,
    script,
    sourceTitle: 'Scientists tested 39 sweeteners and uncovered surprising gut effects'
  });

  assert.equal(headline, 'Adoçantes podem inibir bactérias');
  assert.equal(isGroundedThumbnailHeadline(headline, localizedSource, localizedTitle), true);
  assert.doesNotMatch(headline, /scientists|tested|sweeteners|39/i);
});

test('fallback picks a short subject phrase instead of truncating filler from the title', () => {
  assert.equal(
    chooseThumbnailHeadline({ title: 'Seu comportamento deixa seu cachorro agressivo? A ciência explica' }),
    'cachorro agressivo?'
  );
  assert.equal(
    chooseThumbnailHeadline({ title: 'Mesada: Ensinar a Poupar ou Deixar Gastar? O Guia Definitivo' }),
    'Mesada Poupar ou Gastar?'
  );
  assert.equal(
    chooseThumbnailHeadline({ title: 'Sine Manaus: 683 vagas e o detalhe que define se você entra ou fica de fora' }),
    'Sine Manaus 683 vagas'
  );
});

test('thumbnail copy never drops internal connectors to fit a short headline', () => {
  const title = 'Você parou de sentir sono, mas seu cérebro está falhando';
  const sourceText = `${title} Dormir seis horas pode esconder o cansaço e prejudicar a atenção.`;

  assert.equal(chooseThumbnailHeadline({
    candidate: 'PAROU SENTIR SONO MAS CÉREBRO',
    title,
    sourceText
  }), 'parou de sentir sono');
  assert.equal(fallbackThumbnailHeadline(title), 'parou de sentir sono');
  assert.equal(chooseThumbnailHeadline({
    candidate: 'SEU CÉREBRO ESTÁ FALHANDO',
    title,
    sourceText
  }), 'SEU CÉREBRO ESTÁ FALHANDO');
});

test('thumbnail numeric fragments preserve decimals, currency, magnitude and percentages', () => {
  const title = 'Mistério em Guarulhos: R$ 2,5 milhões em placas de vídeo desaparecem';
  for (const fragment of ['MISTÉRIO EM GUARULHOS R 2', 'R$ 2 milhões desaparecem', 'R$ 2,5 desaparecem']) {
    assert.equal(isGroundedThumbnailHeadline(fragment, title, title), false, fragment);
  }
  assert.equal(isGroundedThumbnailHeadline('R$ 2,5 milhões desaparecem', title, title), true);
  const fallback = fallbackThumbnailHeadline(title);
  assert.equal(isGroundedThumbnailHeadline(fallback, title, title), true);
  assert.doesNotMatch(fallback, /\bR\s+2\b/u);
  assert.equal(isGroundedThumbnailHeadline('Desconto de 10', 'Desconto de 10% confirmado', 'Desconto de 10% confirmado'), false);
  assert.equal(isGroundedThumbnailHeadline('Desconto de 10%', 'Desconto de 10% confirmado', 'Desconto de 10% confirmado'), true);
});

test('short cover hooks stay grounded across all ten channel themes', () => {
  const samples = [
    ['ia', 'Cientistas pedem órgão global para vigiar IA: como funcionaria?', 'COMO FUNCIONARIA?'],
    ['curiosidades', 'O Segredo Vocal de Madonna: O Que a Ciência Descobriu Após 40 Anos', 'SEGREDO VOCAL DE MADONNA?'],
    ['dinheiro', 'Mercado de games movimenta bilhões e transforma profissões', 'MERCADO DE GAMES?'],
    ['saude', 'Mente sã, corpo são: o papel do psicólogo no emagrecimento', 'MENTE SÃ, CORPO SÃO'],
    ['economize', 'Mesada: Ensinar a Poupar ou Deixar Gastar? O Guia Definitivo', 'POUPAR OU GASTAR?'],
    ['psicologia', 'Seu comportamento deixa seu cachorro agressivo? A ciência explica', 'CACHORRO AGRESSIVO?'],
    ['relacionamentos', 'Bianca Andrade quer mais filhos mas evita relacionamentos: o que a ciência explica', 'BIANCA QUER MAIS FILHOS?'],
    ['fitness', 'Pole fitness: treino que quebra estereótipos e ganha força entre mulheres brasileiras', 'POLE FITNESS QUEBRA ESTEREÓTIPOS?'],
    ['misterios', 'IA da Anthropic envia denúncia falsa de homicídio à polícia de Filadélfia', 'IA ENVIA DENÚNCIA FALSA?'],
    ['carreira', 'Sine Manaus: 683 vagas e o detalhe que define se você entra ou fica de fora', 'SINE MANAUS 683 VAGAS']
  ];

  for (const [theme, title, headline] of samples) {
    assert.equal(isGroundedThumbnailHeadline(headline, title, title), true, `${theme}: ${headline}`);
    assert.equal(chooseThumbnailHeadline({ candidate: headline, title, sourceText: title }), headline, theme);
  }
});
