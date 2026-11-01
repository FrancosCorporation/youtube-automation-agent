#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { ImageLibrary } = require('../utils/image-library');

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    directory: { type: 'string' }, theme: { type: 'string' }, topic: { type: 'string' },
    section: { type: 'string' }, 'source-title': { type: 'string' }, 'source-url': { type: 'string' },
    generator: { type: 'string' }, unused: { type: 'boolean' }, limit: { type: 'string' }, out: { type: 'string' }
  } });
  const [command, ...args] = positionals;
  if (!['archive', 'search', 'stats', 'export'].includes(command)) {
    throw new Error('Uso: npm run images:library -- archive <imagens> --theme <tema> --topic <assunto> | search <termos> --theme <tema> [--unused] | stats | export <id> --out <arquivo>');
  }
  const library = new ImageLibrary({ directory: values.directory });
  try {
    await library.initialize();
    if (command === 'stats') console.log(JSON.stringify(await library.stats(), null, 2));
    if (command === 'search') console.log(JSON.stringify(await library.search({
      theme: values.theme, query: args.join(' '), unusedOnly: values.unused, limit: values.limit
    }), null, 2));
    if (command === 'archive') {
      if (!args.length) throw new Error('Informe as imagens para arquivar');
      for (const imagePath of args) console.log(JSON.stringify(await library.archive({
        imagePath, theme: values.theme, topic: values.topic, sectionTitle: values.section,
        sourceTitle: values['source-title'], sourceUrl: values['source-url'], generator: values.generator
      })));
    }
    if (command === 'export') {
      if (!args[0] || !values.out) throw new Error('Informe o id e --out');
      const record = await library.get(args[0]);
      if (!record) throw new Error('Imagem não encontrada');
      if (!new Set([record.format === 'jpeg' ? '.jpg' : `.${record.format}`, ...(record.format === 'jpeg' ? ['.jpeg'] : [])])
        .has(path.extname(values.out).toLowerCase())) throw new Error(`A saída deve usar o formato ${record.format}`);
      await fs.mkdir(path.dirname(path.resolve(values.out)), { recursive: true });
      await fs.copyFile(record.filePath, values.out, fs.constants.COPYFILE_EXCL);
      console.log(JSON.stringify({ id: record.id, path: path.resolve(values.out), reviewRequired: true }));
    }
  } finally { await library.close(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { main };
