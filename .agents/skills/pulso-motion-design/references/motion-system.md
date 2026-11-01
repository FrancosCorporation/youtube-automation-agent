# Pulso motion system

## Choreography

- Assign one focal visual to each spoken beat. Support it with at most a few secondary cues; preserve a readable hold after the entrance.
- Animate related properties together on an entrance: opacity plus a small positional move and a small scale change. Reserve large moves, rotations, and high contrast for the focal event.
- Use a restrained spring-out curve for spatial/scale motion. Keep opacity monotonic. Use linear/eased motion for camera drift, drawn paths, and progress that communicates measured time.
- Stagger ordered items by a small fixed interval (roughly 70–120 ms); delay wires/labels only when that ordering explains the data. Use consistent delays across related components.
- Make exits shorter than entrances. Fade/shift a visual in its final short window, then hide it at the exact scene-window end.
- Use slow Ken Burns motion only for stills where it helps composition. No perpetual shimmer, idle loop, flash, or motion that competes with narration/captions.
- Tie reveals and chapter changes to measured narration timing or explicit beat offsets, never to wall-clock time or playback callbacks.

## Motion tokens

Use the shared constants/helpers in `assets/scenes/kit.js` instead of inventing per-component timing:

- Main entrance: about 420–520 ms, 12–24 px vertical offset, scale around 0.94–0.98.
- Group stagger: about 90–120 ms for cards/nodes; 70–100 ms for compact chart rows.
- Exit: about 160–220 ms, with low travel and no added bounce.
- Spring overshoot: subtle and normalized to end exactly at the target. Never spring opacity, measured progress, caption timing, or camera drift.

Motion is authored as a pure function of local timeline time. When adding a curve, define it mathematically over `[0,1]`, clamp at both endpoints, and test intermediate and terminal values. Maintain deterministic results when rendering the same timestamp after seeking in either direction.

## Recipes

### Concrete visual explanation (Pulso direction approved for iteration, 22/10/2026)

- Follow the principle demonstrated by `IceFloatsReview`: when narration names ice, show ice; when it explains molecules, show their arrangement and the change being explained. Translate the subject, action, receiving object and relevant detail of each beat into visible objects. A title or arbitrary chart does not fulfill this role.
- For a narrated message transmission, show the originating computer, the message leaving it, the connection and its destination. For a web receipt, show browser chrome and page content; make date/time a property of that page. For an attribution, distinguish the claimed sender from the attributed origin. Label reconstructions; do not invent literal prompts, identities or evidence.
- Reuse `PulsoStoryScenes.tsx` and `PulsoStoryHumanScene.tsx` as scene construction examples, adapting objects and actions to the next story instead of reusing this case's computers/person for unrelated topics.
- The color distribution reference is `pulso-ia-robo-referencia-aprovada-20261022.mp4`: dark petroleum stage, cream text/surfaces, mint support and amber emphasis. A white full-frame background reverses the approved hierarchy.
- Presenter relocation between sides is an editorial cut, never a slide across content. An approved PNG is not proof of a generated 3D mesh or a working rig. Inspect the actual generated model, joint deformation, facial controls and deterministic seeks before claiming arms or hands work.
- The current PulsoStory iteration is reviewed live in Remotion before a complete MP4 export, as requested by the owner. Preview approval is distinct from the permanent publication policy for production videos.

### Metric reveal

Reveal a sourced number with opacity, small upward motion, and a restrained scale spring. Bring its short label a little later. Hold long enough to read; do not animate digits if the source does not provide a meaningful count-up sequence.

### Process diagram

Introduce nodes in spoken order, then draw each connector just before its destination node. Keep the step labels verbatim or faithful to the script. Do not imply causality beyond the narration.

### Chart or comparison

Reveal the chart title first, then bars/points/rows with a short stagger. Encode only data present in the reviewed script/component props. Keep numeric axes/labels fixed to the correct values; motion must not distort their meaning.

### Section handoff

Update the chapter title/progress on the narration boundary. Let the outgoing visual clear quickly and the incoming section enter with the shared spring profile. Keep section progress continuous when a chapter spans coalesced scenes.

### Evidence card or screenshot

Use a quiet multi-property entrance and a readable hold. Preserve source attribution and the existing minimum dwell window. End the visual inside its scheduled window.

## Sound

Use existing semantic SFX cues only for meaningful visual beats (chapter handoff, diagram completion, one key metric). Preserve narration intelligibility and the current mix policy. A motion change alone does not justify adding more sounds; use the existing audio/SFX helpers and tests when audio is in scope.
