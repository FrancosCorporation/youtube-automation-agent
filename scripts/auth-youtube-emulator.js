'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { google } = require('googleapis');

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl'
];
const DEFAULT_EXPECTED_VIDEO_IDS = ['pRlImBrR6IA', '_yLTtNlebN8'];
const CALLBACK_PATH = '/';

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function validateCallbackRequest(requestUrl, expectedState) {
  const parsed = new URL(requestUrl, 'http://127.0.0.1');
  const state = parsed.searchParams.get('state');
  if (!safeEqual(state, expectedState)) throw new Error('OAuth state mismatch');
  const oauthError = parsed.searchParams.get('error');
  if (oauthError) throw new Error(`Google authorization returned ${oauthError}`);
  const code = parsed.searchParams.get('code');
  if (!code) throw new Error('OAuth callback did not include an authorization code');
  return code;
}

function validateOAuthTokens(tokens) {
  if (!tokens?.access_token || !tokens?.refresh_token) {
    throw new Error('OAuth did not return both access and refresh tokens');
  }
  const granted = new Set(String(tokens.scope || '').split(/\s+/).filter(Boolean));
  const missing = OAUTH_SCOPES.filter(scope => !granted.has(scope));
  if (missing.length) throw new Error(`OAuth scopes are incomplete (${missing.length} missing)`);
}

function findVerifiedChannelId(ownedChannelIds, knownVideoChannelIds) {
  const owned = new Set(ownedChannelIds || []);
  return (knownVideoChannelIds || []).find(channelId => channelId && owned.has(channelId)) || null;
}

function quoteAndroidShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runAdb(args, { adbPath = process.env.ADB_PATH || 'adb', timeout = 30000 } = {}) {
  const result = spawnSync(adbPath, ['-s', process.env.ANDROID_DEVICE || '127.0.0.1:5555', ...args], {
    encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || '').replace(/https?:\/\/\S+/g, '[redacted]').slice(0, 160);
    throw new Error(`ADB ${args[0]} failed (${result.error?.code || result.status || 'unknown'})${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

async function readObject(filePath) {
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('OAuth JSON must be an object');
  return parsed;
}

async function writePrivateObject(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, filePath);
    await fs.chmod(filePath, 0o600);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function authorizeThroughEmulator({ timeoutMs = 10 * 60 * 1000 } = {}) {
  const repositoryRoot = path.resolve(__dirname, '..');
  const credentialDirectory = process.env.CREDENTIALS_DIR
    ? path.resolve(process.env.CREDENTIALS_DIR)
    : path.join(repositoryRoot, 'config');
  const credentialsPath = path.join(credentialDirectory, 'credentials.json');
  const tokensPath = path.join(credentialDirectory, 'tokens.json');
  const credentials = await readObject(credentialsPath);
  const youtubeCredentials = credentials.youtube;
  if (!youtubeCredentials?.client_id || !youtubeCredentials?.client_secret) {
    throw new Error('YouTube OAuth client credentials are not configured');
  }
  const registeredUris = youtubeCredentials.redirect_uris || [];
  if (!registeredUris.some(value => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(value))) {
    throw new Error('YouTube OAuth client does not allow a local loopback redirect');
  }

  const tokens = await fs.access(tokensPath).then(() => readObject(tokensPath)).catch(error => {
    if (error.code === 'ENOENT') return {};
    throw error;
  });
  const expectedVideoIds = String(process.env.YOUTUBE_EXPECTED_VIDEO_IDS || DEFAULT_EXPECTED_VIDEO_IDS.join(','))
    .split(',').map(value => value.trim()).filter(value => /^[\w-]{11}$/.test(value));
  if (!expectedVideoIds.length) throw new Error('No known published YouTube videos were supplied for account verification');

  const oauthState = randomBytes(32).toString('hex');
  const oauthServer = http.createServer();
  const callbackResult = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Google authorization timed out')), timeoutMs);
    timeout.unref();
    oauthServer.on('request', async (request, response) => {
      if (request.method !== 'GET' || new URL(request.url, 'http://127.0.0.1').pathname !== CALLBACK_PATH) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      try {
        const code = validateCallbackRequest(request.url, oauthState);
        resolve(code);
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end('<!doctype html><meta charset="utf-8"><title>Autorizacao recebida</title><p>Autorizacao recebida. Pode voltar ao computador.</p>');
      } catch (error) {
        reject(error);
        response.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end('<!doctype html><meta charset="utf-8"><title>Falha</title><p>O retorno OAuth nao foi validado. Feche esta aba e volte ao computador.</p>');
      }
    });
  });

  let reverseConfigured = false;
  let listeningPort;
  try {
    await new Promise((resolve, reject) => {
      oauthServer.once('error', reject);
      oauthServer.listen(0, '127.0.0.1', resolve);
    });
    listeningPort = oauthServer.address().port;
    const redirectUri = `http://127.0.0.1:${listeningPort}${CALLBACK_PATH}`;
    const oauthClient = new google.auth.OAuth2(
      youtubeCredentials.client_id,
      youtubeCredentials.client_secret,
      redirectUri
    );
    const authorizationUrl = oauthClient.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: OAUTH_SCOPES,
      state: oauthState
    });

    runAdb(['reverse', `tcp:${listeningPort}`, `tcp:${listeningPort}`]);
    reverseConfigured = true;
    runAdb(['shell', `am start -a android.intent.action.VIEW -d ${quoteAndroidShell(authorizationUrl)} -p org.mozilla.firefox`]);
    console.log('Tela de autorizacao aberta no Firefox do emulador. Conclua o login e o consentimento na janela do emulador.');

    const code = await callbackResult;
    const { tokens: freshTokens } = await oauthClient.getToken({ code, redirect_uri: redirectUri });
    validateOAuthTokens(freshTokens);
    oauthClient.setCredentials(freshTokens);

    const youtube = google.youtube({ version: 'v3', auth: oauthClient });
    const [owned, knownVideos] = await Promise.all([
      youtube.channels.list({ part: ['id'], mine: true, maxResults: 50 }),
      youtube.videos.list({ part: ['snippet'], id: expectedVideoIds })
    ]);
    const ownedChannelIds = (owned.data.items || []).map(channel => channel.id);
    const knownVideoChannelIds = (knownVideos.data.items || []).map(video => video.snippet?.channelId);
    const verifiedChannelId = findVerifiedChannelId(ownedChannelIds, knownVideoChannelIds);
    if (!verifiedChannelId) {
      throw new Error('Authenticated Google account does not match the channel that owns the known published videos');
    }

    tokens.youtube = freshTokens;
    await writePrivateObject(tokensPath, tokens);
    console.log('OAuth validado: canal corresponde ao historico publicado e o token foi salvo com permissao privada.');
    return { verified: true };
  } finally {
    if (reverseConfigured && listeningPort) {
      try {
        runAdb(['reverse', '--remove', `tcp:${listeningPort}`]);
      } catch {
        process.stderr.write('Could not remove the temporary Android callback port forward.\n');
      }
    }
    if (oauthServer.listening) await new Promise(resolve => oauthServer.close(resolve));
  }
}

if (require.main === module) {
  authorizeThroughEmulator().catch(error => {
    console.error(`Autenticacao YouTube pelo emulador nao concluida: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  OAUTH_SCOPES,
  validateCallbackRequest,
  validateOAuthTokens,
  findVerifiedChannelId,
  quoteAndroidShell,
  writePrivateObject,
  authorizeThroughEmulator
};
