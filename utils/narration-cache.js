'use strict';

const crypto = require('node:crypto');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function narrationInputHash(text, {
  voice = 'pt-BR-FranciscaNeural', provider = 'auto', rate = '0%', pitch = '0Hz'
} = {}) {
  return sha256(JSON.stringify({ revision: 3, text: String(text), voice, provider, rate, pitch }));
}

function narrationCacheMetadata({ inputHash, provider, audio, subtitles, wordTimings }) {
  return { version: 3, provider, inputSha256: inputHash,
    audioSha256: sha256(audio), subtitlesSha256: sha256(subtitles),
    wordTimingsSha256: sha256(wordTimings) };
}

function narrationCacheMatches(metadata, { inputHash, audio, subtitles, wordTimings }) {
  return metadata?.version === 3 && ['edge-tts', 'gtts'].includes(metadata.provider)
    && metadata.inputSha256 === inputHash && Buffer.isBuffer(audio) && audio.length > 1000
    && Buffer.isBuffer(subtitles) && subtitles.length > 20
    && Buffer.isBuffer(wordTimings) && wordTimings.length > 20
    && narrationCacheArtifactsMatch(metadata, { audio, subtitles, wordTimings });
}

function narrationCacheArtifactsMatch(metadata, { audio, subtitles, wordTimings }) {
  return metadata?.version === 3 && ['edge-tts', 'gtts'].includes(metadata.provider)
    && Buffer.isBuffer(audio) && audio.length > 1000
    && Buffer.isBuffer(subtitles) && subtitles.length > 20
    && Buffer.isBuffer(wordTimings) && wordTimings.length > 20
    && metadata.audioSha256 === sha256(audio) && metadata.subtitlesSha256 === sha256(subtitles)
    && metadata.wordTimingsSha256 === sha256(wordTimings);
}

module.exports = { narrationInputHash, narrationCacheMetadata, narrationCacheMatches, narrationCacheArtifactsMatch };
