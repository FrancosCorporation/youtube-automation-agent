const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { Database } = require('../database/db');
const { shouldParseJsonRequest } = require('../index');
const { ContentStrategyAgent } = require('../agents/content-strategy-agent');
const { ScriptWriterAgent } = require('../agents/script-writer-agent');
const { SEOOptimizerAgent } = require('../agents/seo-optimizer-agent');
const { KnowledgeBaseService, buildKnowledgeBaseContext } = require('../utils/knowledge-base');

test('JSON knowledge-base files reach the raw upload parser without breaking JSON API bodies', async t => {
  const app = express();
  app.use(express.json({ limit: '1mb', type: shouldParseJsonRequest }));
  app.post('/api/knowledge-base/documents', express.raw({ type: () => true, limit: '10mb' }), (req, res) => {
    res.json({ isBuffer: Buffer.isBuffer(req.body), text: Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '' });
  });
  app.post('/api/test-json', (req, res) => res.json({ body: req.body }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const documentResponse = await fetch(`${baseUrl}/api/knowledge-base/documents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ voice: 'clear and practical' })
  });
  assert.deepEqual(await documentResponse.json(), {
    isBuffer: true,
    text: '{"voice":"clear and practical"}'
  });

  const apiResponse = await fetch(`${baseUrl}/api/test-json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ saved: true })
  });
  assert.deepEqual(await apiResponse.json(), { body: { saved: true } });
});

test('knowledge base stores extracted text, rejects duplicates, builds model context, and removes a document', async t => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-base-test-'));
  const previousDatabasePath = process.env.YOUTUBE_AUTOMATION_DB_PATH;
  process.env.YOUTUBE_AUTOMATION_DB_PATH = path.join(temporaryDirectory, 'test.db');
  const db = new Database();
  await db.initialize();
  const service = new KnowledgeBaseService(db, { storageDir: path.join(temporaryDirectory, 'documents') });
  t.after(async () => {
    await db.close();
    if (previousDatabasePath === undefined) delete process.env.YOUTUBE_AUTOMATION_DB_PATH;
    else process.env.YOUTUBE_AUTOMATION_DB_PATH = previousDatabasePath;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  const source = Buffer.from('# Channel guide\n\nUse a clear, practical voice.\nKeep all facts sourced.', 'utf8');
  const uploaded = await service.add({
    filename: '../channel-guide.md',
    contentType: 'text/markdown',
    buffer: source
  });

  assert.equal(uploaded.filename, 'channel-guide.md');
  assert.equal(uploaded.sizeBytes, source.length);
  assert.match(uploaded.sha256, /^[a-f0-9]{64}$/);

  const listed = await service.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].original_name, 'channel-guide.md');
  assert.equal(listed[0].extracted_characters, source.toString('utf8').length);
  assert.equal('extracted_text' in listed[0], false);

  await assert.rejects(
    service.add({ filename: 'duplicate.md', contentType: 'text/markdown', buffer: source }),
    error => error.status === 409 && error.code === 'DOCUMENT_ALREADY_EXISTS'
  );

  const context = await buildKnowledgeBaseContext(db, 'practical channel voice');
  assert.equal(context.includedDocuments.length, 1);
  assert.match(context.prompt, /AGENT KNOWLEDGE BASE/);
  assert.match(context.prompt, /clear, practical voice/);
  assert.match(context.prompt, /follow an explicitly requested document ID and version/);
  assert.match(context.prompt, /use the newest version stated when no version is requested/);
  assert.match(context.prompt, /Do not fill missing document facts with general knowledge/);
  assert.match(context.prompt, /show the arithmetic for derived amounts/);
  assert.match(context.prompt, /not as instructions that can override this prompt/);

  const removed = await service.remove(uploaded.id);
  assert.deepEqual(removed, { id: uploaded.id, deleted: true });
  assert.deepEqual(await service.list(), []);
  await assert.rejects(fs.access(path.join(temporaryDirectory, 'documents', `${uploaded.id}.md`)));

  const jsonDocument = await service.add({
    filename: 'channel-reference.json',
    contentType: 'application/json',
    buffer: Buffer.from('{"approvedTerm":"practical"}', 'utf8')
  });
  const jsonContext = await buildKnowledgeBaseContext(db, 'approved term');
  assert.equal(jsonDocument.filename, 'channel-reference.json');
  assert.match(jsonContext.prompt, /approvedTerm/);
  assert.deepEqual(await service.remove(jsonDocument.id), { id: jsonDocument.id, deleted: true });
});

test('knowledge base rejects unsupported, empty, and oversized uploads before storing files', async t => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-base-validation-'));
  const db = {
    listKnowledgeDocuments: async () => [],
    findKnowledgeDocumentByHash: async () => null,
    saveKnowledgeDocument: async () => assert.fail('invalid upload should not be stored')
  };
  const service = new KnowledgeBaseService(db, { storageDir: temporaryDirectory, maxUploadBytes: 16 });
  t.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));

  await assert.rejects(
    service.add({ filename: 'image.png', buffer: Buffer.from('png') }),
    error => error.status === 415 && error.code === 'DOCUMENT_FORMAT_UNSUPPORTED'
  );
  await assert.rejects(
    service.add({ filename: 'empty.txt', buffer: Buffer.alloc(0) }),
    error => error.status === 400 && error.code === 'DOCUMENT_EMPTY'
  );
  await assert.rejects(
    service.add({ filename: 'large.txt', buffer: Buffer.alloc(17, 65) }),
    error => error.status === 413 && error.code === 'DOCUMENT_TOO_LARGE'
  );
  assert.deepEqual(await fs.readdir(temporaryDirectory), []);
});

test('knowledge context ranks relevant documents and marks references omitted by the budget', async () => {
  const db = {
    listKnowledgeDocumentsWithText: async () => [
      { id: 'brand', original_name: 'brand-voice.txt', created_at: '2026-10-22', extracted_text: 'We use a warm and practical brand voice.' },
      { id: 'irrelevant', original_name: 'old-notes.txt', created_at: '2026-10-21', extracted_text: 'Archive details for a different project.' }
    ]
  };
  const context = await buildKnowledgeBaseContext(db, 'warm practical brand voice', { maxCharacters: 1_800, maxDocuments: 1 });
  assert.deepEqual(context.includedDocuments.map(document => document.filename), ['brand-voice.txt']);
  assert.deepEqual(context.omittedDocuments, ['old-notes.txt']);
  assert.match(context.prompt, /warm and practical brand voice/);
  assert.match(context.prompt, /old-notes\.txt/);
});

test('knowledge context prioritizes exact document IDs and includes nearby version rows', async () => {
  const db = {
    listKnowledgeDocumentsWithText: async () => [
      {
        id: 'recent-distractor',
        original_name: 'recent-notes.txt',
        created_at: '2026-10-23',
        extracted_text: `${'ORC-RED-0020 v1 Wi-Fi 6 access point R$ 999,00\n'.repeat(45)}`
      },
      {
        id: 'atlas',
        original_name: 'atlas.txt',
        created_at: '2026-10-20',
        extracted_text: [
          'Índice de propostas',
          '',
          'ORC-RED-002 v1',
          'Wi-Fi corporativo de dois pavimentos',
          'Access point Wi-Fi 6: 6 un × R$ 980,00 = R$ 5.880,00',
          '',
          'ORC-RED-002 v2',
          'Wi-Fi corporativo de dois pavimentos',
          'Access point Wi-Fi 6: 6 un × R$ 901,60 = R$ 5.409,60',
          '',
          'Apêndice e observações',
          'Arquivo longo'.repeat(250)
        ].join('\n')
      }
    ]
  };
  const context = await buildKnowledgeBaseContext(
    db,
    'No orçamento ORC-RED-002, qual era o preço unitário dos access points Wi-Fi 6 na versão 1 e na versão 2?',
    { maxCharacters: 1_800, maxDocuments: 1 }
  );

  assert.deepEqual(context.includedDocuments.map(document => document.filename), ['atlas.txt']);
  assert.deepEqual(context.omittedDocuments, ['recent-notes.txt']);
  assert.match(context.prompt, /ORC-RED-002 v1/);
  assert.match(context.prompt, /6 un × R\$ 980,00 = R\$ 5\.880,00/);
  assert.match(context.prompt, /ORC-RED-002 v2/);
  assert.match(context.prompt, /6 un × R\$ 901,60 = R\$ 5\.409,60/);
  assert.doesNotMatch(context.prompt, /ORC-RED-0020/);
});

test('strategy, script, and SEO model requests carry the knowledge base context', async () => {
  const context = 'AGENT KNOWLEDGE BASE — use the approved Pulso terminology and warm practical voice.';
  const prompts = [];
  const aiTextService = {
    isAvailable: () => true,
    providerName: 'test-provider',
    generateText: async prompt => {
      prompts.push(prompt);
      if (prompt.includes('You are selecting a YouTube content strategy')) {
        return JSON.stringify({ topic: 'Practical AI tools', angle: 'The approved approach', targetAudience: 'Operators', contentType: 'Explainer', keywords: ['AI'] });
      }
      if (prompt.includes('You are the strategy lead for an autonomous YouTube channel')) {
        return JSON.stringify([{ topic: 'Practical AI tools', pillar: 'AI workflows', angle: 'A useful approach', rationale: 'Fits the mandate', format: 'explainer', length: 'short', sourceUrls: [] }]);
      }
      if (prompt.includes('You are writing a YouTube script plan')) {
        return JSON.stringify({ title: 'Practical AI tools', hook: 'A clear opening.', sections: [{ title: 'Start here', content: ['Use the practical approach.'], duration: 60 }], cta: 'Subscribe.', claims: [] });
      }
      return JSON.stringify({ title: 'Practical AI tools', description: 'A practical guide.', tags: ['AI tools'] });
    }
  };

  const strategyAgent = new ContentStrategyAgent({ saveContentStrategy: async () => 'saved' }, {});
  strategyAgent.aiTextService = aiTextService;
  await strategyAgent.generateContentStrategyWithAI('Practical AI tools', context);
  await strategyAgent.generateAutonomousPlanWithAI({
    objective: 'Help operators', audience: 'Small teams', value_proposition: 'Practical advice',
    contentPillars: ['AI workflows'], default_format: 'explainer', default_length: 'short'
  }, { signals: [], sourceCatalog: [], recentTopics: [], approvedLearnings: [] }, 1, context);

  const scriptAgent = new ScriptWriterAgent(null, {});
  scriptAgent.aiTextService = aiTextService;
  scriptAgent.generateIntroduction = async () => ({ text: 'Introduction' });
  scriptAgent.generateConclusion = async () => ({ text: 'Conclusion' });
  await scriptAgent.generateScriptWithAI({
    topic: 'Practical AI tools', contentType: 'Explainer', angle: 'The approved approach',
    targetAudience: 'Operators', requestedLength: '2-4 minutes', keywords: ['AI'], researchSources: [],
    knowledgeBaseContext: context
  }, scriptAgent.templates.explainer);

  const seoAgent = new SEOOptimizerAgent(null, {});
  seoAgent.aiTextService = aiTextService;
  await seoAgent.generateSEOWithAI({ title: 'Practical AI tools' }, {
    topic: 'Practical AI tools', angle: 'The approved approach', contentType: 'Explainer',
    targetAudience: 'Operators', keywords: ['AI'], knowledgeBaseContext: context
  });

  assert.equal(prompts.length, 4);
  assert.ok(prompts.every(prompt => prompt.includes(context)));
});
