---
name: pulso-motion-design
description: Create or improve Pulso narrative Remotion motion graphics, with source-led scenes, an approved robot presenter, aspect-specific layouts and visual QA; maintain shared HyperFrames components where still used.
---

# Pulso Motion Design

Use this skill when changing how Pulso videos are storyboarded, animated, framed, or visually validated.

## Workflow

1. Read `docs/decisoes-vigentes.md`, [the production map](references/production-map.md) and the current `plan.md` §3.0 / `docs/workflow-autonomo.md` before changing the renderer or scene components. The latest owner-approved reforestation method supersedes procedural-human pilots and older visual standards. The narrative Remotion modules already exist; their integration is not proof of a successful recurring production cycle.
2. Choose a small number of visuals that clarify the spoken beat. Keep data, labels, and claims traceable to the script or source.
   Follow `utils/narrative-creative-reference.js` and `docs/padrao-criativo-aprovado.md`: the owner approved enacted, continuous motion with contact and persistent consequences. Adapt the subject to each narration; do not copy the sorting-line topic. Check swept object volumes against supports and walls; camera framing must not conceal intersections.
   Apply the owner's CHAPEA feedback across topics: clean robot mouth without a dark halo, properly modeled humans, purposeful objects, acted motion, doors opened before passage, and understandable offscreen wardrobe changes. Use readable narration-led scene changes, including dedicated origin/transit/destination shots when explaining communication. Consult the multitema section of the creative direction before authoring the next episode.
   The owner approved the generated reforestation videos and adopted their method for production: Three.js r187 + Remotion, detailed human GLBs stored locally with provenance/license/SHA, and frame-deterministic clips aligned to narration. Use the local actor catalog instead of procedural human primitives; never add a Mixamo or other website step per video. The Game Farma cast remains rejected. Preserve the approved robot presenter. Adapt each scene, actions and props to the topic and spoken beat; inspect faces, hands, deformation, full-body framing and object contact. A reusable actor is not proof of universal scene authorship.
3. Apply the motion recipes in [motion-system.md](references/motion-system.md). Favor restrained spring entrances, staggered groups, clear holds, and quick exits.
4. Keep every effect seek-safe: derive it from Remotion's `useCurrentFrame()` and the episode timeline, or `renderAt(ms)` for shared legacy HyperFrames components. Do not use timers, `requestAnimationFrame`, CSS animation loops, random timing, or state that depends on the previous frame.
5. Validate both portrait and landscape, including section boundaries and backward/forward seeks. Follow [visual-review.md](references/visual-review.md).

Use the existing narrative Remotion path and Pulso theme tokens for new episodes; retain shared HyperFrames/GSAP helpers where still referenced. Do not route new production back to the superseded visual creator. Keep the approved robot, explanatory object actions and separate landscape/portrait layouts. Do not copy code, assets, or branded styles from reference repositories. Follow the user's authorized render/publication scope and resource gates; do not create a per-video approval requirement. Recurring QA and recovery must be executable by the service without a coding assistant supervising each job.
