/* Deterministic scene kit — no real timers, no requestAnimationFrame.
   Every animation is registered as a tween on a virtual timeline and applied
   by window.renderAt(ms), which the capture loop advances frame by frame. */
(function () {
  const EASINGS = {
    linear: t => t,
    expoOut: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    easeOut: t => 1 - Math.pow(1 - t, 3),
    easeInOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    backOut: t => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2)
  };

  let TIMELINE = [];

  function tween(el, prop, from, to, start, dur, ease) {
    TIMELINE.push({ el, prop, from, to, start, dur: Math.max(1, dur), ease: EASINGS[ease] || EASINGS.expoOut });
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  const COMPONENTS = {
    'demo-header': (props) => {
      const wrap = el('div', 'demo-header');
      wrap.appendChild(el('div', 'category', props.category || ''));
      if (props.state) {
        const right = el('div', 'state', props.state);
        if (props.index != null) {
          const counter = el('span', 'counter', `${props.index} / ${props.total}`);
          const box = el('div'); box.style.display = 'flex'; box.style.gap = 'calc(var(--h) * 0.02)'; box.style.alignItems = 'center';
          box.appendChild(counter); box.appendChild(right); wrap.appendChild(box);
        } else { wrap.appendChild(right); }
      }
      tween(wrap, 'opacity', 0, 1, props.revealAtMs || 0, 260);
      tween(wrap, 'translateY', -14, 0, props.revealAtMs || 0, 420);
      return wrap;
    },

    'bento-card': (props) => {
      const card = el('div', 'bento');
      card.appendChild(el('div', 'b-title', props.title || ''));
      if (props.subtitle) card.appendChild(el('div', 'b-sub', props.subtitle));
      const start = props.revealAtMs || 0;
      tween(card, 'opacity', 0, 1, start, 300);
      tween(card, 'translateY', 26, 0, start, 460, 'expoOut');
      tween(card, 'scale', 0.97, 1, start, 460, 'expoOut');
      return card;
    },

    'kinetic-number': (props) => {
      const wrap = el('div', 'kinetic');
      wrap.appendChild(el('div', 'num', props.value || ''));
      wrap.appendChild(el('div', 'lbl', props.label || ''));
      const start = props.revealAtMs || 0;
      tween(wrap, 'opacity', 0, 1, start, 200);
      tween(wrap, 'scale', 0.6, 1, start, 520, 'backOut');
      return wrap;
    },

    highlight: (props) => {
      const wrap = el('div', 'highlight ' + (props.color === 'dark' ? 'dark' : props.color === 'yellow' ? '' : ''));
      const span = el('span', 'hl-text');
      span.appendChild(el('span', 'hl-copy', props.text || ''));
      wrap.appendChild(span);
      const start = props.revealAtMs || 0;
      tween(wrap, 'opacity', 0, 1, start, 120);
      tween(wrap, 'hlScale', 0, 1, start, props.durationMs || 320);
      return wrap;
    },

    caption: (props) => {
      const wrap = el('div', 'caption');
      (props.words || []).forEach((word) => {
        const span = el('span', 'word' + (word.kw ? ' kw' : ''), word.w);
        span.dataset.start = String(word.t || 0);
        span.dataset.end = String(word.e != null ? word.e : (word.t || 0) + 300);
        wrap.appendChild(span);
        tween(span, 'opacity', 0, 1, word.t, 160);
        tween(span, 'translateY', 10, 0, word.t, 220, 'easeOut');
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
      (props.nodes || []).forEach((label, i) => {
        if (i > 0) {
          const wire = el('div', 'wire');
          wrap.appendChild(wire);
          const start = (props.revealAtMs || 0) + i * 260;
          tween(wire, 'scale', 0, 1, start, 300, 'easeInOut');
        }
        const node = el('div', 'node', label);
        wrap.appendChild(node);
        const start = (props.revealAtMs || 0) + i * 260;
        tween(node, 'opacity', 0, 1, start, 220);
        tween(node, 'translateY', 16, 0, start, 320, 'expoOut');
      });
      return wrap;
    },

    watermark: (props) => {
      const w = el('div', 'watermark', props.text || '');
      tween(w, 'opacity', 0, 0.85, props.revealAtMs || 0, 500);
      return w;
    },

    'image-hero': (props) => {
      const wrap = el('div', 'img-hero');
      const img = document.createElement('img');
      img.src = props.src || '';
      wrap.appendChild(img);
      wrap.appendChild(el('div', 'veil'));
      const start = props.revealAtMs || 0;
      tween(img, 'scale', 1, props.strong ? 1.18 : 1.07, 0, props.durMs || 6000, 'linear');
      tween(wrap, 'opacity', 0, 1, start, 400);
      return wrap;
    },

    'image-panel': (props) => {
      const wrap = el('div', 'img-panel' + (props.side === 'left' ? ' left' : ''));
      const img = document.createElement('img');
      img.src = props.src || '';
      wrap.appendChild(img);
      const start = props.revealAtMs || 0;
      tween(img, 'scale', 1.06, 1.12, 0, props.durMs || 6000, 'linear');
      tween(wrap, 'opacity', 0, 1, start, 360);
      tween(wrap, 'translateY', 24, 0, start, 480, 'expoOut');
      return wrap;
    },

    'score-chart': (props) => {
      const wrap = el('div', 'scores' + (props.orientation === 'h' ? ' h' : ''));
      wrap.appendChild(el('div', 'sc-title', props.title || ''));
      if (props.orientation === 'h') {
        // Horizontal bars — compact rows, values to the right.
        (props.items || []).forEach((item, i) => {
          const row = el('div', 'hs-row');
          row.appendChild(el('div', 'hs-lbl', item.label || ''));
          const track = el('div', 'hs-track');
          const fill = el('div', 'hs-fill');
          fill.style.setProperty('--pct', String(Math.max(4, Math.min(100, Math.round((Number(item.score) || 5) * 10)))));
          track.appendChild(fill);
          row.appendChild(track);
          row.appendChild(el('div', 'hs-val', String(item.score)));
          wrap.appendChild(row);
          const start = (props.revealAtMs || 0) + i * 180;
          tween(row, 'opacity', 0, 1, start, 200);
          tween(fill, 'barScale', 0, 1, start, 620, 'backOut');
        });
      } else {
        // Vertical bars — tight together.
        const row = el('div', 'sc-row');
        (props.items || []).forEach((item, i) => {
          const col = el('div', 'sc-col');
          col.appendChild(el('div', 'sc-val', String(item.score)));
          const bar = el('div', 'sc-bar');
          bar.style.setProperty('--pct', String(Math.max(6, Math.min(100, Math.round((Number(item.score) || 5) * 10)))));
          bar.appendChild(el('div', 'sc-fill'));
          col.appendChild(bar);
          col.appendChild(el('div', 'sc-lbl', item.label || ''));
          row.appendChild(col);
          const start = (props.revealAtMs || 0) + i * 200;
          tween(col, 'opacity', 0, 1, start, 220);
          tween(bar, 'barScale', 0, 1, start, 650, 'backOut');
        });
        wrap.appendChild(row);
      }
      return wrap;
    },

    'news-card': (props) => {
      const wrap = el('div', 'news-card');
      const head = el('div', 'nc-head');
      head.appendChild(el('div', 'nc-avatar', (props.source || 'N').slice(0, 1).toUpperCase()));
      const who = el('div', 'nc-who');
      who.appendChild(el('div', 'nc-name', props.source || 'Fonte'));
      who.appendChild(el('div', 'nc-handle', 'notícia · ' + (props.time || 'recente')));
      head.appendChild(who);
      wrap.appendChild(head);
      wrap.appendChild(el('div', 'nc-text', props.title || ''));
      wrap.appendChild(el('div', 'nc-foot', 'Referência da imprensa — Google News'));
      const start = props.revealAtMs || 0;
      tween(wrap, 'opacity', 0, 1, start, 300);
      tween(wrap, 'translateY', 18, 0, start, 440, 'expoOut');
      tween(wrap, 'scale', 0.97, 1, start, 440, 'expoOut');
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
      tween(wrap, 'opacity', 0, 1, start, 300);
      tween(wrap, 'translateY', 18, 0, start, 460, 'expoOut');
      tween(wrap, 'scale', 0.98, 1, start, 460, 'expoOut');
      return wrap;
    },

    'spec-chips': (props) => {
      const wrap = el('div', 'chips');
      (props.items || []).forEach((chip, i) => {
        const c = el('div', 'chip');
        c.appendChild(el('span', 'chip-val', chip.value));
        if (chip.label) c.appendChild(el('span', 'chip-lbl', chip.label));
        wrap.appendChild(c);
        const start = (props.revealAtMs || 0) + i * 160;
        tween(c, 'opacity', 0, 1, start, 200);
        tween(c, 'translateY', 12, 0, start, 300, 'expoOut');
        tween(c, 'scale', 0.85, 1, start, 380, 'backOut');
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
        const y = 370 - ((Number(it.score) || 5) / 10) * 330;
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
        tween(li, 'opacity', 0, 1, (props.revealAtMs || 0) + i * 180, 200);
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
        const start = (props.revealAtMs || 0) + i * 200;
        tween(row, 'opacity', 0, 1, start, 200);
        tween(row, 'translateX', -28, 0, start, 380, 'expoOut');
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
      tween(wrap, 'opacity', 0, 1, start, 200);
      tween(fill, 'barScale', 0, 1, start, 900, 'easeInOut');
      return wrap;
    },

    'clip-title': (props) => {
      const wrap = el('div', 'clip-title');
      (props.words || []).forEach((w, i) => {
        const s = el('span', 'ct-word', w);
        wrap.appendChild(s);
        const t = (props.revealAtMs || 0) + i * 140;
        tween(s, 'opacity', 0, 1, t, 260);
        tween(s, 'translateY', 30, 0, t, 460, 'expoOut');
      });
      return wrap;
    },

    'pulse-glow': (props) => {
      const w = el('div', 'pulse-glow');
      tween(w, 'opacity', 0.22, 0.5, props.revealAtMs || 0, props.durMs || 8000, 'easeInOut');
      return w;
    },

    'clip-progress': (props) => {
      const w = el('div', 'clip-progress');
      const fill = el('div', 'cp-fill');
      w.appendChild(fill);
      tween(fill, 'barScale', 0, 1, 0, props.durMs || 8000, 'linear');
      return w;
    }
  };

  window.buildScene = function (scene) {
    TIMELINE = [];
    window.SPEECH_ENVELOPE = scene.speechEnvelope || null;
    const sceneRoot = document.getElementById('scene-root') || document.body;
    sceneRoot.innerHTML = '';
    const root = el('div', 'scene');
    if (scene.split) root.classList.add('split');
    if (scene.splitLeft) root.classList.add('splitL');
    if (scene.hero) root.classList.add('hero');
    if (scene.presenter) root.classList.add('has-presenter');
    if (scene.background && scene.background.accent) {
      document.documentElement.style.setProperty('--accent', scene.background.accent);
    }
    (scene.components || []).forEach((component) => {
      const render = COMPONENTS[component.type];
      if (render) root.appendChild(render(component));
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
    const tf = el2 => transforms.get(el2) || transforms.set(el2, { x: 0, y: 0, s: 1 }).get(el2);
    for (const t of TIMELINE) {
      const p = Math.min(1, Math.max(0, (ms - t.start) / t.dur));
      const v = t.from + (t.to - t.from) * t.ease(p);
      const target = t.el;
      if (t.prop === 'opacity') target.style.opacity = v;
      else if (t.prop === 'translateY') tf(target).y = v;
      else if (t.prop === 'translateX') tf(target).x = v;
      else if (t.prop === 'scale') tf(target).s = v;
      else if (t.prop === 'dashoffset') target.style.strokeDashoffset = v;
      else if (t.prop === 'hlScale') target.style.setProperty('--hl-scale', v);
      else if (t.prop === 'barScale') target.style.setProperty('--bar-p', String(v));
    }
    for (const [node, v] of transforms) {
      node.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
    }
    // Karaokê: destaca a palavra que está sendo falada agora.
    for (const word of document.querySelectorAll('.caption .word')) {
      const s = Number(word.dataset.start || 0);
      const e = Number(word.dataset.end || 0);
      if (ms >= e) { word.classList.add('spoken'); word.classList.remove('active'); }
      else if (ms >= s) { word.classList.add('active'); word.classList.remove('spoken'); }
      else { word.classList.remove('active', 'spoken'); }
    }
    return true;
  };
})();
