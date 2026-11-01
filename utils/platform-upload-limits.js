'use strict';

const { INSTAGRAM_APP_MAX_SECONDS } = require('./platform-video-policy');

const X_ANDROID_STANDARD_MAX_SECONDS = 140;
const X_ANDROID_PREMIUM_MAX_SECONDS = 10 * 60;
const YOUTUBE_UNVERIFIED_MAX_SECONDS = 15 * 60;
const YOUTUBE_VERIFIED_MAX_SECONDS = 12 * 60 * 60;
const YOUTUBE_SHORTS_MAX_SECONDS = 3 * 60;
const TELEGRAM_ANDROID_STANDARD_MAX_BYTES = 2 * 1024 ** 3;
const TELEGRAM_ANDROID_PREMIUM_MAX_BYTES = 4 * 1024 ** 3;

const VIDEO_LIMIT_ENV = Object.freeze({
  youtube: 'YT_MAX_VIDEO_SECONDS',
  tiktok: 'SOCIAL_TIKTOK_MAX_SECONDS',
  kwai: 'SOCIAL_KWAI_MAX_SECONDS',
  instagram: 'SOCIAL_INSTAGRAM_APP_MAX_SECONDS',
  x: 'X_MAX_VIDEO_SECONDS'
});

const VIDEO_LIMIT_DEFAULTS = Object.freeze({
  // Accounts without verified uploads are limited to 15 minutes by YouTube.
  youtube: YOUTUBE_UNVERIFIED_MAX_SECONDS,
  shorts: YOUTUBE_SHORTS_MAX_SECONDS,
  // Local conservative/operator caps; current Android app acceptance is not verified.
  tiktok: 180,
  kwai: 300,
  instagram: INSTAGRAM_APP_MAX_SECONDS,
  x: X_ANDROID_STANDARD_MAX_SECONDS
});

function positiveConfiguredNumber(env, name, fallback) {
  const raw = env?.[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function platformVideoLimitSeconds(platform, env = process.env) {
  if (platform === 'shorts') return YOUTUBE_SHORTS_MAX_SECONDS;
  const name = VIDEO_LIMIT_ENV[platform];
  if (!name) return null;
  const configured = positiveConfiguredNumber(env, name, VIDEO_LIMIT_DEFAULTS[platform]);
  // Longer YouTube uploads require account verification and are capped at
  // the documented 12-hour maximum. The default remains the unverified cap.
  if (platform === 'youtube') return Math.floor(Math.min(configured, YOUTUBE_VERIFIED_MAX_SECONDS));
  // The active X publisher is the Android app. Premium's Android cap is ten
  // minutes; web/iOS's longer allowance must not leak into this route.
  if (platform === 'x') return Math.min(configured, X_ANDROID_PREMIUM_MAX_SECONDS);
  if (platform === 'instagram') return Math.min(configured, INSTAGRAM_APP_MAX_SECONDS);
  return configured;
}

function telegramFileLimitBytes(env = process.env) {
  const configured = positiveConfiguredNumber(env, 'SOCIAL_TELEGRAM_MAX_BYTES', TELEGRAM_ANDROID_STANDARD_MAX_BYTES);
  // 4 GB is only available with Premium; any configured value is capped here.
  return Math.floor(Math.min(configured, TELEGRAM_ANDROID_PREMIUM_MAX_BYTES));
}

function isWithinFileSizeLimit(sizeBytes, limitBytes) {
  return Number.isSafeInteger(sizeBytes) && sizeBytes >= 0
    && Number.isSafeInteger(limitBytes) && limitBytes > 0
    && sizeBytes <= limitBytes;
}

module.exports = {
  TELEGRAM_ANDROID_PREMIUM_MAX_BYTES,
  TELEGRAM_ANDROID_STANDARD_MAX_BYTES,
  VIDEO_LIMIT_DEFAULTS,
  YOUTUBE_SHORTS_MAX_SECONDS,
  YOUTUBE_UNVERIFIED_MAX_SECONDS,
  YOUTUBE_VERIFIED_MAX_SECONDS,
  X_ANDROID_PREMIUM_MAX_SECONDS,
  X_ANDROID_STANDARD_MAX_SECONDS,
  isWithinFileSizeLimit,
  platformVideoLimitSeconds,
  telegramFileLimitBytes
};
