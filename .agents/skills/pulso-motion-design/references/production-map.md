# Production map

Current owner decisions: `docs/decisoes-vigentes.md`. The sole execution cursor is `plan.md`; runtime instructions are in `docs/workflow-autonomo.md`. Do not infer current quotas, pause state or missing implementations from old evidence.

## Approved narrative route

- `scripts/channel-scheduler.js` is the sole Pulso producer/publisher, run by the existing user service. The assistant repairs code; the service handles recurring jobs, resource waits, recovery and distribution.
- `scripts/generate-animated-video.js` uses source evidence IDs, local factual review, measured TTS and per-job caches. Main YouTube narration must reach 360 seconds, with target 950/minimum 850 words. Vertical cuts do not inherit that duration minimum.
- `utils/narrative-episode-plan.js` owns chapters, sentences, timeline and assets. `utils/narrative-scene-author.js` authors bounded per-sentence compositions, escalates failed writers and preserves validated parts/drafts.
- Use Three.js r187 + Remotion and the approved reforestation method: detailed licensed local human GLBs with SHA/rig/clips, topic-specific props and acted transformations. Catalog: `experiments/remotion-motion-review/public/pulso-humans/catalog.json`; validation: `utils/narrative-human-actors.js`. No primitive human replacement, Game Farma cast or Mixamo/site per video.
- `NarrativeEpisode.tsx` is the shared composition and `ApprovedRobotPresenter.tsx` preserves the approved presenter. Narration-driven mouth, purposeful gestures, full-path contacts/support and understandable consequences remain required. Camera/text alone do not replace action.
- `utils/narrative-episode-renderer.js` owns bundle, props, total deadline, resources/lock, per-aspect checkpoints and atomic output. Compose 1920×1080 and 1080×1920 independently at plan fps; seek backward/forward must reproduce the same frame.
- Images and dedicated cover pairs use Gemini Android with shared device lock. Request Nano Banana Pro in the prompt and retain `requested-not-verified` when effective image model identity is unavailable. Do not open a host browser on Android failure.
- Local factual/technical/visual QA and delegated hash-bound review precede the existing consumer. YouTube/Shorts use Studio Android. Recurring review does not require individual human approval or a coding assistant watching every render.

## Historical and shared components

`assets/scenes/kit.js`, `kit.css`, `utils/scene-plan-builder.js` and `utils/hyperframes-video-renderer.js` still serve legacy callers/tests. Preserve working interfaces; they are not a fallback renderer or visual standard for new Pulso episodes. The independent AgentTube/Express scheduler does not own the Pulso queue.

When changing a shared legacy component, keep `renderAt(ms)`/timing contracts, theme tokens, serializable data and aspect-safe layouts. That maintenance does not authorize replacing narrative actors/actions with cards, labels or still images. Read imports before removing shared code.

## Verification

Follow `references/visual-review.md` and the current creative direction. Document actual renderer/format/fps, timing, hashes, pixels/movement and remaining limits. Pilot approval, fixture success and an active service do not prove a new episode was rendered or published.
