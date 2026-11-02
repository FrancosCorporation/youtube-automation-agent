#!/usr/bin/env bash
set -euo pipefail

test_state_dir="$(mktemp -d "${TMPDIR:-/tmp}/youtube-ai-ci.XXXXXX")"
trap 'rm -rf "$test_state_dir"' EXIT

export STATE_DIR="$test_state_dir/state"
export GEMINI_IMAGE_LOCK_PATH="$test_state_dir/gemini-image-generation.lock"
export YOUTUBE_AUTOMATION_DB_PATH="$test_state_dir/youtube_automation.db"
export CI=1
export NODE_ENV=test

# The repository's .env may contain production credentials. Tests must use
# mocks and fixtures, so suppress dotenv loads and remove inherited providers.
cat > "$test_state_dir/no-dotenv.cjs" <<'EOF'
const dotenv = require(require.resolve('dotenv', { paths: [process.cwd()] }));
dotenv.config = () => ({ parsed: {} });
EOF
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require=$test_state_dir/no-dotenv.cjs"
unset API_KEY NVIDIA_API_KEY OPENAI_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY
unset ELEVENLABS_API_KEY AZURE_SPEECH_KEY REPLICATE_API_KEY REPLICATE_API_TOKEN
unset MINIMAX_API_KEY DASHSCOPE_API_KEY KLING_ACCESS_KEY KLING_SECRET_KEY
unset NOTIFICATION_WEBHOOK_URL TELEGRAM_BOT_TOKEN TELEGRAM_ADMIN_CHAT_ID

npm test
npm run test:pipeline
node --test tests/knowledge-base.test.js
node --test tests/android-ui-hierarchy.test.js tests/daily-performance.test.js tests/alerts.test.js tests/operator-notifications.test.js tests/android-device-lock.test.js tests/android-emulator-bootstrap.test.js tests/docker-readiness.test.js tests/kwai-emulator-boot.test.js tests/android-emulator-control.test.js tests/android-session-state.test.js tests/android-social-publisher.test.js tests/api-usage.test.js tests/article-context.test.js tests/article-print-routing.test.js tests/article-screenshot-cache.test.js tests/daily-automation-scheduler.test.js tests/database-backup.test.js tests/fetch-with-timeout.test.js tests/nvidia-chat-completions.test.js tests/kwai-upload-flow.test.js tests/kwai-upload-resume.test.js tests/kwai-ui-wait.test.js tests/local-auth-compat.test.js tests/logger-observability.test.js tests/observability-ids.test.js tests/project-backup.test.js tests/publication-observability.test.js tests/publication-status.test.js tests/platform-video-policy.test.js tests/instagram-narrative-parts.test.js tests/runtime-preflight.test.js tests/hyperframes-video-renderer.test.js tests/publish-queue-recovery.test.js tests/generation-attempt.test.js tests/generation-retry.test.js tests/scheduler-guard.test.js tests/hook-structure.test.js tests/narration-timing.test.js tests/safe-error-tag.test.js tests/sanitized-log-stream.test.js tests/scene-plan-captions.test.js tests/scene-plan-components.test.js tests/scene-visuals.test.js tests/social-login-android.test.js tests/social-publication-state.test.js tests/social-retry.test.js tests/theme-feed-audit.test.js tests/news-hunter.test.js tests/theme-rotation.test.js tests/theme-visual-tokens.test.js tests/visual-design-tokens.test.js tests/thumbnail-art.test.js tests/thumbnail-design.test.js tests/source-evidence.test.js tests/recap-schedule.test.js tests/script-review.test.js tests/review-response.test.js tests/upload-social-android-routing.test.js tests/social-upload-limits.test.js tests/speech-visemes.test.js tests/audio-sfx.test.js tests/article-screenshot-quality.test.js tests/speech-viseme-audit.test.js tests/generation-observability.test.js tests/dashboard-accessibility.test.js
node --test tests/social-short-routing.test.js tests/presenter-framing-policy.test.js
node --test tests/disk-media-inventory.test.js tests/report-disk-backlog.test.js tests/recover-backlog-sources.test.js tests/recover-backlog-transcripts.test.js
node --test tests/disk-cleanup-retention.test.js tests/media-deletion.test.js tests/media-archive.test.js tests/retry-entry-media.test.js tests/publication-status-full-x.test.js
node --test tests/daily-performance-view.test.js tests/analytics-no-simulation.test.js tests/editorial-formats.test.js tests/audience-growth-guidance.test.js tests/gemini-login.test.js
node --test tests/video-qa-manifest.test.js tests/publication-visual-gate.test.js tests/scene-image-prompt.test.js tests/source-freshness.test.js tests/gemini-web-image-session.test.js tests/gemini-android-image.test.js tests/narrative-source-candidate.test.js tests/theme-metadata.test.js tests/theme-feed-audit.test.js tests/youtube-oauth-emulator.test.js
node --test tests/scene-image-fallback.test.js tests/script-repair.test.js tests/article-screenshot-page.test.js tests/narration-cache.test.js tests/tts-provider-policy.test.js
node --test tests/video-qa-review.test.js tests/delegated-publication-review.test.js tests/upload-to-youtube.test.js tests/youtube-quota-state.test.js tests/social-readiness.test.js tests/rejected-generation-cleanup.test.js
# Include every Node test file even when a new suite has not yet been added to
# the curated groups above. Keep concurrency modest on shared producer hosts.
mapfile -t additional_node_tests < <(node - <<'NODE'
const fs = require('node:fs');
const script = fs.readFileSync('scripts/run-ci-tests.sh', 'utf8');
for (const file of fs.readdirSync('tests').filter(name => name.endsWith('.test.js')).sort()) {
  if (!script.includes(`tests/${file}`)) console.log(`tests/${file}`);
}
NODE
)
if ((${#additional_node_tests[@]})); then
  node --test --test-concurrency=2 "${additional_node_tests[@]}"
fi
node tests/dashboard-accessibility-browser.js
python3 -m unittest discover -s tests -p 'test_*.py'
node tests/presenter-framing.js
node tests/instagram-video-framing.js
