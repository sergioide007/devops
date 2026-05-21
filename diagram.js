/* diagram.js — Interactive diagram renderer for the DevOps viewer
   Supports: Mermaid (primary). Adds animated flow dots, pan/zoom,
   copy-source and live-editor toolbar.
   Called by viewer.js after markdown renders: dvProcessDiagrams(container). */
(function () {
  'use strict';

  const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.3/dist/mermaid.min.js';
  let mermaidReady  = null;
  let mermaidInited = false;
  let diagCounter   = 0;

  // ── PUBLIC API ──────────────────────────────────────────────────
  window.dvProcessDiagrams = async function (container) {
    const blocks = container.querySelectorAll('code.language-mermaid');
    if (!blocks.length) return;

    try { await ensureMermaid(); }
    catch (e) { console.warn('diagram.js: failed to load Mermaid', e); return; }

    blocks.forEach(codeEl => {
      const source = codeEl.textContent.trim();
      const pre    = codeEl.closest('pre');
      if (!pre) return;
      // addCopyButtons() wrapped <pre> in a div containing .code-header — replace that whole wrapper
      const target = pre.parentElement && pre.parentElement.querySelector('.code-header')
        ? pre.parentElement
        : pre;
      renderDiagram(source, target);
    });
  };

  // ── MERMAID LOADER ──────────────────────────────────────────────
  function ensureMermaid() {
    if (mermaidReady) return mermaidReady;
    mermaidReady = new Promise((resolve, reject) => {
      if (window.mermaid) { initMermaid(); resolve(); return; }
      const s   = document.createElement('script');
      s.src     = MERMAID_CDN;
      s.onload  = () => { initMermaid(); resolve(); };
      s.onerror = err => { mermaidReady = null; reject(err); };
      document.head.appendChild(s);
    });
    return mermaidReady;
  }

  function initMermaid() {
    if (mermaidInited || !window.mermaid) return;
    mermaidInited = true;
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        primaryColor:        '#1e2635',
        primaryTextColor:    '#e6edf3',
        primaryBorderColor:  '#00a872',
        lineColor:           '#00e5a0',
        secondaryColor:      '#161b22',
        tertiaryColor:       '#0d1117',
        mainBkg:             '#21262d',
        nodeBorder:          '#00a872',
        clusterBkg:          '#161b22',
        clusterBorder:       '#30363d',
        titleColor:          '#e6edf3',
        edgeLabelBackground: '#21262d',
        fontFamily:          "'IBM Plex Mono', 'Courier New', monospace",
        fontSize:            '13px',
        tertiaryTextColor:   '#9ca3af',
        labelBackground:     '#21262d',
      }
    });
  }

  // ── RENDER ──────────────────────────────────────────────────────
  function renderDiagram(source, targetEl) {
    const id     = diagCounter++;
    const widget = document.createElement('div');
    widget.className = 'diagram-widget';

    widget.innerHTML = `
      <div class="diagram-toolbar">
        <div class="diagram-tb-left">
          <span class="diagram-badge">diagram</span>
          <span class="diagram-chip">mermaid</span>
        </div>
        <div class="diagram-tb-right">
          <button class="diag-btn" data-action="copy">Copy source</button>
          <button class="diag-btn" data-action="live">&#11041; Live Editor</button>
          <span class="diag-sep">&#x2502;</span>
          <button class="diag-btn diag-btn-icon" data-action="zoom-out"   title="Zoom out">&#8722;</button>
          <button class="diag-btn diag-btn-icon" data-action="zoom-reset" title="Fit diagram">&#8635;</button>
          <button class="diag-btn diag-btn-icon" data-action="zoom-in"    title="Zoom in">&#43;</button>
        </div>
      </div>
      <div class="diagram-canvas" id="dcanvas-${id}">
        <div class="diagram-loading"><div class="spinner"></div><span>Rendering…</span></div>
      </div>`;

    const canvas = widget.querySelector('.diagram-canvas');

    widget.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () =>
        handleAction(btn.dataset.action, source, canvas, btn));
    });

    targetEl.parentNode.replaceChild(widget, targetEl);

    const svgId = 'mdiag-' + id + '-' + Date.now();
    mermaid.render(svgId, source)
      .then(({ svg }) => {
        canvas.innerHTML = svg;
        const svgEl = canvas.querySelector('svg');
        if (!svgEl) return;

        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
        // Start unconstrained so we can measure real dimensions
        svgEl.style.cssText = 'display:block;width:100%;height:auto;';

        // Set up pan/zoom first (registers state in zoomMap)
        makePanZoom(canvas, svgEl);

        // Auto-fit after the browser has laid out the SVG
        requestAnimationFrame(() => {
          autoFit(canvas, svgEl);

          // Animate edges only AFTER fit is applied (paths have final positions)
          animateEdges(svgEl, id);

          const hint = document.createElement('div');
          hint.className = 'diagram-hint';
          hint.textContent = 'scroll to zoom · drag to pan';
          canvas.appendChild(hint);
        });
      })
      .catch(err => {
        canvas.innerHTML =
          `<div class="diagram-error">
             <strong>Render error</strong><br>
             <code>${escHtml(err.message || String(err))}</code>
           </div>`;
      });
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── AUTO-FIT ────────────────────────────────────────────────────
  // Scales the SVG so the whole diagram is visible on first load,
  // then shrinks the canvas to hug the visual content — no wasted space.
  // Uses the SVG viewBox (set by Mermaid) for pixel-accurate dimensions.
  function autoFit(canvas, svgEl) {
    const vb     = svgEl.viewBox && svgEl.viewBox.baseVal;
    const VPAD   = 56;   // total top + bottom padding (matches CSS: 28+20+8)
    const HPAD   = 40;   // total left + right padding
    const MAX_H  = 500;  // hard ceiling for canvas height

    const cw = Math.max(1, canvas.clientWidth - HPAD);

    let sw = cw, sh = cw;
    if (vb && vb.width > 0 && vb.height > 0) {
      sw = vb.width;
      sh = vb.height;
    } else if (svgEl.clientWidth > 0) {
      sw = svgEl.clientWidth;
      sh = svgEl.clientHeight || cw;
    }

    // At width:100% the SVG renders at cw × cw*(sh/sw) pixels
    const naturalH = cw * (sh / sw);
    const availH   = MAX_H - VPAD;

    // Only scale DOWN when diagram is too tall; add 5% breathing room
    const fit = naturalH > availH ? (availH / naturalH) * 0.95 : 1;

    const st = zoomMap.get(canvas);
    if (st) st.s = fit;
    canvas._fitScale = fit;   // reset button restores this scale

    if (fit < 1) {
      svgEl.style.transformOrigin = '50% 0%';
      svgEl.style.transform = `scale(${fit})`;
    }

    // Shrink canvas to hug the visual diagram height — no empty black space.
    // CSS transform doesn't change layout, but overflow:hidden clips correctly
    // because the visual content ends at naturalH*fit from the canvas top.
    const visualH  = naturalH * fit;
    const canvasH  = Math.max(200, Math.min(MAX_H, Math.ceil(visualH) + VPAD));
    canvas.style.height = canvasH + 'px';
  }

  // ── TOOLBAR ACTIONS ─────────────────────────────────────────────
  function handleAction(action, source, canvas, btn) {
    switch (action) {
      case 'copy':
        navigator.clipboard.writeText(source).then(() => {
          const prev = btn.textContent;
          btn.textContent = 'Copied!';
          btn.style.color = 'var(--signal)';
          setTimeout(() => { btn.textContent = prev; btn.style.color = ''; }, 2000);
        });
        break;

      case 'live': {
        const payload = JSON.stringify({ code: source, mermaid: { theme: 'dark' } });
        const enc     = btoa(unescape(encodeURIComponent(payload)));
        window.open('https://mermaid.live/edit#base64:' + enc, '_blank', 'noopener,noreferrer');
        break;
      }

      case 'zoom-in':    adjustZoom(canvas, +0.2); break;
      case 'zoom-out':   adjustZoom(canvas, -0.2); break;
      case 'zoom-reset': resetZoom(canvas);        break;
    }
  }

  // ── ANIMATED FLOW DOTS ──────────────────────────────────────────
  // Each edge gets a glowing dot that moves along the path.
  // begin="0s" on ALL dots — no stagger delay — so dots are never
  // stranded at the SVG origin (0,0) waiting for their turn to start.
  // Natural phase offset comes from each path having a unique duration.
  function animateEdges(svgEl, diagId) {
    const paths = Array.from(
      svgEl.querySelectorAll('.edgePath path, .flowchart-link')
    ).filter(p => p.getAttribute('d'));

    paths.forEach((path, i) => {
      path.id = `dp-${diagId}-${i}`;

      let len = 200;
      try { len = Math.max(60, path.getTotalLength()); } catch (_) {}
      // Speed: ~90px/s; min 1.2s cycle. Each path has a unique duration
      // so the dots appear out-of-phase naturally without a begin delay.
      const dur = Math.max(1.2, len / 90).toFixed(2);

      svgEl.appendChild(makeDot(8, 'rgba(0,229,160,.18)', path.id, dur)); // glow halo
      svgEl.appendChild(makeDot(4, '#00e5a0',             path.id, dur)); // core dot
    });
  }

  function makeDot(r, fill, pathId, dur) {
    const NS    = 'http://www.w3.org/2000/svg';
    const XLINK = 'http://www.w3.org/1999/xlink';

    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r',    r);
    dot.setAttribute('fill', fill);
    dot.classList.add('diag-flow-dot');

    const anim = document.createElementNS(NS, 'animateMotion');
    anim.setAttribute('dur',         `${dur}s`);
    anim.setAttribute('begin',       '0s');       // always start immediately — no position glitch
    anim.setAttribute('repeatCount', 'indefinite');
    anim.setAttribute('rotate',      'auto');
    anim.setAttribute('calcMode',    'spline');
    anim.setAttribute('keyPoints',   '0;1');
    anim.setAttribute('keyTimes',    '0;1');
    anim.setAttribute('keySplines',  '0.4 0 0.6 1');

    const mp = document.createElementNS(NS, 'mpath');
    mp.setAttributeNS(XLINK, 'href', `#${pathId}`);
    mp.setAttribute('href',          `#${pathId}`);

    anim.appendChild(mp);
    dot.appendChild(anim);
    return dot;
  }

  // ── PAN / ZOOM ──────────────────────────────────────────────────
  const zoomMap = new WeakMap();

  function makePanZoom(canvas, svgEl) {
    const st = { s: 1, tx: 0, ty: 0, drag: false, ox: 0, oy: 0, otx: 0, oty: 0 };
    zoomMap.set(canvas, st);

    const apply = () => {
      svgEl.style.transformOrigin = '50% 0%';
      svgEl.style.transform = `translate(${st.tx}px,${st.ty}px) scale(${st.s})`;
    };

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      st.s = clamp(st.s + (e.deltaY < 0 ? 0.12 : -0.12), 0.08, 10);
      apply();
    }, { passive: false });

    canvas.addEventListener('mousedown', e => {
      st.drag = true;
      st.ox = e.clientX; st.oy = e.clientY;
      st.otx = st.tx;    st.oty = st.ty;
      canvas.style.cursor = 'grabbing';
    });

    const onMove = e => {
      if (!st.drag) return;
      st.tx = st.otx + (e.clientX - st.ox);
      st.ty = st.oty + (e.clientY - st.oy);
      apply();
    };
    const onUp = () => { st.drag = false; canvas.style.cursor = 'grab'; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);

    // Pinch-zoom
    let lastPinch = 0;
    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        st.drag = true;
        st.ox = e.touches[0].clientX; st.oy = e.touches[0].clientY;
        st.otx = st.tx; st.oty = st.ty;
      } else if (e.touches.length === 2) {
        st.drag = false;
        lastPinch = pinchDist(e);
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 1 && st.drag) {
        st.tx = st.otx + (e.touches[0].clientX - st.ox);
        st.ty = st.oty + (e.touches[0].clientY - st.oy);
        apply();
      } else if (e.touches.length === 2) {
        const d = pinchDist(e);
        st.s = clamp(st.s * (d / lastPinch), 0.08, 10);
        lastPinch = d;
        apply();
      }
    }, { passive: false });

    canvas.addEventListener('touchend', () => { st.drag = false; });
  }

  function adjustZoom(canvas, delta) {
    const st  = zoomMap.get(canvas);
    const svg = canvas.querySelector('svg');
    if (!st || !svg) return;
    st.s = clamp(st.s + delta, 0.08, 10);
    svg.style.transformOrigin = '50% 0%';
    svg.style.transform = `translate(${st.tx}px,${st.ty}px) scale(${st.s})`;
  }

  // Reset restores the auto-fit scale, not always 1:1
  function resetZoom(canvas) {
    const st  = zoomMap.get(canvas);
    const svg = canvas.querySelector('svg');
    if (!st || !svg) return;
    const fit = canvas._fitScale || 1;
    st.s = fit; st.tx = 0; st.ty = 0;
    if (fit < 1) {
      svg.style.transformOrigin = '50% 0%';
      svg.style.transform = `scale(${fit})`;
    } else {
      svg.style.transform = '';
    }
  }

  function pinchDist(e) {
    return Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

})();
