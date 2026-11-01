'use strict';

const REDACTED = '[REDACTED]';
const MAX_LOG_STRING_LENGTH = 2048;
const MAX_LOG_ARRAY_ITEMS = 50;
const MAX_LOG_OBJECT_FIELDS = 100;

const PRIVATE_FIELD_SEGMENTS = new Set([
  'token', 'secret', 'password', 'passwd', 'passphrase', 'key', 'apikey', 'credential',
  'authorization', 'cookie', 'session', 'prompt', 'transcript', 'caption',
  'subtitle', 'audio', 'voice', 'script', 'text', 'content', 'email', 'phone',
  'chatid', 'account', 'handle', 'username', 'privatekey', 'signature',
  'userinput', 'usertext', 'usercontent', 'requestbody', 'responsebody', 'body'
]);

const SAFE_CORRELATION_FIELDS = new Set([
  'jobid', 'videoid', 'contentid', 'artifactid', 'destination', 'platform', 'stage', 'status',
  'action', 'scope', 'eventtype', 'durationms', 'latencyms', 'attemptcount', 'errorcode',
  'failurecode', 'httpstatus', 'component'
]);

const INLINE_SECRET_PATTERNS = [
  [/(\b(?:authorization|proxy-authorization)\s*[:=]\s*)bearer\s+[^\s,;]+/gi, '$1Bearer [REDACTED]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]'],
  [/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b/g, REDACTED],
  [/(https?:\/\/api\.telegram\.org\/bot)[^/\s?#]+/gi, '$1[REDACTED]'],
  [/(https?:\/\/(?:hooks\.slack\.com\/services|discord(?:app)?\.com\/api\/webhooks)\/)[^\s?#]+/gi, '$1[REDACTED]'],
  [/(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|credential|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]'],
  [/(\b(?:prompt|transcript|caption|subtitle|audio(?:path|data)?|raw[_-]?text|user[_-]?(?:input|text|content))\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n,;]+)/gi, '$1[REDACTED]'],
  [/([?&](?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|key|secret|signature|sig|auth|chat[_-]?id)=)[^&#\s]+/gi, '$1[REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED]
];

function fieldSegments(key) {
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isPrivateField(key) {
  const normalized = fieldSegments(key).join('');
  if (SAFE_CORRELATION_FIELDS.has(normalized)) return false;
  return fieldSegments(key).some(segment => PRIVATE_FIELD_SEGMENTS.has(segment));
}

function sanitizeLogText(value) {
  let text = String(value ?? '');
  for (const [pattern, replacement] of INLINE_SECRET_PATTERNS) text = text.replace(pattern, replacement);
  if (text.length > MAX_LOG_STRING_LENGTH) text = `${text.slice(0, MAX_LOG_STRING_LENGTH)}…[truncated]`;
  return text;
}

function sanitizeError(error) {
  return {
    name: sanitizeLogText(error.name || 'Error'),
    message: sanitizeLogText(error.message || ''),
    ...(error.code ? { code: sanitizeLogText(error.code) } : {}),
    ...(error.stack ? { stack: sanitizeLogText(error.stack) } : {})
  };
}

function sanitizeLogData(value, key = '', seen = new WeakSet()) {
  if (key && isPrivateField(key)) return REDACTED;
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return sanitizeLogText(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (Buffer.isBuffer(value)) return `[Buffer bytes=${value.length}]`;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString();
  if (value instanceof Error) return sanitizeError(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_LOG_ARRAY_ITEMS).map(item => sanitizeLogData(item, '', seen));
    if (value.length > MAX_LOG_ARRAY_ITEMS) items.push(`[${value.length - MAX_LOG_ARRAY_ITEMS} more items]`);
    return items;
  }

  const output = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries = Object.entries(descriptors).filter(([, descriptor]) => Object.hasOwn(descriptor, 'value'));
  for (const [field, descriptor] of entries.slice(0, MAX_LOG_OBJECT_FIELDS)) {
    output[field] = sanitizeLogData(descriptor.value, field, seen);
  }
  if (entries.length > MAX_LOG_OBJECT_FIELDS) output._truncatedFields = entries.length - MAX_LOG_OBJECT_FIELDS;
  return output;
}

module.exports = { REDACTED, isPrivateField, sanitizeLogData, sanitizeLogText };
