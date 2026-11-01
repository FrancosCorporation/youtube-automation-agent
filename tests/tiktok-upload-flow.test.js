'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { detectTikTokScreen } = require('../utils/tiktok-upload-flow');

test('TikTok parser recognizes the documented first-use birthdate gate', () => {
  assert.equal(detectTikTokScreen([
    { text: 'When’s your birthdate?', description: 'To use TikTok, you need to enter your birthdate.', visible: true }
  ]), 'first_use');
  assert.equal(detectTikTokScreen([
    { text: 'Qual é a sua data de nascimento?', visible: true }
  ]), 'first_use');
  assert.equal(detectTikTokScreen([
    { text: 'Aniversário', visible: true }
  ]), 'first_use');
});

test('TikTok parser reuses the shared login detection and ignores hidden prompts', () => {
  assert.equal(detectTikTokScreen([{ text: 'Entrar', description: 'Create account', visible: true }]), 'login_required');
  assert.equal(detectTikTokScreen([{ text: 'When’s your birthdate?', visible: false }]), 'unknown');
});

test('TikTok parser recognizes only the shared own-profile evidence', () => {
  assert.equal(detectTikTokScreen([{ text: 'Edit profile', visible: true }]), 'own_profile');
  assert.equal(detectTikTokScreen([{ text: 'Share profile', visible: true }]), 'own_profile');
});

test('TikTok public feeds and unobserved upload/editor controls fail closed', () => {
  assert.equal(detectTikTokScreen([{ text: 'Para você', visible: true }]), 'unknown');
  assert.equal(detectTikTokScreen([
    { text: 'Add sound', visible: true },
    { text: 'Caption', visible: true },
    { text: 'Post', clickable: true, visible: true }
  ]), 'unknown');
  assert.equal(detectTikTokScreen([]), 'unknown');
});
