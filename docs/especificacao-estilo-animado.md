# Especificação — Estilo de vídeo animado (UI/Product Motion Graphics)

> Fonte da verdade para o novo renderizador de vídeos do canal.
> Baseado na análise de: ref1 `F-8KHgCK6dc` (ViktorKav), ref2 `mYGCDyuulMM` (ViktorKav — "GPT-6 Astra"),
> ref3 `AATRjnEM-1Q` (Gustavo Honorato — "Claude Opus 5.5 editou meu vídeo em 6 min", inclui o prompt e o plano do agente).

## 1. Nome do estilo

- **UI/Product Motion Graphics** (SaaS Motion Design / UI Explainer Animation)
- Estética **Linear / Vercel / Raycast "dark premium"**
- Layout **Bento UI** (cards compartimentados)
- **FUI** (Fictional User Interface) — interfaces fictícias recriadas em código
- **Data-Flow / Node animation** — nós e fios acendendo em sequência
- **Kinetic typography / animated captions** — legendas e números animados sincronizados à fala

## 2. Sistema visual

| Item | Valor |
|---|---|
| Fundo | `#0A0A0F`–`#0D1117` com grade sutil (linhas `#1A1A22`, célula ~48px, opacidade 40–60%) |
| Superfície/card | `#111318`–`#16181D`, raio 12–16px, **borda 1px** `#23252B`, sombra difusa fraca |
| Texto | Branco `#F5F5F7` (título), cinza `#9CA3AF` (corpo/legenda) |
| Accent pastel/neon | ciano `#7DD3FC`, azul `#60A5FA`, amarelo `#FACC15`, verde `#4ADE80`, magenta `#F472B6` (máx. 1–2 por cena) |
| Tipografia | Sans humanista/geométrica (Inter, Geist, Satoshi ≈ fallback `Inter, system-ui`); títulos 700–800, corpo 400–500; números grandes 900 |
| Grid de layout | 12 colunas, margem 96px @1920×1080, gutter 24px; cards alinhados ao grid |
| Detalhes | chips de status, tab/segmented control, sliders, waveform, barra de progresso laranja/azul |

## 3. Catálogo de componentes (recriáveis em HTML/CSS/JS)

1. **Bento card** — bloco com borda 1px, ícone opcional, título + subtítulo, barra fina.
2. **Header de demo** — linha superior: categoria (ex.: "Separação de voz") + contador `01 / 02` (chip) + estado colorido ("Voz real"/"Voz clonada").
3. **Progress bar** — trilha fina, preenchimento accent, timestamp `1,0 / 4,6 s`.
4. **Caption/legenda animada** — texto grande, entrada por palavra/frase, sobe 12px + fade 150–250ms, destaque da palavra-chave em accent.
5. **Highlight sweep** — faixa (amarelo/azul) que varre atrás de uma linha de texto (scaleX 0→1, 180–300ms, ease-out), como um marca-texto.
6. **Kinetic number** — número gigante (ex.: "9%") que escala 0.6→1 + blur→nítido, com label "SÓ ... DO LIMITE".
7. **Step chart / infografia** — gráfico de escada com **stroke animation** (path dash-offset) e áreas rotuladas.
8. **Node graph / data flow** — nodes conectados por fios; fios "acendem" (dash offset animando) na ordem do fluxo.
9. **Segmented control / dropdown** — card com seletor (`V4.1 Flash` vs `V4 Pro`) cujo estado muda na cena.
10. **Waveform / audio player** — barras animando ao ritmo + botão play.
11. **PiP (picture-in-picture)** — webcam/cena no canto (ex.: ref3), com borda arredondada e leve sombra.
12. **Transição glitch** — RGB split + slices horizontais + 2–4 frames de ruído (80–150ms).
13. **Lower-third / barra de patrocínio** — card horizontal com logo, título, CTA e QR code (ref1).

## 4. Gramática de animação

- **Easings**: entradas `cubic-bezier(.16,1,.3,1)` (expo-out), saídas `cubic-bezier(.7,0,.84,0)`; microinterações `ease-out`.
- **Durações**: entrada de card 300–450ms; legenda 150–250ms; highlight 180–300ms; transição de cena 300–600ms; glitch 80–150ms.
- **Stagger**: elementos filhos entram com atraso 40–80ms entre si.
- **Movimentos**: translateY (8–20px), scale (0.96→1 ou 0.6→1 p/ números), fade, blur→sharp, máscara/wipe, dash-offset (gráficos/fios).
- **Zoom**: zoom lento 1.0→1.05–1.10 (Ken Burns) sobre screen-recordings/imagens; **jump cuts** a cada 2–5s com micro-zoom alternado.
- **Ritmo**: cada elemento/card casa com a frase da narração; troca de cena nas pausas naturais da fala.

## 5. Sincronização com a narração (o segredo do ref3)

Pipeline observado (plano do Claude Opus 5.5 lido em tela):
1. Extrair o trecho e **transcrever** (faster-whisper) → **timestamps por palavra**.
2. **Detectar trocas de cena** e pausas; marcar gancho (~50s) e cortes.
3. Montagem: jump cuts + zoom + **legendas animadas** + cards + transições glitch + destaques.
4. Trilha/sfx ajustados e varredura de fontes/bibliotecas.
No nosso caso a narração é gerada por nós (edge-tts), então já temos o texto — falta só o timing por palavra (ver §6).

## 6. Pipeline de produção 100% livre (ferramentas gratuitas)

| Etapa | Ferramenta livre |
|---|---|
| Narração | `edge-tts` (já usado) → MP3 + `.srt` (frase); opcional **faster-whisper** local p/ timestamps por palavra |
| Planejamento de cenas | LLM (Gemini/NVIDIA) → JSON de cenas: componentes, textos, tempos, accent |
| Render de cena | **HTML/CSS/JS** + Playwright/Chromium determinístico (advance da timeline via Web Animations API `currentTime`) → PNG por frame (`frame_%05d.png`) **ou** CDP screencast |
| Montagem | FFmpeg (concat, xfade, glitch via `rgbashift`/`tblend`, overlay PiP, burn-in de legendas libass) |
| Imagens de apoio | Gemini web (já integrado) + stock (Pexels/Picsum) como fundo de cards |

**Determinismo**: cada cena é uma página com `window.renderAt(ms)` que posiciona todas as animações (WAAPI/AX) no tempo `t`; o capturador avança `t` em `1000/fps` e tira screenshot — independe da velocidade da máquina (ao contrário de screen-record).

## 7. Integração no repositório

- Novo modo: `SLIDESHOW_STYLE=animated` (junto de `dynamic`/`classic`), selecionável por canal.
- `utils/animated-scene-renderer.js`: engine cena→frames→vídeo.
- `utils/scene-templates/` (ou `assets/scenes/`): componentes (bento-card, step-chart, node-flow, caption, highlight, kinetic-number, pip, glitch) em HTML/CSS/JS.
- Entrada: JSON de cenas derivado do roteiro (`script-writer`) — cada seção vira 1+ cenas com componentes escolhidos por heurística do conteúdo (número→kinetic number, comparação→bento, processo→node flow, citação→caption+highlight).
- Legendas: reaproveitar `.srt` do edge-tts; estilo Linear (sans, branco, contorno, palavra-chave em accent).
- Fallback: se o render animado falhar → modo `dynamic` (Ken Burns) → slides com zoom.

## 8. Contratos técnicos (dev-ready)

### 8.1 Estrutura de pastas
```
utils/animated-scene-renderer.js      # orquestra: cenas -> frames -> mp4
utils/scene-capture.js                # Playwright: renderAt(t) por frame
assets/scenes/
  index.html                          # shell que carrega o kit + recebe a cena
  kit.css                             # tokens (cores/tipografia/grid) + animações
  kit.js                              # componentes + window.renderAt(ms)
  fonts/Inter-*.woff2                 # fontes locais (sem depender de rede)
scenes/                               # JSON de cenas gerados por produção
```

### 8.2 Contrato `window.renderAt(ms)`
A página expõe uma única função determinística; o capturador avança o tempo e tira print. Sem `requestAnimationFrame`, sem timers reais:
```js
// kit.js
const TIMELINE = []; // { el, prop, from, to, start, dur, ease }
function tween(el, prop, from, to, start, dur, ease = 'expo-out') {
  TIMELINE.push({ el, prop, from, to, start, dur, ease });
}
window.buildScene = scene => { /* cria DOM a partir do JSON e registra tweens */ };
window.renderAt = ms => {
  const tf = new Map(); // el -> { tx, ty, s, rot } — transforms são COMPOSTOS
  const get = el => tf.get(el) || tf.set(el, { tx: 0, ty: 0, s: 1, rot: 0 }).get(el);
  for (const { el, prop, from, to, start, dur, ease } of TIMELINE) {
    const p = Math.min(1, Math.max(0, (ms - start) / dur));
    const v = from + (to - from) * EASINGS[ease](p);
    const t = get(el);
    if (prop === 'opacity') el.style.opacity = v;
    else if (prop === 'translateX') t.tx = v;
    else if (prop === 'translateY') t.ty = v;
    else if (prop === 'scale') t.s = v;
    else if (prop === 'rotate') t.rot = v;
    else if (prop === 'dashoffset') el.style.strokeDashoffset = v;
    else if (prop === 'hlScale') el.style.setProperty('--hl-scale', v);
  }
  // Aplica UMA vez o transform composto — evita que translate/scale se sobrescrevam.
  for (const [el, t] of tf) {
    el.style.transform = `translate(${t.tx}px, ${t.ty}px) scale(${t.s}) rotate(${t.rot}deg)`;
  }
  return true;
};
```
> Transforms são acumulados por elemento e escritos uma única vez por frame; `opacity`, `strokeDashoffset` e CSS vars são aplicados direto.
> Alternativa mais rica: Web Animations API (`el.animate(...)`, depois `anim.currentTime = t; anim.pause()`).

### 8.3 Captura (Playwright) — esqueleto
```js
async function captureScene(page, scene, fps, outDir) {
  await page.evaluate(s => window.buildScene(s), scene);
  await page.evaluate(() => document.fonts.ready);            // fontes carregadas
  const frames = Math.round(scene.durationMs / 1000 * fps);
  for (let i = 0; i < frames; i++) {
    const t = Math.round(i * 1000 / fps);                     // índice de frame estável
    await page.evaluate(ms => window.renderAt(ms), t);
    await page.screenshot({ path: `${outDir}/f_${String(i).padStart(5, '0')}.png` });
  }
}
// mux: runFFmpeg(['-y','-framerate',String(fps),'-i',`${outDir}/f_%05d.png`,
//                '-c:v','libx264','-pix_fmt','yuv420p', sceneMp4]);
```

### 8.4 Schema do JSON de cena (v1)
```json
{
  "id": "s3",
  "durationMs": 8200,
  "background": { "type": "grid", "accent": "#60A5FA" },
  "components": [
    { "type": "demo-header", "category": "Separação de voz", "index": 3, "total": 5, "state": "Voz real", "stateColor": "cyan" },
    { "type": "bento-card", "title": "Ruído adicionado", "subtitle": "Teste controlado", "revealAtMs": 600 },
    { "type": "step-chart", "title": "O uso acumula", "series": [12, 30, 55, 78], "labels": ["arquivos", "código", "testes"], "revealAtMs": 1800 },
    { "type": "caption", "words": [{ "t": 0, "w": "O" }, { "t": 180, "w": "atendimento" }, { "t": 420, "w": "já" }, { "t": 560, "w": "está" }, { "t": 760, "w": "disponível" }], "keyword": "disponível" },
    { "type": "highlight", "text": "Limite de 5 horas: 9% usado", "revealAtMs": 1200, "color": "yellow" },
    { "type": "kinetic-number", "value": "9%", "label": "SÓ DO LIMITE", "revealAtMs": 300 },
    { "type": "pip", "position": "bottom-right", "source": "assets/video/cam.mp4" },
    { "type": "transition", "kind": "glitch", "atMs": 8000, "durationMs": 140 }
  ]
}
```
Cada componente é uma função pura `render(props, ctx)` que devolve DOM + tweens registrados com `start = revealAtMs`.
`revealAtMs` = milissegundos **relativos ao início da cena** (0 = frame 0; ausente = 0). Para `caption.words`, `t` também é relativo ao início da cena, e o componente calcula `progress` a partir de `ms` internamente.

### 8.4.1 JSON Schema da cena (v1 — validação obrigatória)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Scene",
  "type": "object",
  "required": ["id", "durationMs", "components"],
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string" },
    "durationMs": { "type": "integer", "minimum": 200, "maximum": 600000 },
    "background": {
      "type": "object",
      "properties": { "type": { "enum": ["grid", "solid", "image"] }, "accent": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" }, "src": { "type": "string" } }
    },
    "components": {
      "type": "array", "minItems": 1,
      "items": {
        "type": "object",
        "required": ["type"],
        "properties": {
          "type": { "enum": ["demo-header", "bento-card", "step-chart", "node-graph", "caption", "highlight", "kinetic-number", "pip", "waveform", "transition"] },
          "revealAtMs": { "type": "integer", "minimum": 0 },
          "durationMs": { "type": "integer", "minimum": 0 }
        },
        "additionalProperties": true
      }
    }
  }
}
```
O renderer valida a cena antes de capturar (falha cedo com mensagem clara); tipos por componente ficam em `kit.d.ts` (TypeScript) para autocompletar os produtores de cena.

### 8.5 Legendas: `.srt` → timeline
- edge-tts emite `.srt` por frase; para palavra, usar faster-whisper no próprio MP3 (`word_timestamps=True`).
- Conversão: `startMs = hh*3600000+mm*60000+ss*1000+ms`; `startFrame = Math.round(startMs/1000*fps)` (±1 frame é aceitável).
- Palavra-chave = maior termo não-stopword, ou marcada pelo LLM no JSON de cena.

### 8.6 Fontes e medição
- Embutir Inter local (`@font-face` + woff2) e sempre `await document.fonts.ready` antes do frame 0.
- Medir texto com `el.getBoundingClientRect()` após montar a cena (antes do frame 0) para decidir quebras/posições.

### 8.7 Cache e paralelismo
- Hash da cena (`sha1(JSON)`) → se `scenes/<hash>.mp4` existe, reutiliza.
- Capturar cenas em paralelo com 2–3 páginas Chromium; montar no fim com concat + transições.
- Checkpoint por cena: falhou → reexecuta só aquela cena.

## 9. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Custo de captura frame-a-frame | capturar @24fps; CDP screencast como opção; cache de componentes estáticos; paralelizar cenas |
| Determinismo de fontes (fontes ausentes) | usar Inter/system-ui + `@font-face` local; medir texto antes de render |
| Escopo grande da engine | MVP: 5 componentes (bento, caption, highlight, kinetic-number, step-chart) + glitch + xfade, e evoluir |
| Pipeline em máquina carregada | fila de cenas, reprocessamento por checkpoint (infra já existe no repo) |

> Nota de reconciliação: o contrato canônico segue `window.renderAt(ms)`; componentes que precisam de progresso calculam `progress = ms / scene.durationMs` internamente.

## 10. Fechamento de lacunas (v1.1)

### 10.1 Catálogo de easings (JS puro)

```js
// t ∈ [0, 1]
export const Easing = {
  // Expo Out: 1 - 2^(-10t)
  expoOut: t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),

  // Ease Out (Cubic): 1 - (1-t)^3
  easeOut: t => 1 - Math.pow(1 - t, 3),

  // Ease In-Out (Cubic): t<0.5 ? 4t^3 : 1 - (-2t+2)^3/2
  easeInOut: t => t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2,

  // Spring (damped harmonic oscillator) — config: mass=1, stiffness=170, damping=26
  // Retorna posição em t (segundos). Use frame loop: x = spring(t * frameDur / 1000)
  spring: (() => {
    const m = 1, k = 170, d = 26;
    const w0 = Math.sqrt(k / m);
    const zeta = d / (2 * Math.sqrt(k * m));
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return t => {
      if (zeta >= 1) return 1 - Math.exp(-w0 * t); // overdamped fallback
      const env = Math.exp(-zeta * w0 * t);
      return 1 - env * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
    };
  })()
};
```

### 10.2 Encadeamento de cenas + transições

**Concat demuxer (lossless):**
```bash
# scenes.txt
file 'scene_00.mp4'
file 'scene_01.mp4'
file 'scene_02.mp4'
ffmpeg -f concat -safe 0 -i scenes.txt -c:v copy -c:a aac -b:a 192k output_concat.mp4
```

**Transição `xfade` (fade/glide) entre duas cenas (re-encode necessário no trecho):**
```bash
# fade 1s na junção 0→1 (offset = duração_scena_0 - 1s)
ffmpeg -i scene_00.mp4 -i scene_01.mp4 \
  -filter_complex "[0:v][1:v]xfade=transition=fade:duration=1:offset=9.5[v]" \
  -map "[v]" -c:v libx264 -preset fast -crf 18 -an transition_01.mp4
```
*Substitua `transition=fade` por `glide` (ou `circleopen`, `wipeleft`, etc.) conforme spec.*

**Clipe de glitch (~6 frames @ 30fps = 200ms) gerado 100% no FFmpeg:**
```bash
ffmpeg -f lavfi -i color=black:s=1920x1080:d=0.2 -f lavfi -i color=white:s=1920x1080:d=0.2 \
  -filter_complex "
    [0:v]tblend=all_mode='difference',rgbashift=r=2:g=-2:b=1[g1];
    [1:v]tblend=all_mode='difference',rgbashift=r=-1:g=3:b=-2[g2];
    [g1][g2]blend=all_mode='overlay',format=yuv420p
  " -c:v libx264 -preset ultrafast -crf 24 glitch_6f.mp4
```
**Aplicação no ponto de junção:** Insira `glitch_6f.mp4` entre as cenas no `scenes.txt` ou use `filter_complex` com `overlay=enable='between(t,9.5,9.7)'` sobre o `xfade`.

### 10.3 Montagem de áudio (narração única + SRT sync)

```bash
# 1. Extrair duração total do SRT (último timestamp end)
# Ex: 00:00:15,420 -> 15420ms
TOTAL_MS=$(python3 -c "
import pysrt, sys
subs = pysrt.open(sys.argv[1])
last = subs[-1].end
print(last.hours*3600000 + last.minutes*60000 + last.seconds*1000 + last.milliseconds)
" narration.srt)

# 2. Renderizar vídeo bruto (sem áudio) com duração EXATA = TOTAL_MS
#    (use --duration-ms=$TOTAL_MS no seu renderer)

# 3. Merge final com -shortest (corta vídeo se áudio menor, ou vice-versa)
ffmpeg -i video_raw.mp4 -i narration.mp3 \
  -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a aac -b:a 192k \
  -shortest final.mp4
```
*Mapeamento:* `-map 0:v:0 -map 1:a:0` garante vídeo do input 0, áudio do input 1. `-shortest` evita cauda preta/silêncio.

### 10.4 Precisão de frame/tempo (inteiros only)

```js
const FPS = 30; // ou 24
const FRAME_DUR_MS = 1000 / FPS; // 33.333... -> manter como fração ou arredondar p/ int ms

// Cálculo determinístico de timestamps (ms inteiros)
function frameTimeMs(frameIndex) {
  return Math.round(frameIndex * 1000 / FPS); // t_i
}

function framesForDuration(durationMs) {
  return Math.round(durationMs / FRAME_DUR_MS);
}

// Ajuste final: última cena absorve o resto
function computeSceneFrames(sceneDurationsMs, totalTargetMs) {
  const frames = sceneDurationsMs.map(d => framesForDuration(d));
  const sumFrames = frames.reduce((a, b) => a + b, 0);
  const targetFrames = Math.round(totalTargetMs / FRAME_DUR_MS);
  const diff = targetFrames - sumFrames;
  frames[frames.length - 1] += diff; // fecha a conta
  return frames;
}
```
*Nunca acumule `t += frameDur` em float. Use `t_i = round(i * 1000 / fps)`.*

### 10.5 Resolução / Responsividade (CSS + Playwright)

```css
:root {
  --w: 1920;
  --h: 1080;
}
@media (orientation: portrait) { /* Shorts flag via JS */ }
.scene { width: var(--w); height: var(--h); }
```
```js
// Playwright viewport setup
const isShorts = process.env.FORMAT === 'shorts';
const width = isShorts ? 1080 : 1920;
const height = isShorts ? 1920 : 1080;
await page.setViewportSize({ width, height });
await page.evaluate(([w, h]) => {
  document.documentElement.style.setProperty('--w', w);
  document.documentElement.style.setProperty('--h', h);
}, [width, height]);
```
*Todos os layouts usam `var(--w)` / `var(--h)` (ex: `font-size: calc(var(--w) * 0.04)`).*

### 10.6 Fallbacks por componente + Global (Ken Burns)

| Componente | Primário | Fallback 1 | Fallback 2 (Estático) |
| :--- | :--- | :--- | :--- |
| **waveform** | Canvas `AnalyserNode` (60fps) | CSS `linear-gradient` animado (reduzido) | PNG estático da waveform (gerado no build) |
| **node-graph** | D3 force + Canvas/WebGL | **Bento Card**: `ul.arrows { display: grid; grid-auto-flow: column; gap: 8px }` `li::after { content: '→' }` | SVG estático (exportado do D3 no build) |
| **pip** | `<video>` overlay + `requestVideoFrameCallback` | `<img>` poster trocado a cada 500ms | Placeholder SVG com ícone "play" |
| **step-chart** | Canvas animado (reveal por passo) | SVG `<path stroke-dasharray>` animado via SMIL/CSS | SVG estático completo (sem animação) |

**Fallback Global (Modo Dynamic → Ken Burns):**
```js
if (prefersReducedMotion || !canvasSupported || gpuBlocked) {
  document.documentElement.dataset.renderMode = 'kenburns';
  // CSS: .scene { animation: kenburns 10s ease-in-out infinite alternate; }
  // @keyframes kenburns { from { transform: scale(1) translate(0,0); } to { transform: scale(1.12) translate(-2%, -3%); } }
}
```

### 10.7 Highlight Sweep (`--hl-scale`)

```css
/* Componente alvo (ex: .token, .bar, .node) */
.highlightable {
  --hl-scale: 0;
  background: linear-gradient(
    90deg,
    transparent calc(50% - var(--hl-scale) * 50%),
    var(--accent) 50%,
    transparent calc(50% + var(--hl-scale) * 50%)
  );
  background-size: 200% 100%;
  background-position: -100% 0;
  transition: background-position 0ms linear; /* JS controla frame a frame */
}
```
```js
// No loop de render (renderAt(frameIdx, tNorm)):
function renderAt(frameIdx, progress) { // progress 0..1 da cena
  const sweepDur = 0.15; // 15% da cena
  const hl = Math.min(1, progress / sweepDur); // rampa 0→1
  root.style.setProperty('--hl-scale', hl.toFixed(4));
  // Se múltiplos alvos: document.querySelectorAll('.highlightable').forEach(el => ...)
}
```
*O var `--hl-scale` controla a largura da "faixa" do gradiente (0=invisível, 1=total).*

### 10.8 Medição de texto (Pré-passe obrigatório)

```js
async function measureSceneText(sceneRoot) {
  // 1. Força layout sincronizado
  sceneRoot.style.visibility = 'hidden';
  sceneRoot.style.position = 'absolute';
  document.body.appendChild(sceneRoot);

  // 2. Canvas offscreen para measureText (fontes idênticas ao CSS)
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const style = getComputedStyle(sceneRoot);
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

  const metrics = {};
  sceneRoot.querySelectorAll('[data-measure]').forEach(el => {
    const text = el.textContent.trim();
    const tm = ctx.measureText(text);
    // getBoundingClientRect p/ altura real (line-height, fallback fonts)
    const rect = el.getBoundingClientRect();
    metrics[el.dataset.measure] = {
      width: Math.ceil(tm.actualBoundingBoxRight - tm.actualBoundingBoxLeft),
      height: Math.ceil(rect.height),
      ascent: tm.actualBoundingBoxAscent,
      descent: tm.actualBoundingBoxDescent
    };
  });

  document.body.removeChild(sceneRoot);
  sceneRoot.style.visibility = '';
  sceneRoot.style.position = '';
  return metrics; // Use para ajustar layout ANTES do frame 0
}
```
*Execute **uma vez** após montar o DOM da cena e **antes** de chamar `page.renderFrame(0)`.*