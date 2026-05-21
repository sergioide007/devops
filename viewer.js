/* DevOps Section Viewer — viewer.js
   Reads window.DEVOPS_SECTION config and renders the section viewer.
   Requires: marked.js (CDN), devops.css */

(function() {
  'use strict';

  const cfg = window.DEVOPS_SECTION;
  if (!cfg) { console.error('DEVOPS_SECTION not defined'); return; }

  // ── ALL SECTIONS (for picker + next-section navigation) ─────────
  const ALL_SECTIONS = [
    { slug:'foundations', title:'01 — Foundations' },
    { slug:'cloud',       title:'02 — Cloud & AWS' },
    { slug:'cicd',        title:'03 — CI/CD Pipelines' },
    { slug:'containers',  title:'04 — Containers & K8s' },
    { slug:'iac',         title:'05 — Infrastructure as Code' },
    { slug:'monitoring',  title:'06 — Monitoring & Observability' },
    { slug:'advanced',    title:'07 — Advanced Topics' },
    { slug:'interview',   title:'08 — Interview Prep' },
    { slug:'experience',  title:'09 — Real-World Experience' },
    { slug:'tools',       title:'10 — Essential Tools' },
    { slug:'infra-zero',  title:'11 — Infra from Zero' },
    { slug:'compliance',  title:'12 — Compliance & Standards' },
  ];

  // Detect current section from URL (reliable regardless of cfg.path naming)
  const urlSlug = window.location.pathname.replace(/\/$/, '').split('/').filter(Boolean).pop() || '';
  const currentSectionIdx = ALL_SECTIONS.findIndex(s => s.slug === urlSlug);
  const nextSection = currentSectionIdx >= 0 && currentSectionIdx < ALL_SECTIONS.length - 1
    ? ALL_SECTIONS[currentSectionIdx + 1] : null;

  // ── DOM REFS ────────────────────────────────────────────────────
  const sidebar     = document.getElementById('dvSidebar');
  const overlay     = document.getElementById('dvOverlay');
  const sidebarNav  = document.getElementById('dvNav');
  const contentArea = document.getElementById('dvContent');
  const sectionName = document.getElementById('dvSectionName');
  const breadFile   = document.getElementById('dvBreadFile');

  if (sectionName) sectionName.textContent = cfg.title;

  // ── STATE ───────────────────────────────────────────────────────
  let currentFile = null;

  // ── SIDEBAR TOGGLE (mobile) ─────────────────────────────────────
  window.dvToggle = function() {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
  };
  if (overlay) overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
  });

  // ── BUILD NAV ───────────────────────────────────────────────────
  function buildNav() {
    sidebarNav.innerHTML = cfg.files.map((f, i) => `
      <a class="nav-item" data-idx="${i}" href="#${f.slug}" onclick="dvLoad(${i});return false">
        <span class="ni-num">${String(i + 1).padStart(2, '0')}</span>
        <span>${f.title}</span>
      </a>`).join('');
  }

  // ── SECTION PICKER ──────────────────────────────────────────────
  function buildSectionPicker() {
    const foot = document.querySelector('.sidebar-foot');
    if (!foot) return;
    const picker = document.createElement('div');
    picker.className = 'section-picker';
    picker.innerHTML = `
      <label class="picker-label">Jump to section</label>
      <select class="picker-select" onchange="if(this.value) window.location='../'+this.value+'/'">
        <option value="">— Choose section —</option>
        ${ALL_SECTIONS.map(s =>
          `<option value="${s.slug}"${s.slug === urlSlug ? ' selected' : ''}>${s.title}</option>`
        ).join('')}
      </select>`;
    foot.appendChild(picker);
  }

  // ── LOAD FILE ───────────────────────────────────────────────────
  window.dvLoad = function(idx) {
    const file = cfg.files[idx];
    if (!file) return;
    currentFile = idx;

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
    });

    // Update breadcrumb
    if (breadFile) breadFile.textContent = file.title;

    // Update URL hash
    history.replaceState(null, '', '#' + file.slug);

    // Close mobile sidebar
    sidebar.classList.remove('open');
    overlay.classList.remove('open');

    // Show loading
    contentArea.innerHTML = `
      <div class="breadcrumb">
        <a href="https://www.specsolid.com/">SpecSolid</a>
        <span class="sep">/</span>
        <a href="../">DevOps</a>
        <span class="sep">/</span>
        <a href="./">${cfg.title}</a>
        <span class="sep">/</span>
        <span class="cur">${file.title}</span>
      </div>
      <div class="loading"><div class="spinner"></div>Loading ${file.file}…</div>`;

    // Fetch markdown
    const url = cfg.path + '/' + file.file;
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + url);
        return r.text();
      })
      .then(md => renderMarkdown(md, idx))
      .catch(err => renderError(err, file, url));
  };

  // ── RENDER MARKDOWN ─────────────────────────────────────────────
  function renderMarkdown(md, idx) {
    if (typeof marked === 'undefined') {
      renderError(new Error('marked.js not loaded'), cfg.files[idx], '');
      return;
    }

    const html = marked.parse(md);
    const file = cfg.files[idx];

    // Prev / Next
    const prev = idx > 0 ? cfg.files[idx - 1] : null;
    const next = idx < cfg.files.length - 1 ? cfg.files[idx + 1] : null;

    const navHTML = `<div class="doc-nav">
      ${prev
        ? `<a class="doc-nav-btn" href="#${prev.slug}" onclick="dvLoad(${idx-1});return false">
             <span class="doc-nav-dir">← Previous</span>
             <span class="doc-nav-title">${prev.title}</span>
           </a>`
        : '<div></div>'}
      ${next
        ? `<a class="doc-nav-btn next" href="#${next.slug}" onclick="dvLoad(${idx+1});return false">
             <span class="doc-nav-dir">Next →</span>
             <span class="doc-nav-title">${next.title}</span>
           </a>`
        : nextSection
          ? `<a class="doc-nav-btn next doc-nav-section" href="../${nextSection.slug}/">
               <span class="doc-nav-dir">Next Section →</span>
               <span class="doc-nav-title">${nextSection.title}</span>
             </a>`
          : `<a class="doc-nav-btn next doc-nav-section" href="../">
               <span class="doc-nav-dir">Curriculum complete</span>
               <span class="doc-nav-title">← Back to DevOps Hub</span>
             </a>`}
    </div>`;

    contentArea.innerHTML = `
      <div class="breadcrumb">
        <a href="https://www.specsolid.com/">SpecSolid</a>
        <span class="sep">/</span>
        <a href="../">DevOps</a>
        <span class="sep">/</span>
        <a href="./">${cfg.title}</a>
        <span class="sep">/</span>
        <span class="cur">${file.title}</span>
      </div>
      <div class="md-body">${html}</div>
      ${navHTML}`;

    // Wire same-section .md links into the viewer (prevents 404 on GitHub Pages).
    // javascript:dvGo() links are intentionally excluded — they don't end in ".md"
    // and are already handled by window.dvGo. Both mechanisms are independent.
    document.querySelectorAll('.md-body a[href$=".md"]').forEach(a => {
      const href = a.getAttribute('href') || '';
      // Cross-section links (../something/) have been fixed to use section URLs
      // at the source, but guard here anyway so they reach the browser naturally.
      if (href.startsWith('../')) return;
      const filename = href.split('/').pop();
      const fileIdx = cfg.files.findIndex(f => f.file === filename);
      if (fileIdx === -1) return; // unknown file — let browser handle it
      a.href = '#' + cfg.files[fileIdx].slug;
      a.addEventListener('click', e => { e.preventDefault(); dvLoad(fileIdx); });
    });

    // Post-process: add copy buttons to code blocks
    addCopyButtons();

    // Render interactive diagrams (Mermaid etc.) — defined in diagram.js
    if (typeof dvProcessDiagrams === 'function') dvProcessDiagrams(contentArea);

    // Scroll to top
    contentArea.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── COPY BUTTONS ────────────────────────────────────────────────
  function addCopyButtons() {
    document.querySelectorAll('.md-body pre').forEach(pre => {
      const code = pre.querySelector('code');
      if (!code) return;

      // Detect language from class
      const cls = code.className || '';
      const lang = cls.replace('language-', '').split(' ')[0] || 'code';

      // Wrap with header
      const wrapper = document.createElement('div');
      wrapper.innerHTML = `
        <div class="code-header">
          <span class="code-lang">${lang}</span>
          <button class="copy-btn" onclick="dvCopy(this)">Copy</button>
        </div>`;

      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);
    });
  }

  window.dvCopy = function(btn) {
    const code = btn.closest('.md-body pre, div').querySelector('code');
    if (!code) return;
    navigator.clipboard.writeText(code.textContent).then(() => {
      btn.textContent = 'Copied!';
      btn.style.color = 'var(--signal)';
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.style.color = '';
      }, 1800);
    });
  };

  window.dvGo = function(slug) {
    const idx = cfg.files.findIndex(f => f.slug === slug);
    if (idx !== -1) dvLoad(idx);
  };

  // ── ERROR STATE ─────────────────────────────────────────────────
  function renderError(err, file, url) {
    contentArea.innerHTML = `
      <div class="breadcrumb">
        <a href="https://www.specsolid.com/">SpecSolid</a>
        <span class="sep">/</span>
        <a href="../">DevOps</a>
        <span class="sep">/</span>
        <span class="cur">${cfg.title}</span>
      </div>
      <div class="content-empty">
        <div class="icon">⚠️</div>
        <h3>Could not load this file</h3>
        <p style="font-family:var(--mono);font-size:11px;color:var(--muted)">${err.message}</p>
        <p style="font-size:12px;color:var(--muted);margin-top:8px">
          Path: <code style="font-family:var(--mono)">${url}</code>
        </p>
        <p style="font-size:12px;color:var(--muted);margin-top:8px">
          This viewer requires a web server (not file:// protocol).<br>
          Try: <code style="font-family:var(--mono)">npx serve .</code> from the project root.
        </p>
      </div>`;
  }

  // ── INIT ─────────────────────────────────────────────────────────
  function init() {
    marked.use({ gfm: true, breaks: false });
    buildNav();
    buildSectionPicker();

    // Load from URL hash or default to first file
    const hash = location.hash.replace('#', '');
    const bySlug = hash ? cfg.files.findIndex(f => f.slug === hash) : -1;
    dvLoad(bySlug >= 0 ? bySlug : 0);
  }

  // Wait for marked.js to be available
  if (typeof marked !== 'undefined') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (typeof marked !== 'undefined') {
        init();
      } else {
        // Try waiting a bit more
        setTimeout(() => {
          if (typeof marked !== 'undefined') { init(); }
          else { contentArea.innerHTML = '<div class="content-empty"><p>Error: marked.js failed to load</p></div>'; }
        }, 2000);
      }
    });
  }
})();
