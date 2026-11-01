'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { makeInstagramParts, makeNarrativeSocialParts } = require('../utils/clip-maker');
const { isPlatformTargeted, isShortsTargeted, socialClipCaption } = require('../utils/platform-video-policy');

function sixMinuteScript(durations = Array(6).fill(60)) {
  const blocks = [
    { title: 'Abertura', text: 'Contexto inicial.' },
    { title: 'Parte editorial 1', text: 'Primeiro fato confirmado.' },
    { title: 'Parte editorial 2', text: 'Segundo fato confirmado.' },
    { title: 'Parte editorial 3', text: 'Terceiro fato confirmado.' },
    { title: 'Parte editorial 4', text: 'Quarto fato confirmado.' },
    { title: 'Conclusão', text: 'Fechamento com contexto.' }
  ];
  return {
    title: 'Uma pauta de seis minutos',
    hook: blocks[0].text,
    mainContent: { sections: blocks.slice(1, 5).map(({ title, text }) => ({ title, content: text })) },
    conclusion: { finalThought: blocks[5].text },
    timings: blocks.map(({ text }, index) => ({
      durationMs: durations[index] * 1000,
      sentences: [{ text, startMs: 0, durationMs: durations[index] * 1000 }]
    }))
  };
}

function xBoundaryFallbackScript() {
  const groupDurations = [50, 50, 139, 139, 139, 42.416];
  const makeSentence = (text, startSeconds, durationSeconds) => ({
    text,
    startMs: startSeconds * 1000,
    endMs: (startSeconds + durationSeconds) * 1000,
    durationMs: durationSeconds * 1000,
    words: text.split(/\s+/)
  });
  const texts = groupDurations.map((_, index) => `Bloco editorial ${index + 1} preserva a sequência.`);
  const blocks = [
    { title: 'Abertura', text: texts[0] },
    ...texts.slice(1, 5).map((text, index) => ({ title: `Seção ${index + 1}`, text })),
    { title: 'Conclusão', text: texts[5] }
  ];
  const timings = groupDurations.map((durationSeconds, index) => {
    const sentences = durationSeconds === 139
      ? [makeSentence(`${texts[index]} Continuação da mesma seção.`, 0, 70), makeSentence('Continuação da mesma seção.', 70, 69)]
      : [makeSentence(texts[index], 0, durationSeconds)];
    const joined = sentences.map(sentence => sentence.text).join(' ');
    if (durationSeconds === 139) blocks[index].text = joined;
    return { durationMs: durationSeconds * 1000, sentences };
  });
  return {
    title: 'Pauta para X com seção longa',
    hook: blocks[0].text,
    mainContent: { sections: blocks.slice(1, 5).map(({ title, text }) => ({ title, content: text })) },
    conclusion: { finalThought: blocks[5].text },
    timings
  };
}

async function withFixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'instagram-narrative-parts-'));
  const ttsDir = path.join(root, 'tts');
  const outDir = path.join(root, 'clips');
  await fs.mkdir(ttsDir, { recursive: true });
  for (let index = 0; index < 6; index += 1) {
    await fs.writeFile(path.join(ttsDir, `g${index}.mp3`), `audio-group-${index}`);
  }
  try {
    await run({ root, ttsDir, outDir });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('each later social part opens with the original context audio without speeding or losing body blocks', async () => {
  await withFixture(async ({ ttsDir, outDir }) => {
    const script = sixMinuteScript([4, 60, 60, 60, 60, 10]);
    const renderedDurations = new Map();
    const openings = [];
    const concatLists = [];
    const results = await makeNarrativeSocialParts({
      script, ttsDir, outDir, platforms: ['shorts'], maxDurationSeconds: 130,
      ffmpegRunner: async args => {
        concatLists.push(await fs.readFile(args[6], 'utf8'));
        await fs.writeFile(args.at(-1), 'concatenated audio fixture');
      },
      rendererFactory: () => ({ render: async ({ script: part, outputPath }) => {
        openings.push(part.timings[0].sentences[0].text);
        renderedDurations.set(outputPath, part.timings.reduce((sum, timing) => sum + timing.durationMs, 0) / 1000);
        await fs.writeFile(outputPath, 'video fixture');
      } }),
      mediaDurationReader: async filePath => renderedDurations.get(filePath)
    });
    assert.equal(results.length, 3);
    assert.deepEqual(openings, Array(3).fill(script.hook));
    assert(concatLists.every(list => list.split('\n')[0].includes('g0.mp3')));
    assert(results.every(part => part.durationSeconds <= 130 && part.durationSeconds >= 60));
  });
});

test('Instagram/TikTok narrative assembly preserves audio, section order, images and part labels', async () => {
  await withFixture(async ({ root, ttsDir, outDir }) => {
    const concatLists = [];
    const renders = [];
    const ffmpegRunner = async args => {
      assert.deepEqual(args.slice(0, 8), ['-y', '-f', 'concat', '-safe', '0', '-i', args[6], '-c']);
      const listPath = args[6];
      const outputPath = args.at(-1);
      concatLists.push(await fs.readFile(listPath, 'utf8'));
      await fs.writeFile(outputPath, 'concatenated narration');
    };
    const rendererFactory = options => ({
      render: async request => {
        renders.push({ options, request });
        await fs.writeFile(request.outputPath, 'fixture mp4');
      }
    });
    const results = await makeInstagramParts({
      script: sixMinuteScript(),
      images: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [index, {
        sources: [`/images/section-${index}.webp`, `/images/unused-${index}.webp`]
      }])),
      ttsDir,
      outDir,
      baseName: 'Caso / seis minutos',
      maxDurationSeconds: 175,
      rendererFactory,
      ffmpegRunner,
      mediaDurationReader: async () => 119.5
    });

    assert.equal(results.length, 3);
    assert.deepEqual(results.map(result => [result.partIndex, result.partCount, result.durationSeconds]), [
      [1, 3, 119.5], [2, 3, 119.5], [3, 3, 119.5]
    ]);
    assert(results.every(result => result.kind === 'instagram-narrative-part'));
    assert(results.every(result => result.platforms.join(',') === 'instagram,tiktok'));
    assert(results.every(result => isPlatformTargeted(result, 'instagram')));
    assert(results.every(result => isPlatformTargeted(result, 'tiktok')));
    assert(results.every(result => !isPlatformTargeted(result, 'kwai')));
    assert.equal(renders.length, 3);
    assert(renders.every(({ options }) => options.width === 1080 && options.height === 1920 && options.fps === 30));
    assert.deepEqual(renders.map(({ request }) => request.script.partIndicator), [
      { index: 1, count: 3 }, { index: 2, count: 3 }, { index: 3, count: 3 }
    ]);
    assert(renders.every(({ request }) => request.script.steadyNarrative === true));
    assert.deepEqual(renders.map(({ request }) => request.script.mainContent.sections.map(section => section.title)), [
      ['Abertura', 'Parte editorial 1'],
      ['Parte editorial 2', 'Parte editorial 3'],
      ['Parte editorial 4', 'Conclusão']
    ]);
    assert.deepEqual(renders.map(({ request }) => Object.values(request.images).map(image => image.sources[0])), [
      ['/images/section-0.webp', '/images/section-1.webp'],
      ['/images/section-2.webp', '/images/section-3.webp'],
      ['/images/section-4.webp', '/images/section-5.webp']
    ]);
    assert(renders.every(({ request }) => Object.values(request.images).every(image => image.sources.length === 2)),
      'all contextual section images reach the visual planner instead of being discarded');
    assert.deepEqual(concatLists.map(list => list.split('\n').map(line => path.basename(line.slice(7, -1)))), [
      ['g0.mp3', 'g1.mp3'], ['g2.mp3', 'g3.mp3'], ['g4.mp3', 'g5.mp3']
    ]);
    assert.match(socialClipCaption({ clip: results[0], platform: 'instagram' }), /^Parte 1\/3/);
    assert.match(socialClipCaption({ clip: results[1], platform: 'instagram' }), /^Parte 2\/3/);
    assert.match(socialClipCaption({ clip: results[0], platform: 'tiktok' }), /^Parte 1\/3/);
    assert.doesNotMatch(socialClipCaption({ clip: results[0], platform: 'instagram' }), /#shorts/);
    assert.doesNotMatch(socialClipCaption({ clip: results[0], platform: 'tiktok' }), /#shorts/);
    for (const result of results) {
      const partDir = path.dirname(result.path);
      await assert.rejects(fs.access(path.join(partDir, 'audio-concat.txt')));
      await assert.rejects(fs.access(path.join(partDir, 'narration.mp3')));
      await fs.access(result.path);
    }
    assert.equal(path.dirname(results[0].path), path.join(outDir, 'caso_seis_minutos_part1'));
    assert.equal(path.dirname(results[2].path), path.join(outDir, 'caso_seis_minutos_part3'));
    assert.equal(path.resolve(root).startsWith(path.resolve(os.tmpdir())), true);
  });
});

test('explanatory social mode preserves sourced scene visuals and enables narrative graphics', async () => {
  await withFixture(async ({ ttsDir, outDir }) => {
    const script = sixMinuteScript();
    const visual = {
      type: 'score-chart',
      title: 'Comparação ilustrativa',
      items: [{ label: 'Opção A', score: 4 }, { label: 'Opção B', score: 7 }]
    };
    script.mainContent.sections[0].visual = visual;
    const renders = [];
    await makeNarrativeSocialParts({
      script,
      ttsDir,
      outDir,
      platforms: ['shorts'],
      maxDurationSeconds: 130,
      visualMode: 'explanatory',
      ffmpegRunner: async args => fs.writeFile(args.at(-1), 'concatenated narration'),
      rendererFactory: () => ({ render: async request => {
        renders.push(request);
        await fs.writeFile(request.outputPath, 'fixture mp4');
      } }),
      mediaDurationReader: async () => 120
    });

    assert.ok(renders.length);
    assert(renders.every(request => request.script.minimal === false));
    assert(renders.every(request => request.script.explanatorySocial === true));
    assert.equal(renders[0].script.mainContent.sections.find(section => section.visual)?.visual.title, visual.title);
  });
});

test('the default divides a five-minute-forty-second explanation into two labeled 2m50s parts', async () => {
  await withFixture(async ({ ttsDir, outDir }) => {
    const renders = [];
    const ffmpegRunner = async args => fs.writeFile(args.at(-1), 'concatenated narration');
    const rendererFactory = () => ({
      render: async request => {
        renders.push(request);
        await fs.writeFile(request.outputPath, 'fixture mp4');
      }
    });

    const results = await makeInstagramParts({
      script: sixMinuteScript([10, 80, 80, 80, 80, 10]),
      ttsDir,
      outDir,
      rendererFactory,
      ffmpegRunner,
      mediaDurationReader: async () => 169.5
    });

    assert.equal(results.length, 2);
    assert.deepEqual(results.map(result => [result.partIndex, result.partCount, result.durationSeconds]), [
      [1, 2, 169.5], [2, 2, 169.5]
    ]);
    assert.equal(renders.length, 2);
    assert.deepEqual(renders.map(request => request.script.partIndicator), [
      { index: 1, count: 2 }, { index: 2, count: 2 }
    ]);
    assert.deepEqual(renders.map(request => request.script.mainContent.sections.map(section => section.title)), [
      ['Abertura', 'Parte editorial 1', 'Parte editorial 2'],
      ['Parte editorial 3', 'Parte editorial 4', 'Conclusão']
    ]);
  });
});

test('social narratives share renders when boundaries match and split separately for Kwai', async () => {
  await withFixture(async ({ ttsDir, outDir }) => {
    const renders = [];
    const results = await makeNarrativeSocialParts({
      script: sixMinuteScript(),
      ttsDir,
      outDir,
      rendererFactory: options => ({
        render: async request => {
          renders.push({ options, request });
          await fs.writeFile(request.outputPath, 'fixture mp4');
        }
      }),
      ffmpegRunner: async args => fs.writeFile(args.at(-1), 'concatenated narration'),
      mediaDurationReader: async outputPath => outputPath.includes(`${path.sep}kwai${path.sep}`)
        ? 180
        : outputPath.includes(`_part1${path.sep}`) ? 150 : 120
    });

    assert.equal(results.length, 5, 'three shared 2-minute parts plus two 3-minute Kwai parts');
    assert.equal(renders.length, 5);
    const sharedParts = results.filter(result => result.platforms.includes('instagram'));
    const kwaiParts = results.filter(result => result.platforms.includes('kwai'));
    assert.deepEqual(sharedParts.map(result => [result.partIndex, result.partCount, result.durationSeconds]), [
      [1, 3, 150], [2, 3, 120], [3, 3, 120]
    ]);
    assert(sharedParts.every(result => result.kind === 'social-narrative-part'));
    assert(sharedParts.every(result => ['instagram', 'tiktok', 'shorts'].every(platform => result.platforms.includes(platform))));
    assert(sharedParts.every(result => !result.platforms.includes('x')),
      'X is removed from the entire series when one part exceeds its duration cap');
    assert(sharedParts.every(result => isPlatformTargeted(result, 'instagram')));
    assert(sharedParts.every(result => isPlatformTargeted(result, 'tiktok')));
    assert(sharedParts.every(result => isPlatformTargeted(result, 'shorts') && isShortsTargeted(result)));
    assert.deepEqual(kwaiParts.map(result => [result.partIndex, result.partCount, result.durationSeconds]), [
      [1, 2, 180], [2, 2, 180]
    ]);
    assert(kwaiParts.every(result => result.platforms.join(',') === 'kwai'));
    assert(kwaiParts.every(result => isPlatformTargeted(result, 'kwai')));
    assert.match(socialClipCaption({ clip: sharedParts[0], platform: 'shorts' }), /^Parte 1\/3/);
    assert.match(socialClipCaption({ clip: kwaiParts[0], platform: 'kwai' }), /^Parte 1\/2/);
    assert(renders.every(({ options }) => options.width === 1080 && options.height === 1920 && options.fps === 30));
  });
});

test('X refines section boundaries to timed sentences when the 139-second cap cannot partition intact sections', async () => {
  await withFixture(async ({ ttsDir, outDir }) => {
    const script = xBoundaryFallbackScript();
    const renders = [];
    const audioSlices = [];
    const results = await makeNarrativeSocialParts({
      script,
      platforms: ['x'],
      ttsDir,
      outDir,
      rendererFactory: options => ({
        render: async request => {
          renders.push({ options, request });
          await fs.writeFile(request.outputPath, 'fixture mp4');
        }
      }),
      ffmpegRunner: async args => {
        if (args.includes('-ss')) audioSlices.push([path.basename(args[6]), Number(args[2]), Number(args[4])]);
        await fs.writeFile(args.at(-1), 'fixture audio');
      },
      mediaDurationReader: async () => renders.at(-1).request.script.timings
        .reduce((sum, timing) => sum + timing.durationMs, 0) / 1000
    });

    assert.equal(results.length, 5);
    assert.equal(renders.length, 5);
    assert(results.every(result => result.platforms.join(',') === 'x'));
    assert(results.every(result => result.durationSeconds >= 60 && result.durationSeconds <= 139));
    assert(results.every(result => result.kind === 'social-narrative-part'));
    const renderedText = renders.flatMap(({ request }) => request.script.mainContent.sections.map(section => section.content)).join(' ');
    const sourceText = [script.hook, ...script.mainContent.sections.map(section => section.content), script.conclusion.finalThought].join(' ');
    assert.equal(renderedText.replace(/\s+/g, ' ').trim(), sourceText.replace(/\s+/g, ' ').trim());
    assert.equal(Number(results.reduce((sum, result) => sum + result.durationSeconds, 0).toFixed(3)), 559.416);
    const slicesByGroup = new Map();
    for (const [groupFile, start, duration] of audioSlices) {
      if (!slicesByGroup.has(groupFile)) slicesByGroup.set(groupFile, []);
      slicesByGroup.get(groupFile).push([start, duration]);
    }
    for (const groupFile of ['g2.mp3', 'g3.mp3', 'g4.mp3']) {
      assert.deepEqual(slicesByGroup.get(groupFile).sort((left, right) => left[0] - right[0]), [[0, 70], [70, 69]]);
    }
  });
});

test('a section longer than one Reel is split on timed sentence boundaries without losing speech', async () => {
  await withFixture(async ({ ttsDir, outDir }) => {
    const phrases = [
      'A primeira frase apresenta o contexto com dados verificáveis.',
      'A segunda frase explica o que mudou para as pessoas envolvidas.',
      'A terceira frase compara os números disponíveis com o período anterior.',
      'A quarta frase mostra os limites da informação publicada até agora.',
      'A quinta frase conclui o ponto sem acrescentar afirmações sem fonte.'
    ];
    const longSection = phrases.join(' ');
    const timedSentences = phrases.map((text, index) => {
      const words = text.split(/\s+/);
      return {
        text,
        words,
        startMs: index * 40000,
        endMs: (index + 1) * 40000,
        durationMs: 40000,
        wordTimes: words.map((_, wordIndex) => wordIndex * 3000)
      };
    });
    const script = {
      title: 'Explicação completa',
      hook: 'Abertura com contexto.',
      mainContent: { sections: [{ title: 'Análise', content: longSection }] },
      conclusion: { finalThought: 'Fechamento com ressalva.' },
      timings: [
        { durationMs: 10000, sentences: [{ text: 'Abertura com contexto.', words: ['Abertura', 'com', 'contexto.'], startMs: 0, endMs: 10000, durationMs: 10000, wordTimes: [0, 100, 200] }] },
        { durationMs: 200000, sentences: timedSentences },
        { durationMs: 10000, sentences: [{ text: 'Fechamento com ressalva.', words: ['Fechamento', 'com', 'ressalva.'], startMs: 0, endMs: 10000, durationMs: 10000, wordTimes: [0, 100, 200] }] }
      ]
    };
    const slices = [];
    const concatLists = [];
    const renders = [];
    const ffmpegRunner = async args => {
      const outputPath = args.at(-1);
      if (args.includes('-ss')) {
        slices.push({
          start: Number(args[args.indexOf('-ss') + 1]),
          duration: Number(args[args.indexOf('-t') + 1]),
          input: args[args.indexOf('-i') + 1]
        });
      } else {
        concatLists.push(await fs.readFile(args[args.indexOf('-i') + 1], 'utf8'));
      }
      await fs.writeFile(outputPath, 'fixture audio');
    };
    const rendererFactory = () => ({
      render: async request => {
        renders.push(request);
        await fs.writeFile(request.outputPath, 'fixture mp4');
      }
    });

    const results = await makeInstagramParts({
      script,
      ttsDir,
      outDir,
      maxDurationSeconds: 179,
      rendererFactory,
      ffmpegRunner,
      mediaDurationReader: async () => renders.length === 1 ? 90 : 130
    });

    assert.deepEqual(results.map(result => [result.partIndex, result.partCount, result.durationSeconds]), [
      [1, 2, 90], [2, 2, 130]
    ]);
    assert.deepEqual(slices.map(slice => [slice.start, slice.duration, path.basename(slice.input)]), [
      [0, 40, 'g1.mp3'], [40, 40, 'g1.mp3'], [80, 40, 'g1.mp3'],
      [120, 40, 'g1.mp3'], [160, 40, 'g1.mp3']
    ]);
    assert.deepEqual(concatLists.map(list => list.split('\n').map(line => path.basename(line.slice(7, -1)))), [
      ['g0.mp3', 'audio-group-1-slice-2.mp3', 'audio-group-1-slice-3.mp3'],
      ['audio-group-1-slice-1.mp3', 'audio-group-1-slice-2.mp3', 'audio-group-1-slice-3.mp3', 'g2.mp3']
    ]);
    const renderedText = renders.flatMap(request => request.script.mainContent.sections.map(section => section.content)).join(' ');
    assert.equal(renderedText, `${script.hook} ${longSection} ${script.conclusion.finalThought}`);
    assert(renders.every(request => request.script.steadyNarrative === true));
    for (const result of results) {
      const partDir = path.dirname(result.path);
      await assert.rejects(fs.access(path.join(partDir, 'audio-concat.txt')));
      await assert.rejects(fs.access(path.join(partDir, 'narration.mp3')));
      assert.deepEqual((await fs.readdir(partDir)).filter(file => file.includes('-slice-')), []);
    }
  });
});

test('a nine-second item is not produced as an Instagram/TikTok narrative post', async () => {
  await withFixture(async ({ ttsDir, outDir }) => {
    const results = await makeInstagramParts({
      script: sixMinuteScript([9, 0.1, 0.1, 0.1, 0.1, 0.1]),
      ttsDir,
      outDir,
      rendererFactory: () => ({ render: async () => assert.fail('short narrative must be rejected before render') }),
      ffmpegRunner: async () => assert.fail('short narrative must be rejected before audio assembly'),
      mediaDurationReader: async () => 9
    });
    assert.deepEqual(results, []);
  });
});

test('Instagram part exceeding the measured duration target is removed and temporary audio is cleaned', async () => {
  await withFixture(async ({ ttsDir, outDir }) => {
    let attemptedOutput;
    const ffmpegRunner = async args => fs.writeFile(args.at(-1), 'concatenated narration');
    const rendererFactory = () => ({
      render: async ({ outputPath }) => {
        attemptedOutput = outputPath;
        await fs.writeFile(outputPath, 'oversized fixture mp4');
      }
    });

    await assert.rejects(makeInstagramParts({
      script: sixMinuteScript(),
      ttsDir,
      outDir,
      maxDurationSeconds: 180,
      rendererFactory,
      ffmpegRunner,
      mediaDurationReader: async () => 180.01
    }), /renderizada acima do limite/);
    assert.ok(attemptedOutput);
    await assert.rejects(fs.access(attemptedOutput));
    const partDir = path.dirname(attemptedOutput);
    await assert.rejects(fs.access(path.join(partDir, 'audio-concat.txt')));
    await assert.rejects(fs.access(path.join(partDir, 'narration.mp3')));
  });
});
