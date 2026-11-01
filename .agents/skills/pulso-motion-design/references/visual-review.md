# Visual review loop

Run the focused checks for changed behavior, then inspect real browser frames before considering a render complete.

## Required checks for motion changes

1. Choose focused regression coverage for the changed path. Narrative route: `tests/narrative-episode-plan.test.js`, `tests/narrative-scene-author.test.js`, `tests/narrative-episode-renderer.test.js`; run relevant files with `node --test`. Shared HyperFrames components: `tests/scene-plan-components.test.js`, `tests/scene-plan-captions.test.js`, `tests/scene-visuals.test.js`. Do not run unrelated suites for a documentation-only edit.
2. Lint and syntax-check every changed JavaScript file; run `git diff --check`.
3. Capture portrait and landscape frames from the actual changed composition. For narrative Remotion, use `NarrativeEpisode` with a validated episode and run `npm --prefix experiments/remotion-motion-review run lint` for lint/TypeScript. For shared HyperFrames changes, use the actual `assets/scenes/kit.js` and `kit.css` in Playwright/Chromium. Inspect images, not only DOM assertions.
4. Seek before, during, and after an entrance/exit; seek backward to an earlier frame. Check that labels, fill values, visibility, and transforms reproduce the same state.
5. Inspect title/caption readability, safe margins, clipping, contrast, presenter overlap, factual text, and the handoff between scenes. Check still-image motion and chart values at a start, middle, and end frame.
6. Save small, relevant screenshots and machine-readable results under `docs/evidencias/` when the change is a tracked project objective.

Use existing browser checks where possible, including `tests/social-visual-pacing-browser.js`. For HyperFrames composition lint/check/preview/render, follow the installed HyperFrames CLI/core skills; do not substitute a unit test for a renderer or media QA result.

## Scope and runtime

- Browser-frame fixtures validate component layout and deterministic seeking; they do not prove a complete MP4, audio mix, presenter integration, or platform upload.
- Render a draft/MP4 only when requested and when host capacity and scheduler state make it safe. Do not restart or reload the publishing scheduler while `inFlight=true` or any writer/lock is active.
- Record exact format, duration, test results, and remaining release gates. Keep a code-only/browser proof distinct from final video QA.
- This is the engineering review loop for changing motion, not a requirement for a coding assistant to inspect every recurring job. Runtime QA uses the delegated policy and hashes; automatic recovery and release criteria are specified in `docs/workflow-autonomo.md`.
