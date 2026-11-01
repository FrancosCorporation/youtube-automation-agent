'use strict';

const { inspectAndroidAppSession } = require('./android-emulator-control');
const { normalizeAccountHandle } = require('./android-session-state');
const { recoverInstagramOwnReelView } = require('./instagram-upload-flow');
const { uniqueCaptionCandidate } = require('./tiktok-reconciliation');
const PREFIX = 'com.instagram.android:id/';
const visible = nodes => (nodes || []).filter(n => n.visible !== false);
const byId = (nodes, id) => visible(nodes).filter(n => n.resourceId === PREFIX + id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function ownPostsView(nodes, account) {
  const captionPrefix = `${normalizeAccountHandle(account).replace(/^@/, '')} `;
  const ownCaption = visible(nodes).some(n => !n.clickable && !n.resourceId
    && String(n.text || '').toLowerCase().startsWith(captionPrefix));
  return byId(nodes, 'action_bar_title').some(n => /^(Posts|Publicações)$/i.test(n.text))
    && (byId(nodes, 'row_feed_photo_profile_name').some(n => normalizeAccountHandle(n.text) === normalizeAccountHandle(account))
      || ownCaption && byId(nodes, 'inline_insights_container').length > 0)
    && byId(nodes, 'action_bar_button_back').filter(n => n.clickable).length === 1;
}

// The Posts view exposes the complete expanded caption even on app versions
// whose Reel caption sheet omits its text from Android accessibility.
function ownPostCaptions(nodes, account) {
  if (!ownPostsView(nodes, account) || !byId(nodes, 'inline_insights_container').length) return [];
  const prefix = `${normalizeAccountHandle(account).replace(/^@/, '')} `;
  return visible(nodes).filter(n => !n.clickable && !n.resourceId
    && String(n.text || '').toLowerCase().startsWith(prefix))
    .map(n => String(n.text).slice(prefix.length).replace(/\s+(?:less|menos)$/i, '').trim())
    .filter(text => !/(?:…|\.{3})\s*(?:more|mais)$/i.test(text));
}

async function scanInstagramPosts({ control, accountHandle, candidates, maxPosts = 6, pageOffset = 0,
  wait = sleep, capture = async () => null, timeoutMs = 15000, onConfirmed = async () => {} }) {
  const expected = normalizeAccountHandle(accountHandle);
  if (!expected) throw new Error('Instagram: identidade configurada ausente');
  let nodes = await control.dumpUi();
  if (ownPostsView(nodes, expected)) {
    const back = byId(nodes, 'action_bar_button_back')[0];
    await control.tap(back.x, back.y); await wait(700);
  } else {
    await recoverInstagramOwnReelView(control, nodes, expected, { wait });
  }
  const session = await inspectAndroidAppSession({ control, platform: 'instagram', timeoutMs, wait });
  if (session.status !== 'logged_in' || normalizeAccountHandle(session.accountHandle) !== expected) {
    throw new Error('Instagram: perfil de reconciliação não corresponde à conta configurada');
  }
  const until = async predicate => {
    const deadline = Date.now() + timeoutMs;
    do { const current = await control.dumpUi(); if (predicate(current)) return current; await wait(500); } while (Date.now() < deadline);
    throw new Error('Instagram: tela de reconciliação indisponível');
  };
  const tiles = current => byId(current, 'image_button').filter(n => n.clickable && /^Reel by .+ at row \d+, column \d+$/i.test(n.description || '')
    && n.y > 225 && n.y < 1100).sort((a, b) => a.y - b.y || a.x - b.x);
  nodes = await control.dumpUi();
  const selectGrid = async () => {
    const grid = byId(nodes, 'profile_tab_icon_view').filter(n => n.clickable && /^(Grid view|Visualização em grade)$/i.test(n.description || ''));
    if (!tiles(nodes).length && grid.length === 1) {
      await control.tap(grid[0].x, grid[0].y); await wait(700); nodes = await control.dumpUi();
    }
  };
  await selectGrid();
  for (let i = 0; !tiles(nodes).length && i < 5; i++) {
    if (!byId(nodes, 'profile_tab').length) throw new Error('Instagram: navegação fora do perfil');
    await control.shell(['input', 'swipe', '400', '1050', '400', '470', '350']);
    await wait(700); nodes = await control.dumpUi();
    await selectGrid();
  }
  for (let page = 0; page < Math.min(7, Math.max(0, pageOffset)); page++) {
    if (!tiles(nodes).length) break;
    await control.shell(['input', 'swipe', '400', '1050', '400', '470', '350']);
    await wait(700); nodes = await control.dumpUi();
  }
  const first = tiles(nodes)[0];
  if (!first) throw new Error('Instagram: publicações do perfil não identificadas');
  await control.tap(first.x, first.y);
  nodes = await until(current => ownPostsView(current, expected));
  const confirmed = [];
  // A bounded read-only walk of the account Posts feed. No create/share/like.
  for (let step = 0; step < maxPosts * 3; step++) {
    // Between two posts the header and caption can both be outside the viewport.
    // Continue only inside the already authenticated Posts feed, without attributing evidence.
    if (!byId(nodes, 'action_bar_title').some(n => /^(Posts|Publicações)$/i.test(n.text))
      || byId(nodes, 'action_bar_button_back').length !== 1) throw new Error('Instagram: navegação saiu de Posts');
    const more = visible(nodes).filter(n => n.clickable && /^(more|mais)$/i.test(n.description || n.text || ''));
    if (more.length === 1) {
      await control.tap(more[0].x, more[0].y); await wait(700); nodes = await control.dumpUi();
    }
    for (const caption of ownPostCaptions(nodes, expected)) {
      const candidate = uniqueCaptionCandidate(candidates, caption);
      if (!candidate || confirmed.some(item => item.id === candidate.id)) continue;
      const proof = { id: candidate.id, account: expected, caption, captionScreenshot: await capture('caption') };
      await onConfirmed(proof); confirmed.push(proof);
    }
    if (confirmed.length === candidates.length || step + 1 === maxPosts * 3) break;
    await control.shell(['input', 'swipe', '350', '1080', '350', '540', '350']);
    await wait(700); nodes = await control.dumpUi();
  }
  // This invocation entered Posts from the verified own profile and performed
  // only expansion/scroll, so it can return even between two off-screen headers.
  if (byId(nodes, 'action_bar_title').some(n => /^(Posts|Publicações)$/i.test(n.text))
    && byId(nodes, 'action_bar_button_back').filter(n => n.clickable).length === 1) {
    const back = byId(nodes, 'action_bar_button_back')[0];
    await control.tap(back.x, back.y);
  }
  return confirmed;
}

module.exports = { ownPostsView, ownPostCaptions, scanInstagramPosts };
