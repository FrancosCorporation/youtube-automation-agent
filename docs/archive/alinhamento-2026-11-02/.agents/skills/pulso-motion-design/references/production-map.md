# Production map

## Current narrative route — 2026-10-25

- `scripts/channel-scheduler.js` is the sole operational scheduler. Its user service and guard were active/enabled on 2026-10-25; the next retry waits for the API reset and the render gate. Consult `docs/workflow-autonomo.md` and the live state before operations.
- `scripts/generate-animated-video.js` validates source-backed narration, obtains real TTS/timing and builds a narrative episode. It already calls the new modules; do not implement duplicates.
- `utils/narrative-episode-plan.js` owns the versioned episode, chapters, sentences, assets and timeline. `utils/narrative-scene-author.js` supplies bounded objects/actions/camera intent per chapter. The source catalog by IDs is integrated in the generator; local fixtures pass, while a writer-backed production job remains pending.
- `utils/narrative-episode-renderer.js` owns resource checks, hashes, lock, per-aspect completion and Remotion invocation. It now bundles once per job, validates props, shares a total deadline, rechecks the resource gate for each aspect and promotes verified outputs atomically; real bundle/render QA is pending.
- `experiments/remotion-motion-review/src/NarrativeEpisode.tsx` is the shared composition; `ApprovedRobotPresenter.tsx` preserves the approved rig, narration-driven mouth and gestures. Derive motion from frames and validated timeline data.
- Use physical/explanatory change linked to narration: actor, action, transformation and consequence. Labels/cards/fades alone do not satisfy the approved GPS v2/PulsoStory method. Keep claims and numbers bound to reviewed source evidence.
- Produce 1920×1080 and 1080×1920 layouts at the plan fps (current baseline 24); reorganize content instead of cropping the landscape. A successful example composition does not prove universal recurring operation.

## Shared HyperFrames path and historical visual components

The components below remain relevant to callers/tests that still use them. They are not a fallback instruction for new narrative episodes. Check imports before editing or removing shared code.

- `utils/scene-plan-builder.js` turns script sections, narration timing, and images into deterministic scene/component data. It is the place for beat-to-visual choices and chapter timing.
- `assets/scenes/kit.js` builds DOM/SVG components and registers animation tracks. `window.renderAt(ms)` evaluates the complete state for any timestamp.
- `assets/scenes/kit.css` owns frame layout, typography, color, and aspect-specific constraints. Reuse the theme and visual tokens already in `config/themes.json` and `utils/visual-design-tokens.js`.
- `utils/hyperframes-video-renderer.js` assembles the production composition and seeks it with GSAP. Preserve its scene timing, audio, presenter, and capture contracts.
- `utils/audio-mix.js`, SFX manifests, and `tests/audio-sfx.test.js` own sound mixing/cue validation. Keep sound cues sparse and aligned to the same scene timeline.

## Existing visual vocabulary

Prefer an existing component when it explains the beat:

- `demo-header`: chapter, section, and progress context.
- `kinetic-number`, `highlight`, `clip-title`: one key metric or phrase.
- `node-graph`, `checklist`, `rotation-cards`: ordered process or spoken steps.
- `score-chart`, `line-chart`, `donut-chart`, `rank-list`, `compare-table`, `step-chart`, `progress-bar`: supported, sourced comparisons and data.
- `news-card`, `article-print`, `image-hero`, `image-panel`, `bento-card`: evidence and visual context.
- `caption` / `caption-track`: narration-synchronized readability. Preserve their word times and karaoke behavior.

Scene generation already prefers a process diagram when the narration describes steps, a kinetic number when it states a supported metric, and contextual cards when no evidence-backed data graphic applies. Keep this choice deterministic. Never manufacture values, sources, labels, UI, or conclusions to fill a graphic.

## Shared HyperFrames frame and timing contract

- Renderer frame: 1920×1080 landscape or 1080×1920 portrait. Use responsive CSS variables and test both safe areas.
- Times passed to components and `renderAt` are milliseconds local to the current coalesced scene. `sceneWindow` and chapter metadata express local visibility and timeline offsets.
- Coalescing can split one narrated section into multiple render scenes. Carry chapter offsets and visual windows across chunks; do not restart a section's progress at each chunk.
- Keep component data serializable. Do not put DOM nodes, functions, random seeds without deterministic handling, or browser-time state in the scene plan.
- Short-form minimal cuts intentionally have fewer overlays. Do not add chapter HUDs, secondary data, or persistent decoration to a minimal clip unless its plan explicitly calls for them.
