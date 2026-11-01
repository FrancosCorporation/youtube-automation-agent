/* Deterministic scene kit — no real timers, no requestAnimationFrame.
   Every animation is registered as a tween on a virtual timeline and applied
   by window.renderAt(ms), which the capture loop advances frame by frame. */
(function () {
  const MOTION = Object.freeze({ entranceMs: 460, staggerMs: 104, compactStaggerMs: 82, exitMs: 180 });

  const EASINGS = {
    linear: t => t,
    expoOut: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    easeOut: t => 1 - Math.pow(1 - t, 3),
    easeInOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    springOut: t => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      const damping = 7.5;
      const angularFrequency = 10.5;
      const dampedFrequency = Math.sqrt(angularFrequency ** 2 - damping ** 2);
      const response = progress => 1 - Math.exp(-damping * progress) * (
        Math.cos(dampedFrequency * progress)
        + (damping / dampedFrequency) * Math.sin(dampedFrequency * progress)
      );
      return response(t) / response(1);
    }
  };

  let TIMELINE = [];

  function tween(el, prop, from, to, start, dur, ease, options = {}) {
    TIMELINE.push({ el, prop, from, to, start, dur: Math.max(1, dur),
      ease: EASINGS[ease] || EASINGS.expoOut, skipBeforeStart: options.skipBeforeStart === true });
  }

  function staggerAt(start, index, stepMs = MOTION.staggerMs) {
    return (Number(start) || 0) + Math.max(0, Number(index) || 0) * stepMs;
  }

  function reveal(node, start, options = {}) {
    const duration = Math.max(1, Number(options.durationMs) || MOTION.entranceMs);
    const fromScale = Number.isFinite(Number(options.fromScale)) ? Number(options.fromScale) : 0.97;
    const offsetY = Number.isFinite(Number(options.offsetY)) ? Number(options.offsetY) : 18;
    const at = staggerAt(start, 0) + (Number(options.delayMs) || 0);
    tween(node, 'opacity', 0, 1, at, Math.min(220, duration), 'expoOut');
    tween(node, 'translateY', offsetY, 0, at, duration, 'springOut');
    tween(node, 'scale', fromScale, 1, at, duration, 'springOut');
  }

  function scheduleExit(node, sceneWindow) {
    const start = Number(sceneWindow?.startMs) || 0;
    const end = Number(sceneWindow?.endMs) || 0;
    const duration = Math.min(MOTION.exitMs, Math.floor((end - start) / 5));
    if (duration < 90) return;
    const at = end - duration;
    tween(node, 'opacity', 1, 0, at, duration, 'expoOut', { skipBeforeStart: true });
    tween(node, 'translateY', 0, -7, at, duration, 'expoOut', { skipBeforeStart: true });
    tween(node, 'scale', 1, 0.985, at, duration, 'expoOut', { skipBeforeStart: true });
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svgElement = (tag, attributes = {}, content = null) => {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, String(value)));
    if (content != null) node.textContent = content;
    return node;
  };
  const svgText = (parent, x, y, content, options = {}) => {
    const size = Number(options.size) || 20;
    const node = svgElement('text', {
      x, y, fill: options.fill || '#f1f4ef',
      'font-size': size,
      'font-weight': options.weight || 600,
      'font-family': 'Inter, system-ui, sans-serif',
      'letter-spacing': options.spacing || 0,
      'text-anchor': options.anchor || 'start',
      ...(options.maxWidth ? { textLength: options.maxWidth, lengthAdjust: 'spacingAndGlyphs' } : {}),
      ...(options.decorative === true || (options.decorative !== false && size < 20)
        ? { 'data-layout-ignore': '' } : {})
    }, content);
    parent.appendChild(node);
    return node;
  };

  const ATLAS_STORY_BEATS = Object.freeze({
    hook: {
      query: 'O que a nova busca realmente provou?',
      status: 'COMPARAÇÃO DA MESMA BATERIA',
      metric: '28 / 72  →  52 / 72',
      metricCaption: 'rodada anterior      rodada nova',
      documentTitle: 'ATLAS DE ORÇAMENTOS',
      documentLines: ['68 páginas de propostas', 'Identificador e versão', 'Trecho conferido na fonte'],
      highlight: 1
    },
    'question-set': {
      query: 'Executar 36 perguntas inéditas',
      status: 'PONTUAÇÃO MANUAL · ATÉ 2 PONTOS CADA',
      metric: '36 perguntas   ·   72 pontos',
      metricCaption: 'total da bateria',
      documentTitle: 'ATLAS · 68 PÁGINAS',
      documentLines: ['Livro de orçamentos', 'Perguntas sobre propostas', 'Sem consultar o gabarito'],
      highlight: 0
    },
    baseline: {
      query: 'Busca anterior · resposta avaliada',
      status: 'RESULTADO REGISTRADO',
      metric: '28 / 72',
      metricCaption: '38,9% do total',
      documentTitle: 'RODADA ANTERIOR',
      documentLines: ['Trechos recuperados', 'Resposta comparada ao livro', 'Nota revisada manualmente'],
      highlight: 2
    },
    retrieval: {
      query: 'ORC-RED-002  ·  versão 2',
      status: 'CONSULTA COM CONTEXTO VIZINHO',
      metric: 'ID exato  +  versão',
      metricCaption: 'cabeçalho · item · valor',
      documentTitle: 'TRECHO RECUPERADO',
      documentLines: ['ORC-RED-002', 'v2 · linha do item', 'valor no mesmo contexto'],
      highlight: 1
    },
    result: {
      query: 'Mesma bateria · busca estruturada',
      status: 'RESULTADO REGISTRADO',
      metric: '52 / 72',
      metricCaption: '72,2%  ·  24 pontos a mais',
      documentTitle: 'RESPOSTAS AVALIADAS',
      documentLines: ['Trecho localizado', 'Resposta completa conferida', 'Pontuação manual'],
      highlight: 2
    },
    coverage: {
      query: 'Recuperar ID e versão pedidos',
      status: 'COBERTURA DE IDENTIFICADORES',
      metric: '27 / 27 IDs e versões',
      metricCaption: 'cobertura não significa acerto',
      documentTitle: 'AMOSTRA COM ID EXPLÍCITO',
      documentLines: ['Pergunta 01 · ID + versão', 'Pergunta 02 · ID + versão', 'Pergunta 27 · ID + versão'],
      highlight: 1
    },
    distribution: {
      query: 'Conferir as 36 respostas',
      status: 'CLASSIFICAÇÃO DA REVISÃO',
      metric: '19 exatas  ·  14 parciais  ·  3 incorretas',
      metricCaption: 'total: 36 respostas',
      documentTitle: 'REVISÃO MANUAL',
      documentLines: ['19 · resposta exata', '14 · parcialmente correta', '3 · resposta incorreta'],
      highlight: 2
    },
    caveat: {
      query: 'Uma pergunta por chamada local',
      status: 'LIMITES DESTA AVALIAÇÃO',
      metric: 'Resultado local · pontuação manual',
      metricCaption: 'conversa completa no app não testada',
      documentTitle: 'ESCOPO DO TESTE',
      documentLines: ['Trecho recuperado por chamada', 'Nota revisada manualmente', 'Sem reavaliação independente'],
      highlight: 2
    }
  });

  function atlasStoryScene(props) {
    const beat = ATLAS_STORY_BEATS[props.beat] ? props.beat : 'hook';
    const data = ATLAS_STORY_BEATS[beat];
    const wrap = el('div', 'atlas-story-scene');
    wrap.dataset.atlasStoryBeat = beat;
    const svg = svgElement('svg', { viewBox: '0 0 1400 650', role: 'img', 'aria-label': 'Consulta sai do computador, percorre o índice e retorna com o trecho correspondente' });
    const defs = svgElement('defs');
    const screenGradient = svgElement('linearGradient', { id: 'atlas-screen', x1: '0', y1: '0', x2: '0', y2: '1' });
    screenGradient.append(svgElement('stop', { offset: '0', 'stop-color': '#17373a' }), svgElement('stop', { offset: '1', 'stop-color': '#0a1b20' }));
    const paperGradient = svgElement('linearGradient', { id: 'atlas-paper', x1: '0', y1: '0', x2: '0', y2: '1' });
    paperGradient.append(svgElement('stop', { offset: '0', 'stop-color': '#f3f1e8' }), svgElement('stop', { offset: '1', 'stop-color': '#d7ddd2' }));
    const shadow = svgElement('filter', { id: 'atlas-shadow', x: '-20%', y: '-20%', width: '140%', height: '150%' });
    shadow.appendChild(svgElement('feDropShadow', { dx: '0', dy: '15', stdDeviation: '13', 'flood-color': '#000', 'flood-opacity': '.38' }));
    defs.append(screenGradient, paperGradient, shadow);
    svg.appendChild(defs);
    svg.appendChild(svgElement('ellipse', { cx: '690', cy: '528', rx: '610', ry: '22', fill: '#020809', opacity: '.5' }));

    // Laptop: the query and result live inside a real device screen.
    const laptop = svgElement('g', { filter: 'url(#atlas-shadow)' });
    laptop.appendChild(svgElement('rect', { x: '70', y: '54', width: '515', height: '376', rx: '22', fill: '#b9c8bf', stroke: '#eef0e5', 'stroke-width': '3' }));
    laptop.appendChild(svgElement('rect', { x: '87', y: '71', width: '481', height: '338', rx: '12', fill: 'url(#atlas-screen)' }));
    laptop.appendChild(svgElement('rect', { x: '97', y: '82', width: '461', height: '38', rx: '6', fill: '#203f40' }));
    svgText(laptop, 116, 107, 'AGENTE  /  BASE DE CONHECIMENTO', { size: 16, weight: 800, fill: '#c6d7c9', spacing: 1.1 });
    laptop.appendChild(svgElement('rect', { x: '111', y: '137', width: '433', height: '60', rx: '8', fill: '#0a1a1e', stroke: '#54786d', 'stroke-width': '2' }));
    svgText(laptop, 128, 159, 'CONSULTA', { size: 12, weight: 800, fill: '#7dd3b0', spacing: 1.3 });
    svgText(laptop, 128, 185, data.query, { size: 24, weight: 700, fill: '#f4f3e9', decorative: false, maxWidth: 405 });
    svgText(laptop, 113, 222, data.status, { size: 20, weight: 800, fill: '#c5dbce', spacing: 1.0, decorative: false, maxWidth: 410 });
    laptop.appendChild(svgElement('rect', { x: '110', y: '235', width: '435', height: '105', rx: '8', fill: '#f0efe5' }));
    svgText(laptop, 130, 268, data.metric, { size: beat === 'distribution' ? 22 : 29, weight: 900, fill: '#10221c', decorative: false, maxWidth: 395 });
    svgText(laptop, 131, 298, data.metricCaption, { size: 20, weight: 700, fill: '#324c41', decorative: false, maxWidth: 395 });
    const scoreLine = svgElement('rect', { x: '130', y: '316', width: '0', height: '7', rx: '4', fill: 'var(--accent)', opacity: '.95' });
    laptop.appendChild(scoreLine);
    svgText(laptop, 315, 389, 'TELA DE RESULTADOS', { size: 11, weight: 800, fill: '#78938a', anchor: 'middle', spacing: 1.1 });
    laptop.appendChild(svgElement('path', { d: 'M59 435 L596 435 L651 477 Q654 483 644 486 L10 486 Q2 483 8 477 Z', fill: '#d4ddd1', stroke: '#f1f2e9', 'stroke-width': '2' }));
    laptop.appendChild(svgElement('path', { d: 'M106 441 H548 L580 470 H75 Z', fill: '#82958a', opacity: '.86' }));
    for (let row = 0; row < 3; row += 1) {
      laptop.appendChild(svgElement('path', { d: `M${132 + row * 4} ${448 + row * 6} H${521 - row * 4}`, stroke: '#c4cec2', 'stroke-width': '2', opacity: '.8' }));
    }
    laptop.appendChild(svgElement('path', { d: 'M286 477 L370 477 L382 481 L275 481 Z', fill: '#a9b8ad', opacity: '.8' }));
    svg.appendChild(laptop);

    // The retrieved source is a physical page in the atlas, joined to its neighboring rows.
    const file = svgElement('g', { filter: 'url(#atlas-shadow)' });
    file.appendChild(svgElement('path', { d: 'M914 110 L1245 82 L1283 446 L949 474 Z', fill: '#9caea2', opacity: '.78' }));
    file.appendChild(svgElement('path', { d: 'M897 91 L1229 62 L1268 424 L934 453 Z', fill: 'url(#atlas-paper)', stroke: '#fffdf1', 'stroke-width': '3' }));
    file.appendChild(svgElement('path', { d: 'M897 91 L1229 62 L1235 119 L903 148 Z', fill: '#d1dbcf' }));
    svgText(file, 930, 116, data.documentTitle, { size: 21, weight: 900, fill: '#263c32', spacing: .5, decorative: false, maxWidth: 290 });
    const rowY = [190, 254, 318];
    data.documentLines.forEach((line, index) => {
      const y = rowY[index];
      if (index === data.highlight) {
        file.appendChild(svgElement('path', { d: `M916 ${y - 24} L1245 ${y - 52} L1251 ${y + 8} L922 ${y + 36} Z`, fill: 'var(--accent)', opacity: '.2', stroke: 'var(--accent)', 'stroke-width': '2' }));
        file.appendChild(svgElement('path', { d: `M917 ${y - 24} L923 ${y + 36}`, stroke: 'var(--accent)', 'stroke-width': '5' }));
      }
      file.appendChild(svgElement('path', { d: `M938 ${y + 24} H${1183 - index * 25}`, stroke: '#aab8ad', 'stroke-width': '2', opacity: '.55' }));
      svgText(file, 936, y, line, { size: 22, weight: index === data.highlight ? 900 : 700, fill: '#111a16', decorative: false, maxWidth: 286 });
    });
    svgText(file, 1084, 399, beat === 'question-set' ? 'LIVRO · FONTE DO TESTE' : 'TRECHO + LINHAS VIZINHAS', { size: 16, weight: 800, fill: '#263c32', anchor: 'middle', spacing: .7, decorative: true });
    // The app boundary replaces the source page in the closing beat. Keeping
    // both layers made the phone cover the page text and fail contrast checks.
    if (beat !== 'caveat') svg.appendChild(file);

    // A visible request path connects the device to the matching page.
    svgText(svg, 767, 132, beat === 'caveat' ? 'AVALIAÇÃO LOCAL' : 'BUSCA  →  TRECHO', { size: 13, weight: 900, fill: 'var(--accent)', anchor: 'middle', spacing: 1.5 });
    const route = svgElement('path', { d: 'M613 265 C698 160 812 366 886 250', fill: 'none', stroke: '#304f49', 'stroke-width': '16', 'stroke-linecap': 'round', opacity: '.75' });
    svg.appendChild(route);
    const activeRoute = svgElement('path', { d: 'M613 265 C698 160 812 366 886 250', fill: 'none', stroke: 'var(--accent)', 'stroke-width': '5', 'stroke-linecap': 'round', opacity: '.9', pathLength: '1000' });
    activeRoute.style.strokeDasharray = '1000';
    svg.appendChild(activeRoute);
    svg.appendChild(svgElement('circle', { cx: '613', cy: '265', r: '8', fill: 'var(--accent)' }));
    svg.appendChild(svgElement('circle', { cx: '886', cy: '250', r: '8', fill: 'var(--accent)' }));
    const flowAtMs = Math.max(0, Number(props.flowAtMs) || 0);
    const flowDurationMs = Math.max(700, Math.min(1500, Number(props.durationMs) * .32 || 900));
    const packet = svgElement('circle', { class: 'atlas-packet', cx: '613', cy: '265', r: '12', fill: '#fff3bf', stroke: 'var(--accent)', 'stroke-width': '4', 'data-start-ms': (Number(props.revealAtMs) || 260) + flowAtMs + 220, 'data-duration-ms': flowDurationMs });
    svg.appendChild(packet);

    // The final scene makes the untested app boundary a physical device with a stopped route.
    if (beat === 'caveat') {
      const phone = svgElement('g', { filter: 'url(#atlas-shadow)' });
      phone.appendChild(svgElement('rect', { x: '1020', y: '100', width: '196', height: '328', rx: '23', fill: '#becbc1', stroke: '#f4f2e7', 'stroke-width': '4' }));
      phone.appendChild(svgElement('rect', { x: '1033', y: '120', width: '170', height: '276', rx: '13', fill: 'url(#atlas-screen)' }));
      svgText(phone, 1118, 168, 'APP', { size: 20, weight: 900, fill: '#c5dbce', anchor: 'middle', spacing: .8, decorative: false });
      svgText(phone, 1118, 220, 'CONVERSA', { size: 20, weight: 800, fill: '#f4f3e9', anchor: 'middle', decorative: false });
      svgText(phone, 1118, 246, 'COMPLETA', { size: 20, weight: 800, fill: '#f4f3e9', anchor: 'middle', decorative: false });
      phone.appendChild(svgElement('rect', { x: '1050', y: '278', width: '136', height: '49', rx: '8', fill: '#4d5551' }));
      svgText(phone, 1118, 309, 'NÃO TESTADA', { size: 18, weight: 900, fill: '#fff0c7', anchor: 'middle', spacing: .4, decorative: false });
      phone.appendChild(svgElement('circle', { cx: '1118', cy: '377', r: '6', fill: '#6e8e80' }));
      svg.appendChild(phone);
      const stoppedRoute = svgElement('path', { d: 'M887 250 C929 188 960 180 1008 180', fill: 'none', stroke: '#d7c08a', 'stroke-width': '4', 'stroke-dasharray': '10 11', opacity: '.82' });
      svg.appendChild(stoppedRoute);
      svg.appendChild(svgElement('path', { d: 'M991 164 L1009 182 L991 200', fill: 'none', stroke: '#d7c08a', 'stroke-width': '5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    } else {
      svg.appendChild(svgElement('path', { d: 'M964 455 H1190', stroke: '#9bad9f', 'stroke-width': '3', 'stroke-linecap': 'round' }));
      svgText(svg, 1076, 492, beat === 'coverage' ? 'ID + VERSÃO RECUPERADOS' : 'FONTE DOCUMENTAL', { size: 11, weight: 900, fill: '#8fa69a', anchor: 'middle', spacing: 1.1 });
    }

    wrap.appendChild(svg);
    const start = Number(props.revealAtMs) || 0;
    reveal(wrap, start, { offsetY: 12, fromScale: .99, durationMs: 460 });
    tween({ style: activeRoute.style }, 'dashoffset', 1000, 0, start + flowAtMs + 220, flowDurationMs, 'easeInOut');
    return wrap;
  }

  const COMPONENTS = {
    'demo-header': (props) => {
      const wrap = el('div', 'demo-header');
      wrap.appendChild(el('div', 'category', props.category || ''));
      if (Array.isArray(props.entries) && props.entries.length) wrap._headerEntries = props.entries;
      const chapterTotal = Math.max(0, Math.floor(Number(props.chapterTotal) || 0));
      const chapterIndex = Math.max(1, Math.floor(Number(props.chapterIndex) || 1));
      if (chapterTotal > 1) {
        const progress = el('div', 'chapter-progress');
        const counter = el('span', 'chapter-counter', `${String(chapterIndex).padStart(2, '0')} / ${String(chapterTotal).padStart(2, '0')}`);
        const track = el('div', 'chapter-track');
        track.setAttribute('aria-label', `Seção ${chapterIndex} de ${chapterTotal}`);
        for (let i = 1; i <= chapterTotal; i += 1) {
          const segment = el('span', 'chapter-segment');
          segment.appendChild(el('span', 'chapter-fill'));
          track.appendChild(segment);
        }
        progress.append(counter, track);
        progress.dataset.chapterIndex = String(chapterIndex);
        progress.dataset.chapterTotal = String(chapterTotal);
        progress.dataset.chapterStartMs = String(Number(props.chapterStartMs) || 0);
        progress.dataset.chapterDurationMs = String(Math.max(1, Number(props.chapterDurationMs) || 1));
        wrap.appendChild(progress);
      }
      if (props.state) {
        const right = el('div', 'state', props.state);
        if (props.index != null) {
          const counter = el('span', 'counter', `${props.index} / ${props.total}`);
          const box = el('div'); box.style.display = 'flex'; box.style.gap = 'calc(var(--h) * 0.02)'; box.style.alignItems = 'center';
          box.appendChild(counter); box.appendChild(right); wrap.appendChild(box);
        } else { wrap.appendChild(right); }
      }
      reveal(wrap, props.revealAtMs || 0, { offsetY: -10, fromScale: 0.985, durationMs: 420 });
      return wrap;
    },

    'timestamp-hud': (props) => {
      const wrap = el('div', 'timestamp-hud');
      wrap.appendChild(el('span', 'th-label', props.label || 'Pulso IA'));
      wrap.appendChild(el('span', 'th-value', props.value || '00:00'));
      tween(wrap, 'opacity', 0, 1, props.revealAtMs || 0, 1, 'linear');
      return wrap;
    },

    // Kept for a generation process that may have loaded the previous scene builder.
    'part-indicator': (props) => el('div', 'part-indicator', props.text || ''),

    'bento-card': (props) => {
      const card = el('div', 'bento');
      card.appendChild(el('div', 'b-title', props.title || ''));
      if (props.subtitle) card.appendChild(el('div', 'b-sub', props.subtitle));
      const start = props.revealAtMs || 0;
      reveal(card, start, { offsetY: 26, fromScale: 0.97, durationMs: 480 });
      return card;
    },

    'kinetic-number': (props) => {
      const wrap = el('div', 'kinetic');
      wrap.appendChild(el('div', 'num', props.value || ''));
      wrap.appendChild(el('div', 'lbl', props.label || ''));
      const start = props.revealAtMs || 0;
      reveal(wrap, start, { offsetY: 22, fromScale: 0.78, durationMs: 520 });
      return wrap;
    },

    highlight: (props) => {
      const wrap = el('div', 'highlight ' + (props.color === 'dark' ? 'dark' : props.color === 'yellow' ? '' : ''));
      const span = el('span', 'hl-text');
      span.appendChild(el('span', 'hl-copy', props.text || ''));
      wrap.appendChild(span);
      const start = props.revealAtMs || 0;
      reveal(wrap, start, { offsetY: 8, fromScale: 0.985, durationMs: 340 });
      tween(wrap, 'hlScale', 0, 1, start, props.durationMs || 320);
      return wrap;
    },

    caption: (props) => {
      const wrap = el('div', 'caption');
      (props.words || []).forEach((word) => {
        const span = el('span', 'word' + (word.kw ? ' kw' : ''), word.w);
        // data-start belongs to the HyperFrames clip contract (seconds).
        // Karaoke milliseconds must not make each word a framework clip.
        span.dataset.wordStartMs = String(word.t || 0);
        span.dataset.wordEndMs = String(word.e != null ? word.e : (word.t || 0) + 300);
        // Keep the complete sentence readable from the start of its scene;
        // the karaoke state below highlights the spoken word without hiding
        // the rest of the caption during rendered seeks.
        span.style.opacity = '1';
        wrap.appendChild(span);
      });
      return wrap;
    },

    'caption-track': (props) => {
      const wrap = el('div', 'caption');
      (props.pages || []).forEach((page) => {
        const pageNode = el('span', 'caption-page');
        pageNode.dataset.pageStartMs = String(page.startMs || 0);
        pageNode.dataset.pageEndMs = String(page.endMs || 0);
        pageNode.hidden = true;
        (page.words || []).forEach((word) => {
          const span = el('span', 'word' + (word.kw ? ' kw' : ''), word.w);
          span.dataset.wordStartMs = String(word.t || 0);
          span.dataset.wordEndMs = String(word.e != null ? word.e : (word.t || 0) + 300);
          span.style.opacity = '1';
          pageNode.appendChild(span);
        });
        wrap.appendChild(pageNode);
      });
      return wrap;
    },

    'step-chart': (props) => {
      const wrap = el('div', 'chart');
      wrap.appendChild(el('div', 'c-title', props.title || ''));
      const W = 1000, H = 360, max = Math.max(...(props.series || [1]));
      const pts = [];
      (props.series || []).forEach((v, i) => {
        const x = (i / Math.max(1, props.series.length - 1)) * W;
        const y = H - (v / max) * (H - 40) - 20;
        pts.push(`${x},${y}`);
      });
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'step');
      path.setAttribute('d', `M ${pts.join(' L ')}`);
      svg.appendChild(path);
      wrap.appendChild(svg);
      const start = props.revealAtMs || 0;
      tween(wrap, 'opacity', 0, 1, start, 220);
      path.setAttribute('pathLength', '1000');
      path.style.strokeDasharray = '1000';
      tween({ style: path.style }, 'dashoffset', 1000, 0, start, props.durationMs || 900, 'easeInOut');
      return wrap;
    },

    'node-graph': (props) => {
      const wrap = el('div', 'nodes');
      if ((props.nodes || []).length === 3) wrap.classList.add('compact-three-node-graph');
      if ((props.nodes || []).length >= 4) wrap.classList.add('compact-four-node-graph');
      (props.nodes || []).forEach((label, i) => {
        if (i > 0) {
          const wire = el('div', 'wire');
          wrap.appendChild(wire);
          const start = Math.max(props.revealAtMs || 0,
            staggerAt(props.revealAtMs || 0, i, MOTION.staggerMs) - 48);
          tween(wire, 'scale', 0, 1, start, 300, 'easeInOut');
        }
        const node = el('div', 'node', label);
        wrap.appendChild(node);
        const start = staggerAt(props.revealAtMs || 0, i, MOTION.staggerMs);
        reveal(node, start, { offsetY: 16, fromScale: 0.94, durationMs: 360 });
      });
      return wrap;
    },

    'atlas-story-scene': atlasStoryScene,

    watermark: (props) => {
      const w = el('div', 'watermark', props.text || '');
      tween(w, 'opacity', 0, 0.85, props.revealAtMs || 0, 500);
      return w;
    },

    'image-hero': (props) => {
      const wrap = el('div', 'img-hero' + (props.fit === 'contain' ? ' fitted-photo' : ''));
      if (props.fit === 'contain') {
        const backdrop = el('div', 'img-hero-backdrop');
        const background = document.createElement('img');
        background.src = props.src || '';
        background.alt = '';
        backdrop.appendChild(background);
        wrap.appendChild(backdrop);
      }
      const img = document.createElement('img');
      img.src = props.src || '';
      wrap.appendChild(img);
      wrap.appendChild(el('div', 'veil'));
      const start = props.revealAtMs || 0;
      if (props.fit !== 'contain' && !props.static) tween(img, 'scale', 1, props.strong ? 1.18 : 1.07, props.sceneWindow?.startMs || 0, props.durMs || 6000, 'linear');
      if (!props.noFade) tween(wrap, 'opacity', 0, 1, start, 400);
      return wrap;
    },

    'image-panel': (props) => {
      const wrap = el('div', 'img-panel' + (props.side === 'left' ? ' left' : ''));
      const img = document.createElement('img');
      img.src = props.src || '';
      wrap.appendChild(img);
      const start = props.revealAtMs || 0;
      tween(img, 'scale', 1.06, 1.12, 0, props.durMs || 6000, 'linear');
      reveal(wrap, start, { offsetY: 24, fromScale: 0.985, durationMs: 480 });
      return wrap;
    },

    'score-chart': (props) => {
      const wrap = el('div', 'scores' + (props.orientation === 'h' ? ' h' : ''));
      wrap.appendChild(el('div', 'sc-title', props.title || ''));
      if (props.orientation === 'h') {
        // Horizontal bars — compact rows, values to the right.
        (props.items || []).forEach((item, i) => {
          const score = Number.isFinite(Number(item.score)) ? Number(item.score) : 0;
          const row = el('div', 'hs-row');
          row.appendChild(el('div', 'hs-lbl', item.label || ''));
          const track = el('div', 'hs-track');
          const fill = el('div', 'hs-fill');
          fill.style.setProperty('--pct', String(Math.max(0, Math.min(100, Math.round(score * 10)))));
          track.appendChild(fill);
          row.appendChild(track);
          row.appendChild(el('div', 'hs-val', String(item.score)));
          wrap.appendChild(row);
          const start = staggerAt(props.revealAtMs || 0, i, MOTION.compactStaggerMs);
          reveal(row, start, { offsetY: 10, fromScale: 0.985, durationMs: 360 });
          tween(fill, 'barScale', 0, 1, start, 620, 'easeOut');
        });
      } else {
        // Vertical bars — tight together.
        const row = el('div', 'sc-row');
        (props.items || []).forEach((item, i) => {
          const score = Number.isFinite(Number(item.score)) ? Number(item.score) : 0;
          const col = el('div', 'sc-col');
          col.appendChild(el('div', 'sc-val', String(item.score)));
          const bar = el('div', 'sc-bar');
          bar.style.setProperty('--pct', String(Math.max(0, Math.min(100, Math.round(score * 10)))));
          bar.appendChild(el('div', 'sc-fill'));
          col.appendChild(bar);
          col.appendChild(el('div', 'sc-lbl', item.label || ''));
          row.appendChild(col);
          const start = staggerAt(props.revealAtMs || 0, i, MOTION.compactStaggerMs);
          reveal(col, start, { offsetY: 14, fromScale: 0.96, durationMs: 390 });
          tween(bar, 'barScale', 0, 1, start, 650, 'easeOut');
        });
        wrap.appendChild(row);
      }
      return wrap;
    },

    'progressive-comparison': (props) => {
      const wrap = el('div', 'progressive-comparison');
      const items = Array.isArray(props.items) ? props.items : [];
      const maxValue = Math.max(0, ...items.map(item => Number(item.value) || 0));
      const magnitude = maxValue > 0 ? (10 ** Math.floor(Math.log10(maxValue))) : 1;
      const scaleMax = Math.max(1, Number(props.scaleMax) || Math.ceil(maxValue / magnitude) * magnitude);
      const colors = ['var(--accent)', 'var(--cyan)', 'var(--green)', 'var(--magenta)'];
      wrap.appendChild(el('div', 'pc-title', props.title || 'Comparação'));
      wrap.appendChild(el('div', 'pc-unit', props.unitLabel || 'Escala linear'));

      items.forEach((item, index) => {
        const value = Math.max(0, Number(item.value) || 0);
        const revealAt = (Number(props.revealAtMs) || 0) + Math.max(0, Number(item.revealAfterMs) || 0);
        const nextReveal = items[index + 1]
          ? (Number(props.revealAtMs) || 0) + Math.max(0, Number(items[index + 1].revealAfterMs) || 0)
          : Number(props.sceneWindow?.endMs) || revealAt + 2400;
        const row = el('div', 'pc-row');
        row.dataset.activeStartMs = String(revealAt);
        row.dataset.activeEndMs = String(Math.max(revealAt + 1, nextReveal));
        row.style.setProperty('--pc-color', colors[index % colors.length]);

        const heading = el('div', 'pc-row-heading');
        heading.appendChild(el('div', 'pc-label', String(item.label || '').slice(0, 30)));
        heading.appendChild(el('div', 'pc-value', `${value}${item.unit || ''}`));
        row.appendChild(heading);

        const track = el('div', 'pc-track');
        const fill = el('div', 'pc-fill');
        fill.style.setProperty('--pc-pct', String(Math.max(0, Math.min(100, (value / scaleMax) * 100))));
        track.appendChild(fill);
        row.appendChild(track);
        reveal(row, revealAt, { offsetY: 12, fromScale: 0.985, durationMs: 420 });
        tween(fill, 'barScale', 0, 1, revealAt, 760, 'easeOut');
        wrap.appendChild(row);
      });

      const axis = el('div', 'pc-axis');
      axis.appendChild(el('div', 'pc-axis-caption', props.unitLabel || 'Valor'));
      const scale = el('div', 'pc-scale');
      [0, 0.25, 0.5, 0.75, 1].forEach(ratio => {
        const tick = el('span', 'pc-tick');
        const value = Math.round(scaleMax * ratio);
        tick.style.left = `${ratio * 100}%`;
        tick.appendChild(el('span', 'pc-tick-mark'));
        tick.appendChild(el('span', 'pc-tick-label', String(value)));
        scale.appendChild(tick);
      });
      axis.appendChild(scale);
      wrap.appendChild(axis);
      if (props.sourceLabel) wrap.appendChild(el('div', 'pc-source', props.sourceLabel));
      return wrap;
    },

    'compare-table': (props) => {
      const wrap = el('div', 'compare-table');
      wrap.appendChild(el('div', 'ct-title', props.title || 'Comparação'));
      const head = el('div', 'ct-row ct-head');
      head.appendChild(el('span', 'ct-label', 'OPÇÃO'));
      head.appendChild(el('span', 'ct-value', 'NOTA'));
      wrap.appendChild(head);
      (props.items || []).slice(0, 4).forEach((item, i) => {
        const row = el('div', 'ct-row');
        row.appendChild(el('span', 'ct-label', String(item.label || `Item ${i + 1}`).slice(0, 24)));
        row.appendChild(el('span', 'ct-value', String(item.score ?? '—')));
        wrap.appendChild(row);
        const start = staggerAt(props.revealAtMs || 0, i, MOTION.compactStaggerMs);
        reveal(row, start, { offsetY: 18, fromScale: 0.985, durationMs: 340 });
      });
      return wrap;
    },

    checklist: (props) => {
      const wrap = el('div', 'checklist');
      wrap.appendChild(el('div', 'ck-title', props.title || 'Pontos principais'));
      (props.items || []).slice(0, 4).forEach((item, i) => {
        const row = el('div', 'ck-row');
        row.appendChild(el('span', 'ck-mark', String(i + 1).padStart(2, '0')));
        row.appendChild(el('span', 'ck-copy', String(item || '')));
        wrap.appendChild(row);
        const start = staggerAt(props.revealAtMs || 0, i, MOTION.compactStaggerMs);
        reveal(row, start, { offsetY: 20, fromScale: 0.985, durationMs: 360 });
        tween(row.children[0], 'scale', 0.72, 1, start, 360, 'springOut');
      });
      return wrap;
    },

    'rotation-cards': (props) => {
      const wrap = el('div', 'rotation-cards');
      if (props.title) wrap.appendChild(el('div', 'rc-title', props.title));
      const cards = (props.cards || []).slice(0, 3);
      cards.forEach((copy, i) => {
        const card = el('div', `rc-card rc-card-${i + 1}`);
        card.appendChild(el('span', 'rc-index', String(i + 1).padStart(2, '0')));
        card.appendChild(el('span', 'rc-copy', String(copy || '')));
        card.style.zIndex = String(i + 1);
        card.style.left = `${i * 2}%`;
        card.style.top = `${i * 32}%`;
        wrap.appendChild(card);
        const targetAngle = (i - 1) * 1.5;
        const start = staggerAt(props.revealAtMs || 0, i, MOTION.compactStaggerMs);
        tween(card, 'opacity', 0, 1, start, 200, 'expoOut');
        tween(card, 'translateY', 28, 0, start, 420, 'springOut');
        tween(card, 'scale', 0.96, 1, start, 420, 'springOut');
        tween(card, 'rotate', targetAngle + (i - 1) * 2, targetAngle, start, 460, 'springOut');
      });
      return wrap;
    },

    'news-card': (props) => {
      const wrap = el('div', 'news-card');
      const head = el('div', 'nc-head');
      head.appendChild(el('div', 'nc-avatar', (props.source || 'N').slice(0, 1).toUpperCase()));
      const who = el('div', 'nc-who');
      who.appendChild(el('div', 'nc-name', props.source || 'Fonte'));
      who.appendChild(el('div', 'nc-handle', props.sourceTypeLabel || ('notícia · ' + (props.time || 'recente'))));
      head.appendChild(who);
      wrap.appendChild(head);
      wrap.appendChild(el('div', 'nc-text', props.title || ''));
      wrap.appendChild(el('div', 'nc-foot', props.referenceLabel || 'Referência da imprensa — Google News'));
      const start = props.revealAtMs || 0;
      reveal(wrap, start, { offsetY: 18, fromScale: 0.97, durationMs: 440 });
      return wrap;
    },

    'article-print': (props) => {
      const wrap = el('div', 'article-print');
      const img = document.createElement('img');
      img.src = props.src || '';
      wrap.appendChild(img);
      const bar = el('div', 'ap-bar');
      bar.appendChild(el('span', 'ap-src', props.source || 'G1'));
      bar.appendChild(el('span', 'ap-time', props.time || 'hoje'));
      wrap.appendChild(bar);
      const start = props.revealAtMs || 0;
      reveal(wrap, start, { offsetY: 18, fromScale: 0.98, durationMs: 460 });
      return wrap;
    },

    'spec-chips': (props) => {
      const wrap = el('div', 'chips');
      (props.items || []).forEach((chip, i) => {
        const c = el('div', 'chip');
        c.appendChild(el('span', 'chip-val', chip.value));
        if (chip.label) c.appendChild(el('span', 'chip-lbl', chip.label));
        wrap.appendChild(c);
        const start = staggerAt(props.revealAtMs || 0, i, MOTION.compactStaggerMs);
        reveal(c, start, { offsetY: 12, fromScale: 0.88, durationMs: 380 });
      });
      return wrap;
    },

    'line-chart': (props) => {
      const wrap = el('div', 'scores line');
      wrap.appendChild(el('div', 'sc-title', props.title || ''));
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 1000 420');
      const items = props.items || [];
      const pts = items.map((it, i) => {
        const x = items.length === 1 ? 500 : 90 + (i / (items.length - 1)) * 820;
        const score = Number.isFinite(Number(it.score)) ? Number(it.score) : 0;
        const y = 370 - (score / 10) * 330;
        return { x, y, score: it.score, label: it.label };
      });
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'lc-path');
      path.setAttribute('d', 'M ' + pts.map(p => `${p.x},${p.y}`).join(' L '));
      svg.appendChild(path);
      pts.forEach((p, i) => {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('class', 'lc-dot');
        dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); dot.setAttribute('r', 10);
        svg.appendChild(dot);
        const val = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        val.setAttribute('class', 'lc-val');
        val.setAttribute('x', p.x); val.setAttribute('y', p.y - 22);
        val.textContent = String(p.score);
        svg.appendChild(val);
        const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        lbl.setAttribute('class', 'lc-lbl');
        lbl.setAttribute('x', p.x); lbl.setAttribute('y', 408);
        lbl.textContent = String(p.label || '').slice(0, 18);
        svg.appendChild(lbl);
        tween(dot, 'opacity', 0, 1, (props.revealAtMs || 0) + 400 + i * 150, 200);
      });
      wrap.appendChild(svg);
      const start = props.revealAtMs || 0;
      tween(wrap, 'opacity', 0, 1, start, 220);
      path.style.strokeDasharray = '1400';
      tween({ style: path.style }, 'dashoffset', 1400, 0, start, 950, 'easeInOut');
      return wrap;
    },

    'donut-chart': (props) => {
      const wrap = el('div', 'scores donut');
      wrap.appendChild(el('div', 'sc-title', props.title || ''));
      const row = el('div', 'dn-row');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 400 400');
      const items = props.items || [];
      const total = items.reduce((n, it) => n + (Number(it.score) || 0), 0) || 1;
      const C = 2 * Math.PI * 150;
      const colors = ['var(--accent)', 'var(--cyan)', 'var(--green)', 'var(--magenta)'];
      let cum = 0;
      items.forEach((it, i) => {
        const frac = (Number(it.score) || 0) / total;
        const seg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        seg.setAttribute('class', 'dn-seg');
        seg.setAttribute('cx', 200); seg.setAttribute('cy', 200); seg.setAttribute('r', 150);
        seg.setAttribute('stroke', colors[i % colors.length]);
        seg.style.strokeDasharray = `${frac * C} ${C}`;
        seg.style.strokeDashoffset = String(frac * C);
        seg.setAttribute('transform', `rotate(${(cum * 360) - 90} 200 200)`);
        svg.appendChild(seg);
        tween({ style: seg.style }, 'dashoffset', frac * C, 0, (props.revealAtMs || 0) + i * 220, 640, 'easeInOut');
        cum += frac;
      });
      row.appendChild(svg);
      const legend = el('div', 'dn-legend');
      items.forEach((it, i) => {
        const li = el('div', 'dn-item');
        const dot = el('span', 'dn-dot');
        dot.style.background = colors[i % colors.length];
        li.appendChild(dot);
        li.appendChild(el('span', 'dn-name', String(it.label || '').slice(0, 18)));
        li.appendChild(el('span', 'dn-val', String(it.score)));
        legend.appendChild(li);
        reveal(li, staggerAt(props.revealAtMs || 0, i, MOTION.compactStaggerMs), {
          offsetY: 8, fromScale: 0.985, durationMs: 340
        });
      });
      row.appendChild(legend);
      wrap.appendChild(row);
      tween(wrap, 'opacity', 0, 1, props.revealAtMs || 0, 220);
      return wrap;
    },

    'rank-list': (props) => {
      const wrap = el('div', 'scores rank');
      wrap.appendChild(el('div', 'sc-title', props.title || ''));
      const sorted = [...(props.items || [])].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
      sorted.forEach((it, i) => {
        const row = el('div', 'rk-row');
        row.appendChild(el('div', 'rk-pos', `${i + 1}º`));
        row.appendChild(el('div', 'rk-name', String(it.label || '').slice(0, 20)));
        row.appendChild(el('div', 'rk-val', String(it.score)));
        if (i === 0) row.classList.add('first');
        wrap.appendChild(row);
        const start = staggerAt(props.revealAtMs || 0, i, MOTION.compactStaggerMs);
        tween(row, 'opacity', 0, 1, start, 200, 'expoOut');
        tween(row, 'translateX', -28, 0, start, 380, 'springOut');
        tween(row, 'scale', 0.985, 1, start, 380, 'springOut');
      });
      return wrap;
    },

    'progress-bar': (props) => {
      const wrap = el('div', 'pbar');
      wrap.appendChild(el('div', 'pb-lbl', props.label || ''));
      const track = el('div', 'pb-track');
      const fill = el('div', 'pb-fill');
      fill.style.setProperty('--pct', String(Math.max(2, Math.min(100, Math.round(props.value || 0)))));
      track.appendChild(fill);
      wrap.appendChild(track);
      wrap.appendChild(el('div', 'pb-val', (props.value || 0) + '%'));
      const start = props.revealAtMs || 0;
      reveal(wrap, start, { offsetY: 10, fromScale: 0.99, durationMs: 380 });
      tween(fill, 'barScale', 0, 1, start, 900, 'easeOut');
      return wrap;
    },

    'clip-title': (props) => {
      const wrap = el('div', 'clip-title');
      (props.words || []).forEach((w, i) => {
        const s = el('span', 'ct-word', w);
        wrap.appendChild(s);
        const t = staggerAt(props.revealAtMs || 0, i, MOTION.staggerMs);
        tween(s, 'opacity', 0, 1, t, 260);
        tween(s, 'translateY', 30, 0, t, 460, 'springOut');
        tween(s, 'scale', 0.98, 1, t, 460, 'springOut');
      });
      return wrap;
    },

    'pulse-glow': (props) => {
      const w = el('div', 'pulse-glow');
      tween(w, 'opacity', 0.22, 0.5, props.revealAtMs || 0, props.durMs || 8000, 'easeInOut');
      return w;
    }
  };

  window.buildScene = function (scene) {
    TIMELINE = [];
    window.SPEECH_ENVELOPE = scene.speechEnvelope || null;
    const sceneRoot = document.getElementById('scene-root') || document.body;
    sceneRoot.innerHTML = '';
    const root = el('div', 'scene');
    if (scene.minimal) root.classList.add('minimal');
    if (scene.portraitPhoto) root.classList.add('portrait-photo');
    if (scene.split) root.classList.add('split');
    if (scene.splitLeft) root.classList.add('splitL');
    if (scene.hero) root.classList.add('hero');
    if (scene.presenter) root.classList.add('has-presenter');
    if (scene.steadyNarrative) root.classList.add('steady-narrative');
    if (scene.explanatorySocial) root.classList.add('explanatory-social');
    if (scene.steadyNarrative && (scene.components || []).some(component => component.type === 'progress-bar')) {
      root.classList.add('has-narrative-progress');
    }
    if (scene.presenterShot?.side === 'left' && !scene.presenterShot.hidden) root.classList.add('presenter-left');
    if (scene.presenterShot?.hidden) root.classList.remove('has-presenter');
    if (scene.background && scene.background.accent) {
      document.documentElement.style.setProperty('--accent', scene.background.accent);
    }
    (scene.components || []).forEach((component) => {
      const render = COMPONENTS[component.type];
      if (render) {
        const node = render(component);
        if (component.sceneWindow) {
          node.dataset.sceneWindowStartMs = String(component.sceneWindow.startMs || 0);
          node.dataset.sceneWindowEndMs = String(component.sceneWindow.endMs || 0);
          scheduleExit(node, component.sceneWindow);
        }
        root.appendChild(node);
      }
    });
    sceneRoot.appendChild(root);
    return true;
  };

  window.waitForImages = function () {
    const imgs = Array.from(document.images || []);
    const imageLoads = imgs.map(im => im.complete ? 1 : new Promise(r => { im.onload = im.onerror = r; }));
    return Promise.all(imageLoads);
  };

  window.renderAt = function (ms) {
    const transforms = new Map();
    const tf = el2 => transforms.get(el2) || transforms.set(el2, { x: 0, y: 0, s: 1, r: 0 }).get(el2);
    for (const t of TIMELINE) {
      if (t.skipBeforeStart && ms < t.start) continue;
      const p = Math.min(1, Math.max(0, (ms - t.start) / t.dur));
      const v = t.from + (t.to - t.from) * t.ease(p);
      const target = t.el;
      if (t.prop === 'opacity') target.style.opacity = v;
      else if (t.prop === 'translateY') tf(target).y = v;
      else if (t.prop === 'translateX') tf(target).x = v;
      else if (t.prop === 'scale') tf(target).s = v;
      else if (t.prop === 'rotate') tf(target).r = v;
      else if (t.prop === 'dashoffset') target.style.strokeDashoffset = v;
      else if (t.prop === 'hlScale') target.style.setProperty('--hl-scale', v);
      else if (t.prop === 'barScale') target.style.setProperty('--bar-p', String(v));
    }
    for (const [node, v] of transforms) {
      node.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s}) rotate(${v.r}deg)`;
    }
    for (const packet of document.querySelectorAll('.atlas-packet')) {
      const start = Number(packet.dataset.startMs) || 0;
      const duration = Math.max(1, Number(packet.dataset.durationMs) || 1);
      const progress = Math.max(0, Math.min(1, (ms - start) / duration));
      packet.setAttribute('cx', String(613 + (886 - 613) * progress));
      packet.setAttribute('cy', String(265 - Math.sin(progress * Math.PI) * 18));
      packet.style.opacity = progress > 0 && progress < 1 ? '1' : '0';
    }
    // Karaokê: destaca a palavra que está sendo falada agora.
    for (const header of document.querySelectorAll('.demo-header')) {
      const entries = Array.isArray(header._headerEntries) ? header._headerEntries : [];
      const entry = entries.find(item => ms >= item.startMs && ms < item.endMs);
      if (entry) {
        const category = header.querySelector('.category');
        if (category && category.textContent !== entry.category) category.textContent = entry.category;
      }
      const progress = header.querySelector('.chapter-progress');
      if (!progress) continue;
      const chapterIndex = Math.max(1, Number(entry?.chapterIndex || progress.dataset.chapterIndex) || 1);
      const chapterTotal = Math.max(1, Number(entry?.chapterTotal || progress.dataset.chapterTotal) || 1);
      const chapterStartMs = entry
        ? Number(entry.chapterStartMs) || 0
        : Number(progress.dataset.chapterStartMs) || 0;
      const chapterDurationMs = Math.max(1, Number(
        entry?.chapterDurationMs || progress.dataset.chapterDurationMs
      ) || 1);
      const localElapsedMs = entry ? ms - (Number(entry.startMs) || 0) : ms;
      const ratio = Math.max(0, Math.min(1, (chapterStartMs + localElapsedMs) / chapterDurationMs));
      const counter = progress.querySelector('.chapter-counter');
      if (counter) counter.textContent = `${String(chapterIndex).padStart(2, '0')} / ${String(chapterTotal).padStart(2, '0')}`;
      progress.querySelector('.chapter-track')?.setAttribute('aria-label', `Seção ${chapterIndex} de ${chapterTotal}`);
      progress.querySelectorAll('.chapter-segment').forEach((segment, index) => {
        const segmentIndex = index + 1;
        segment.classList.toggle('complete', segmentIndex < chapterIndex);
        segment.classList.toggle('active', segmentIndex === chapterIndex);
        const fill = segment.querySelector('.chapter-fill');
        if (fill) fill.style.transform = `scaleX(${segmentIndex < chapterIndex ? 1 : segmentIndex === chapterIndex ? ratio : 0})`;
      });
    }
    for (const page of document.querySelectorAll('.caption-page')) {
      const start = Number(page.dataset.pageStartMs || 0);
      const end = Number(page.dataset.pageEndMs || 0);
      page.hidden = ms < start || ms >= end;
    }
    for (const component of document.querySelectorAll('[data-scene-window-start-ms]')) {
      const start = Number(component.dataset.sceneWindowStartMs || 0);
      const end = Number(component.dataset.sceneWindowEndMs || 0);
      component.hidden = ms < start || ms >= end;
    }
    for (const word of document.querySelectorAll('.caption .word')) {
      const s = Number(word.dataset.wordStartMs || 0);
      const e = Number(word.dataset.wordEndMs || 0);
      if (ms >= e) { word.classList.add('spoken'); word.classList.remove('active'); }
      else if (ms >= s) { word.classList.add('active'); word.classList.remove('spoken'); }
      else { word.classList.remove('active', 'spoken'); }
    }
    for (const row of document.querySelectorAll('.pc-row')) {
      const start = Number(row.dataset.activeStartMs || 0);
      const end = Number(row.dataset.activeEndMs || 0);
      row.classList.toggle('active', ms >= start && ms < end);
    }
    return true;
  };
})();
