'use strict';

const SAFE_ERROR_CODES = new Set([
  'GEMINI_WEB_NOT_LOGGED_IN',
  'Gemini web editor not ready for the prompt',
  'Gemini web did not return a generated image in time',
  'Gemini web returned an invalid image',
  'Gemini web image extraction failed (blob)',
  'screenshot em branco (página não renderizou)',
  'GEMINI_ANDROID_PROVIDER_DISABLED',
  'GEMINI_ANDROID_DEVICE_NOT_READY',
  'GEMINI_ANDROID_FIREFOX_MISSING',
  'GEMINI_ANDROID_BROWSER_MISSING',
  'GEMINI_ANDROID_BROWSER_PACKAGE_INVALID',
  'GEMINI_ANDROID_LOGIN_REQUIRED',
  'GEMINI_ANDROID_LOGIN_EXPIRED',
  'GEMINI_ANDROID_APP_ANR',
  'GEMINI_ANDROID_EDITOR_NOT_READY',
  'GEMINI_ANDROID_UI_UNAVAILABLE',
  'GEMINI_ANDROID_INPUT_METHOD_NOT_ACTIVE',
  'GEMINI_ANDROID_TEXT_INPUT_FAILED',
  'GEMINI_ANDROID_PROMPT_INPUT_FAILED',
  'GEMINI_ANDROID_GENERATION_FAILED',
  'GEMINI_ANDROID_GENERATION_TIMEOUT',
  'GEMINI_ANDROID_CDP_IMAGE_TIMEOUT',
  'GEMINI_ANDROID_DOWNLOAD_CONFIRMATION_MISSING',
  'GEMINI_ANDROID_DOWNLOADED_FILE_MISSING',
  'GEMINI_ANDROID_IMAGE_INVALID',
  'GEMINI_ANDROID_IMAGE_ASPECT_MISMATCH',
  'GEMINI_ANDROID_OPEN_FAILED',
  'GEMINI_ANDROID_EDITOR_FAILED',
  'GEMINI_ANDROID_DOWNLOAD_SCAN_FAILED',
  'GEMINI_ANDROID_PROMPT_FAILED',
  'GEMINI_ANDROID_GENERATE_FAILED',
  'GEMINI_ANDROID_DOWNLOAD_FAILED',
  'GEMINI_ANDROID_TRANSFER_FAILED',
  'GEMINI_ANDROID_VALIDATE_FAILED',
  'GEMINI_ANDROID_SAVE_FAILED',
  'SCRIPT_GENERATION_UNAVAILABLE',
  'Limites de palavra do Edge TTS não correspondem à narração; sincronização cancelada'
]);

const SAFE_ERROR_TAGS = new Map([
  ['GEMINI_WEB_NOT_LOGGED_IN', 'gemini_not_logged_in'],
  ['Gemini web editor not ready for the prompt', 'gemini_editor_not_ready'],
  ['Gemini web did not return a generated image in time', 'gemini_image_timeout'],
  ['Gemini web returned an invalid image', 'gemini_invalid_image'],
  ['Gemini web image extraction failed (blob)', 'gemini_image_extraction_failed'],
  ['screenshot em branco (página não renderizou)', 'article_screenshot_blank'],
  ...[...SAFE_ERROR_CODES].filter(code => code.startsWith('GEMINI_ANDROID_'))
    .map(code => [code, code.toLowerCase()]),
  ['SCRIPT_GENERATION_UNAVAILABLE', 'script_generation_unavailable'],
  ['Limites de palavra do Edge TTS não correspondem à narração; sincronização cancelada', 'edge_word_timing_mismatch']
]);

function safeErrorTag(error, depth = 0) {
  if (depth > 3) return 'Error';
  const message = typeof error?.message === 'string' ? error.message : '';
  if (SAFE_ERROR_CODES.has(message)) return SAFE_ERROR_TAGS.get(message);

  const safeHttpStatus = [error?.status, error?.statusCode, error?.response?.status]
    .find(status => Number.isInteger(status) && status >= 400 && status <= 599);
  if (safeHttpStatus) return `http_${safeHttpStatus}`;

  if (error?.name === 'TimeoutError') return 'request_timeout';
  if (error?.name === 'AbortError') return 'request_aborted';

  const geminiHttpStatus = message.match(/^Gemini web image download failed: (\d{3})$/);
  if (geminiHttpStatus) return `gemini_image_http_${geminiHttpStatus[1]}`;

  // The OpenAI SDK deliberately replaces lower-level DNS/TLS exceptions with
  // this generic message. Keep it actionable without logging request details.
  if (/^(?:connection error|fetch failed|failed to fetch)\.?$/i.test(message.trim())) {
    return 'network_connection_error';
  }

  const httpStatus = message.match(/\b(?:HTTP(?: error)?|status(?: code)?)\s*[:=]?\s*([45]\d\d)\b/i);
  if (httpStatus) return `http_${httpStatus[1]}`;

  const networkCode = message.match(/\bnet::(ERR_[A-Z_]+)\b/);
  if (networkCode) return `network_${networkCode[1].toLowerCase()}`;

  const causeTag = error?.cause && error.cause !== error ? safeErrorTag(error.cause, depth + 1) : '';
  if (causeTag && causeTag !== 'Error') return causeTag;

  const candidate = [error?.code, error?.name].find(value =>
    typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value)
  );
  return candidate || 'Error';
}

module.exports = { safeErrorTag };
