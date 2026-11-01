'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ReadableStream } = require('node:stream/web');
const { TextEncoder } = require('node:util');
const {
  googleNewsClusters,
  googleNewsClustersWithBoost,
  parseGoogleNewsFeed,
  parseThemeFeed,
  publisherIdentity,
  publisherDisplayName,
  sameStoryTitle,
  filterSameStoryNewsReferences,
  candidateSignalLabel,
  readBoundedResponseText,
  resolveGoogleNewsUrl
} = require('../utils/news-hunter');

const story = 'BBC reports new research about ocean temperature changes';

test('theme feed parser supports RSS and Atom entries with decoded links and publication dates', () => {
  const recentDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const rss = parseThemeFeed(`<rss><channel><item>
    <title><![CDATA[Health &amp; discovery]]></title>
    <link>https://publisher.example/articles/one?lang=en&amp;ref=rss</link>
    <pubDate>${recentDate}</pubDate>
  </item></channel></rss>`, { source: 'Example News', url: 'https://publisher.example/rss.xml' });
  assert.equal(rss.length, 1);
  assert.equal(rss[0].title, 'Health & discovery');
  assert.equal(rss[0].link, 'https://publisher.example/articles/one?lang=en&ref=rss');
  assert.equal(rss[0].source, 'Example News');
  assert.ok(rss[0].ageHours > 1.9 && rss[0].ageHours < 2.1);

  const atom = parseThemeFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <title type="text">Research &amp; recovery</title>
    <link rel="self" href="https://publisher.example/feed/atom"/>
    <link rel="alternate" type="text/html" href="https://publisher.example/article?id=2&amp;lang=en"/>
    <updated>${recentDate}</updated>
  </entry></feed>`, { source: 'Open Journal', url: 'https://publisher.example/feed/atom' });
  assert.equal(atom.length, 1);
  assert.equal(atom[0].title, 'Research & recovery');
  assert.equal(atom[0].link, 'https://publisher.example/article?id=2&lang=en');
  assert.equal(atom[0].sourceUrl, 'https://publisher.example/feed/atom');
  assert.ok(atom[0].ageHours > 1.9 && atom[0].ageHours < 2.1);
});

test('story title matching rejects similar vacancy headlines from other cities or counts', () => {
  const navegantes = 'Prefeitura de Navegantes oferece 490 vagas de emprego em diferentes áreas';
  assert.equal(sameStoryTitle(navegantes, '490 vagas de emprego estão abertas em Navegantes nesta quinta-feira'), true);
  assert.equal(sameStoryTitle(navegantes, 'Prefeitura de Santos oferece 215 vagas de emprego em diferentes áreas'), false);
  assert.equal(sameStoryTitle('Prefeitura de Santos oferece 215 vagas de emprego', 'Prefeitura de Santos oferece 490 vagas de emprego'), false);
});

test('story title matching does not treat a generic shared elections word as the same news story', () => {
  const marketStory = 'Eleições, juros e mudanças na jornada de trabalho aumentam cautela do mercado';
  const metaStory = 'Meta diz ao TSE que trabalha no aperfeiçoamento de ferramenta de IA nas eleições';
  assert.equal(sameStoryTitle(marketStory, metaStory, 0.25), false);
});

test('visual news references include only headlines matching the primary story', () => {
  const sourceTitle = 'AI-DLC: como o projeto organiza assistentes de programação';
  const related = { title: 'AI-DLC organiza fluxo de trabalho para agentes de programação' };
  const unrelated = { title: 'IBM apresenta ciclo de vida de desenvolvimento orientado por IA' };
  assert.deepEqual(filterSameStoryNewsReferences([related, unrelated], sourceTitle), [related]);
  assert.deepEqual(filterSameStoryNewsReferences([related], ''), []);
});

test('Google News keeps local job vacancy stories in separate clusters', () => {
  const clusters = googleNewsClustersWithBoost([
    {
      title: 'Navegantes oferece 490 vagas de emprego em diferentes áreas', source: 'Prefeitura de Navegantes',
      sourceUrl: 'https://navegantes.sc.gov.br/', link: 'https://news.google.com/rss/articles/navegantes', ageHours: 2
    },
    {
      title: 'Próximo Mutirão do Emprego de Santos oferece 215 vagas; entrevistas até segunda', source: 'Prefeitura de Santos',
      sourceUrl: 'https://www.santos.sp.gov.br/', link: 'https://news.google.com/rss/articles/santos', ageHours: 3
    },
    {
      title: 'Funsat oferece 805 vagas de emprego nesta quinta-feira', source: 'CGNotícias',
      sourceUrl: 'https://www.campogrande.ms.gov.br/', link: 'https://news.google.com/rss/articles/campogrande', ageHours: 4
    },
    {
      title: 'Sine oferece vagas de emprego em diversas áreas no Tocantins', source: 'Agência Tocantins',
      sourceUrl: 'https://www.to.gov.br/', link: 'https://news.google.com/rss/articles/tocantins', ageHours: 5
    }
  ], []);

  assert.equal(clusters.length, 4);
  assert.deepEqual(clusters.map(item => item.independentSources), [1, 1, 1, 1]);
  assert.deepEqual(clusters.map(item => item.corroboratingArticles.length), [1, 1, 1, 1]);
});

test('Google News parser keeps the publisher URL and decodes XML metadata', () => {
  const parsed = parseGoogleNewsFeed(`<?xml version="1.0"?><rss><channel><item>
    <title>Research &amp; discovery</title>
    <link>https://news.google.com/articles?id=1&amp;oc=5</link>
    <source url="https://publisher.example.com/?edition=br&amp;lang=pt">Source &amp; Co</source>
    <description>Resumo &amp; contexto da reportagem.</description>
  </item></channel></rss>`);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'Research & discovery');
  assert.equal(parsed[0].link, 'https://news.google.com/articles?id=1&oc=5');
  assert.equal(parsed[0].source, 'Source & Co');
  assert.equal(parsed[0].sourceUrl, 'https://publisher.example.com/?edition=br&lang=pt');
  assert.equal(parsed[0].description, 'Resumo & contexto da reportagem.');
});

test('publisher identity ignores editorial labels such as BBC section names', () => {
  assert.equal(publisherIdentity('BBC Technology'), publisherIdentity('BBC News'));
  assert.equal(publisherIdentity('BBC Work'), publisherIdentity('BBC Business'));
  assert.equal(publisherIdentity('G1 Tecnologia'), publisherIdentity('G1'));
  assert.equal(publisherIdentity('', 'https://publisher.example.com/rss'), 'host:publisher.example.com');
});

test('source cards use the resolved publisher instead of the discovery aggregator', () => {
  assert.equal(publisherDisplayName('Hacker News', 'https://api-docs.deepseek.com/guides/search/'), 'DeepSeek');
  assert.equal(publisherDisplayName('Google News (3)', 'https://openai.com/index/'), 'OpenAI');
  assert.equal(publisherDisplayName('Hacker News', 'https://news.ycombinator.com/item?id=1'), 'Hacker News');
  assert.equal(publisherDisplayName('Reuters', 'https://www.reuters.com/world/'), 'Reuters');
});

test('the same publisher in Google News and a theme feed is not counted twice', () => {
  const googleNews = [{ title: story, source: 'BBC News', sourceUrl: 'https://www.bbc.co.uk/news', link: 'https://news.google.com/story', ageHours: 2 }];
  const base = googleNewsClusters(googleNews)[0];
  const samePublisher = googleNewsClustersWithBoost(googleNews, [{
    title: story,
    source: 'BBC Work',
    sourceUrl: 'https://feeds.bbci.co.uk/news/rss.xml'
  }])[0];

  assert.equal(base.independentSources, 1);
  assert.equal(samePublisher.independentSources, 1);
  assert.equal(samePublisher.score, base.score);
  assert.deepEqual(samePublisher.sourceIds, ['name:bbc']);
});

test('a distinct publisher adds one corroboration and the configured score boost', () => {
  const googleNews = [{ title: story, source: 'BBC News', link: 'https://news.google.com/story', ageHours: 2 }];
  const baseline = googleNewsClusters(googleNews)[0];
  const corroborated = googleNewsClustersWithBoost(googleNews, [{
    title: story,
    source: 'Reuters',
    sourceUrl: 'https://www.reuters.com/world/'
  }])[0];

  assert.equal(corroborated.independentSources, 2);
  assert.deepEqual(new Set(corroborated.sourceIds), new Set(['name:bbc', 'name:reuters']));
  assert.equal(corroborated.score, baseline.score + 0.8);
});

test('Google News candidates retain configured direct links and original publisher links', () => {
  const result = googleNewsClustersWithBoost([{
    title: story, source: 'BBC News', sourceUrl: 'https://www.bbc.co.uk/news',
    link: 'https://news.google.com/story', ageHours: 2
  }], [{
    title: story, source: 'Reuters', sourceUrl: 'https://www.reuters.com/world/',
    link: 'https://www.reuters.com/world/example-story/'
  }])[0];

  assert.deepEqual(result.corroboratingArticles, [{
    title: story, source: 'Reuters', url: 'https://www.reuters.com/world/example-story/',
    publisherUrl: 'https://www.reuters.com/world/'
  }, {
    title: story, source: 'BBC News', url: 'https://news.google.com/story',
    publisherUrl: 'https://www.bbc.co.uk/news'
  }]);
});

test('Google News candidates retain article links from multiple independent outlets', () => {
  const result = googleNewsClustersWithBoost([
    {
      title: story, source: 'BBC News', sourceUrl: 'https://www.bbc.co.uk/news',
      link: 'https://news.google.com/rss/articles/bbc', ageHours: 2
    },
    {
      title: story, source: 'Reuters', sourceUrl: 'https://www.reuters.com/world/',
      link: 'https://news.google.com/rss/articles/reuters', ageHours: 3
    },
    {
      title: story, source: 'The Guardian', sourceUrl: 'https://www.theguardian.com/world',
      link: 'https://news.google.com/rss/articles/guardian', ageHours: 4
    }
  ], [])[0];

  assert.deepEqual(result.corroboratingArticles, [
    {
      title: story, source: 'BBC News', url: 'https://news.google.com/rss/articles/bbc',
      publisherUrl: 'https://www.bbc.co.uk/news'
    },
    {
      title: story, source: 'Reuters', url: 'https://news.google.com/rss/articles/reuters',
      publisherUrl: 'https://www.reuters.com/world/'
    },
    {
      title: story, source: 'The Guardian', url: 'https://news.google.com/rss/articles/guardian',
      publisherUrl: 'https://www.theguardian.com/world'
    }
  ]);
});

test('direct configured feed links take priority over duplicate Google News wrappers', () => {
  const result = googleNewsClustersWithBoost([{
    title: story, source: 'Reuters', sourceUrl: 'https://www.reuters.com/world/',
    link: 'https://news.google.com/rss/articles/reuters', ageHours: 2
  }, {
    title: story, source: 'BBC News', sourceUrl: 'https://www.bbc.co.uk/news',
    link: 'https://news.google.com/rss/articles/bbc', ageHours: 2
  }], [{
    title: story, source: 'Reuters', sourceUrl: 'https://feeds.reuters.com/reuters/topNews',
    link: 'https://www.reuters.com/world/example-story/'
  }])[0];

  assert.deepEqual(result.corroboratingArticles, [{
    title: story, source: 'Reuters', url: 'https://www.reuters.com/world/example-story/',
    publisherUrl: 'https://feeds.reuters.com/reuters/topNews'
  }, {
    title: story, source: 'BBC News', url: 'https://news.google.com/rss/articles/bbc',
    publisherUrl: 'https://www.bbc.co.uk/news'
  }]);
});

test('Google News resolver decodes opaque IDs and validates the resolved publisher', async () => {
  const publisher = 'https://www.publisher.example.com/news/';
  const requests = [];
  const rpcFrames = [['wrb.fr', 'Fbv4je', JSON.stringify([
    'garturlres', 'https://publisher.example.com/news/story-123'
  ])]];
  const resolved = await resolveGoogleNewsUrl('https://news.google.com/rss/articles/abc', publisher, {
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (init.method === 'POST') return new globalThis.Response(`)]}'\n\n${JSON.stringify(rpcFrames)}`);
      return new globalThis.Response('<div data-n-a-sg="sig-test" data-n-a-ts="1750000000"></div>');
    }
  });

  assert.equal(resolved, 'https://publisher.example.com/news/story-123');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, 'https://news.google.com/_/DotsSplashUi/data/batchexecute');
  assert.equal(requests[1].init.headers['Content-Type'], 'application/x-www-form-urlencoded;charset=UTF-8');
  const outerPayload = JSON.parse(new globalThis.URLSearchParams(requests[1].init.body).get('f.req'));
  const requestPayload = JSON.parse(outerPayload[0][0][1]);
  assert.equal(requestPayload[0], 'garturlreq');
  assert.equal(requestPayload[2], 'abc');
  assert.equal(requestPayload[3], 1750000000);
});

test('Google News resolver fails closed when its page exposes only an image or another publisher', async () => {
  for (const html of [
    '<a href="https://lh3.googleusercontent.com/photo.png">image</a>',
    '<a href="https://other.example.com/news/story">other publisher</a>',
    '<a href="/relative/story">relative path</a>'
  ]) {
    const resolved = await resolveGoogleNewsUrl('https://news.google.com/rss/articles/abc', 'https://publisher.example.com/', {
      fetchImpl: async () => new globalThis.Response(html, { status: 200 })
    });
    assert.equal(resolved, '');
  }

  const mismatchedPublisher = await resolveGoogleNewsUrl('https://news.google.com/rss/articles/different-id', 'https://publisher.example.com/', {
    fetchImpl: async (_url, init) => init.method === 'POST'
      ? new globalThis.Response(`)]}'\n\n${JSON.stringify([['wrb.fr', 'Fbv4je', JSON.stringify(['garturlres', 'https://other.example.com/story'])]])}`)
      : new globalThis.Response('<div data-n-a-sg="sig-test" data-n-a-ts="1750000000"></div>')
  });
  assert.equal(mismatchedPublisher, '');
});

test('candidate log labels source corroboration separately from comments', () => {
  assert.equal(candidateSignalLabel({ source: 'Google News (2 veículos)', independentSources: 2, comments: 2 }), '2 fontes independentes');
  assert.equal(candidateSignalLabel({ source: 'Reddit r/news', independentSources: 1, comments: 1 }), '1 comentário');
});

test('news responses are decoded correctly when multibyte text crosses stream chunks', async () => {
  const bytes = Buffer.from('notícia 🔐');
  const split = bytes.indexOf(0xf0) + 2;
  const response = {
    headers: { get: () => String(bytes.byteLength) },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, split));
        controller.enqueue(bytes.subarray(split));
        controller.close();
      }
    })
  };

  assert.equal(await readBoundedResponseText(response, bytes.byteLength), 'notícia 🔐');
});

test('news response byte limits reject oversized streams and cancel their reader', async () => {
  let cancelled = false;
  const response = {
    headers: { get: () => null },
    body: new ReadableStream({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('too large'));
      },
      cancel() { cancelled = true; }
    })
  };

  await assert.rejects(readBoundedResponseText(response, 4), /exceeds 4 byte limit/);
  assert.equal(cancelled, true);
});

test('news response byte limits reject an oversized declared length before reading', async () => {
  let read = false;
  const response = {
    headers: { get: () => '1000' },
    body: new ReadableStream({
      pull(controller) { read = true; controller.enqueue(new Uint8Array(1)); },
      cancel() {}
    })
  };

  await assert.rejects(readBoundedResponseText(response, 10), /exceeds 10 byte limit/);
  assert.equal(read, false);
});

test('news response byte limits fail closed when a stream cannot be bounded', async () => {
  let buffered = false;
  const response = {
    headers: { get: () => null },
    body: {},
    async text() { buffered = true; return 'too large'; }
  };

  await assert.rejects(readBoundedResponseText(response, 4), /Streaming response body is required/);
  assert.equal(buffered, false);
});
