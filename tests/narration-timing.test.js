'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildGroupTimings, expandEdgeTtsBoundaryEvents, partitionNarrationCues,
  summarizeNarrationTimings, timingAlignment } = require('../utils/narration-timing');

test('one sparse missing metadata span uses its real event duration and is explicitly mixed alignment', () => {
  const expected = Array.from({ length: 200 }, (_, i) => `palavra${i}`);
  const events = expected.filter((_word, i) => i < 100 || i > 103)
    .map((text, i) => ({ text, startMs: i * 800, endMs: i * 800 + 700 }));
  const result = expandEdgeTtsBoundaryEvents(events, expected.join(' '));
  assert.equal(result.alignment, 'edge-tts-word-boundary-mixed');
  assert.equal(result.recoveredMissingWordCount, 4);
  assert.equal(result.words.length, 200);
  assert(result.words.slice(100, 105).every(w => w.interpolatedMissingBoundary));
  assert.deepEqual(result.words.map(w => w.text), expected);
  assert.equal(result.words[100].startMs, events[100].startMs);
  assert.equal(result.words[104].endMs, events[100].endMs);
  const tooShort = events.map((event, i) => i === 100 ? { ...event, endMs: event.startMs + 100 } : event);
  assert.throws(() => expandEdgeTtsBoundaryEvents(tooShort, expected.join(' ')), /não correspondem/);
  const wrong = events.map((event, i) => i === 150 ? { ...event, text: 'outra' } : event);
  assert.throws(() => expandEdgeTtsBoundaryEvents(wrong, expected.join(' ')), /não correspondem/);
  assert.throws(() => expandEdgeTtsBoundaryEvents(events.slice(0, 20), expected.join(' ')), /não correspondem/);
});

test('marca cues de legenda como interpolação, não como alinhamento exato por palavra', () => {
  const cues = [
    { startMs: 0, endMs: 800, text: 'O sono muda.' },
    { startMs: 900, endMs: 1800, text: 'O estudo descreve um limite.' }
  ];
  const result = buildGroupTimings('O sono muda. O estudo descreve um limite.', cues, 2000, 'edge-tts');
  assert.equal(result.provider, 'edge-tts');
  assert.equal(result.alignment, 'subtitle-cues-interpolated');
  assert.equal(result.sentences.length, 2);
  assert.equal(result.cueCount, 2);
  assert.deepEqual(result.sentences[0].words, ['O', 'sono', 'muda.']);
});

test('marca cue único de gTTS como estimativa uniforme', () => {
  const text = 'Uma frase inteira fica neste cue.';
  const cues = [{ startMs: 0, endMs: 2400, text }];
  const result = buildGroupTimings(text, cues, 2400, 'gtts');
  assert.equal(result.provider, 'gtts');
  assert.equal(result.alignment, 'uniform-estimate');
  assert.equal(result.durationMs, 2400);
});

test('particiona uma única narração por grupos preservando os tempos absolutos e relativos', () => {
  const groups = [{ text: 'O gelo flutua.' }, { text: 'A rede fica mais aberta.' }];
  const cues = [
    { startMs: 50, endMs: 1200, text: 'O gelo flutua.' },
    { startMs: 1500, endMs: 3200, text: 'A rede fica mais aberta.' }
  ];
  const parts = partitionNarrationCues(groups, cues);
  assert.equal(parts[0].audioOffsetMs, 50);
  assert.equal(parts[1].audioOffsetMs, 1500);
  assert.equal(parts[0].durationMs, 1150);
  assert.equal(parts[1].durationMs, 1700);
  assert.equal(parts[1].cues[0].startMs, 0);
  assert.equal(buildGroupTimings(groups[1].text, parts[1].cues, parts[1].durationMs, 'edge-tts').alignment,
    'subtitle-cues-interpolated');
});

test('particiona cues que atravessam mais de um grupo sem deslocar a locução', () => {
  const groups = [{ text: 'Por que o gelo flutua?' }, { text: 'A água se expande.' }];
  const parts = partitionNarrationCues(groups, [
    { startMs: 0, endMs: 2400, text: 'Por que o gelo flutua? A água se expande.' }
  ]);
  assert.equal(parts[0].audioOffsetMs, 0);
  assert.equal(parts[1].audioOffsetMs, 1333);
  assert.equal(parts[1].cues.map(cue => cue.text).join(' '), 'A água se expande.');
});

test('ignora pontuação tipográfica isolada que o SRT não transforma em palavra falada', () => {
  const groups = [{ text: 'A primeira frase.' }, { text: '“ A segunda frase.' }];
  const parts = partitionNarrationCues(groups, [
    { startMs: 0, endMs: 900, text: 'A primeira frase.' },
    { startMs: 900, endMs: 1800, text: 'A segunda frase.' }
  ]);
  assert.equal(parts.length, 2);
  assert.equal(parts[1].audioOffsetMs, 900);
  assert.equal(parts[1].cues.map(cue => cue.text).join(' '), 'A segunda frase.');
});

test('preserva limites reais por palavra do Edge TTS, inclusive palavras curtas', () => {
  const groups = [{ text: '4 GPUs para prefill' }, { text: '64 para decode' }];
  const cues = [
    { startMs: 100, endMs: 200, text: '4' },
    { startMs: 220, endMs: 390, text: 'GPUs' },
    { startMs: 410, endMs: 470, text: 'para' },
    { startMs: 480, endMs: 800, text: 'prefill' },
    { startMs: 900, endMs: 940, text: '64' },
    { startMs: 950, endMs: 1000, text: 'para' },
    { startMs: 1010, endMs: 1400, text: 'decode' }
  ];
  const parts = partitionNarrationCues(groups, cues, 'edge-tts-word-boundary');
  assert.equal(parts[0].alignment, 'edge-tts-word-boundary');
  assert.equal(parts[1].audioOffsetMs, 900);
  assert.deepEqual(parts[0].cues.map(({ startMs, endMs }) => [startMs, endMs]), [
    [0, 100], [120, 290], [310, 370], [380, 700]
  ]);
  const timings = buildGroupTimings(groups[0].text, parts[0].cues, parts[0].durationMs, 'edge-tts', parts[0].alignment);
  assert.equal(timings.alignment, 'edge-tts-word-boundary');
  assert.deepEqual(timings.sentences[0].wordTimes, [0, 120, 310, 380]);
  assert.deepEqual(timings.sentences[0].wordEndTimes, [100, 290, 370, 700]);
});

test('divide eventos Edge TTS que agrupam duas palavras e identifica o alinhamento misto', () => {
  const text = 'Em 2021 ele escolheu';
  const result = expandEdgeTtsBoundaryEvents([
    { text: 'Em', startMs: 0, endMs: 150 },
    { text: '2021 ele', startMs: 160, endMs: 860 },
    { text: 'escolheu', startMs: 900, endMs: 1400 }
  ], text);
  assert.equal(result.alignment, 'edge-tts-word-boundary-mixed');
  assert.deepEqual(result.words.map(word => word.text), text.split(' '));
  assert.deepEqual(result.words.map(word => Boolean(word.splitFromCombinedBoundary)), [false, true, true, false]);
  assert.ok(result.words[1].startMs < result.words[1].endMs);
  assert.ok(result.words[1].endMs <= result.words[2].startMs + 0.001);
  const partitions = partitionNarrationCues([{ text }], result.words.map(word => ({
    text: word.text, startMs: word.startMs, endMs: word.endMs
  })), result.alignment);
  const timings = buildGroupTimings(text, partitions[0].cues, partitions[0].durationMs,
    'edge-tts', partitions[0].alignment);
  assert.equal(timings.alignment, 'edge-tts-word-boundary-mixed');
  assert.equal(timings.sentences[0].words.length, 4);
});

test('recusa eventos Edge TTS agrupados quando os tokens deixam de corresponder ao texto', () => {
  assert.throws(() => expandEdgeTtsBoundaryEvents([
    { text: 'Em dois mil', startMs: 0, endMs: 500 }
  ], 'Em 2021'), /não correspondem ao texto narrado/);
});

test('interrompe o alinhamento quando o texto falado não corresponde ao roteiro', () => {
  assert.throws(() => partitionNarrationCues(
    [{ text: 'O gelo flutua.' }],
    [{ startMs: 0, endMs: 1000, text: 'A água congela.' }]
  ), /não corresponde ao grupo 1/);
});

test('usa estimativa uniforme quando as legendas não correspondem à fala-fonte', () => {
  const cues = [{ startMs: 0, endMs: 700, text: 'Texto resumido.' }, { startMs: 700, endMs: 1500, text: 'Outra legenda.' }];
  assert.equal(timingAlignment('A fala fonte é diferente.', cues), 'uniform-estimate');
});

test('preserva grupos vazios sem criar palavras ou timestamps fictícios', () => {
  const result = buildGroupTimings('', [], 500, 'unknown');
  assert.equal(result.sentences.length, 0);
  assert.equal(result.alignment, 'uniform-estimate');
});

test('resume provider, método de alinhamento, duração e quantidade de cues sem guardar a fala', () => {
  const summary = summarizeNarrationTimings([
    { provider: 'edge-tts', alignment: 'subtitle-cues-interpolated', durationMs: 2400, cueCount: 3 },
    { provider: 'gtts', alignment: 'uniform-estimate', durationMs: 1800, cueCount: 1 },
    { provider: 'edge-tts', alignment: 'uniform-estimate', durationMs: 1200, cueCount: 0 }
  ]);
  assert.deepEqual(summary, {
    groupCount: 3,
    totalDurationMs: 5400,
    subtitleCueCount: 4,
    providers: { 'edge-tts': 2, gtts: 1 },
    alignments: { 'subtitle-cues-interpolated': 1, 'uniform-estimate': 2 },
    voiceContinuity: { status: 'mixed', providers: ['edge-tts', 'gtts'] }
  });
  assert.equal(JSON.stringify(summary).includes('fala'), false);
});

test('confirma continuidade quando todos os grupos vêm do mesmo provedor', () => {
  const summary = summarizeNarrationTimings([
    { provider: 'edge-tts', alignment: 'word-boundary', durationMs: 1200, cueCount: 8 },
    { provider: 'edge-tts', alignment: 'word-boundary', durationMs: 2300, cueCount: 14 }
  ]);
  assert.deepEqual(summary.voiceContinuity, { status: 'consistent', provider: 'edge-tts' });
});

test('não considera grupos sem provedor comprovado como uma voz contínua', () => {
  const summary = summarizeNarrationTimings([
    { provider: 'edge-tts', alignment: 'word-boundary', durationMs: 1200, cueCount: 8 },
    { provider: 'unknown', alignment: 'uniform-estimate', durationMs: 2300, cueCount: 1 }
  ]);
  assert.deepEqual(summary.voiceContinuity, { status: 'unverified', providers: ['edge-tts'] });
});
