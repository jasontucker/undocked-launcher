let allApps = [];
let config = {};

// ── SVG Icons ──────────────────────────────────────────────────────────────
const ICON_LINK = `<svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
const ICON_TS   = `<svg class="btn-svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="3" r="2.2"/><circle cx="21" cy="12" r="2.2"/><circle cx="12" cy="21" r="2.2"/><circle cx="3" cy="12" r="2.2"/><circle cx="18.4" cy="5.6" r="2.2"/><circle cx="18.4" cy="18.4" r="2.2"/><circle cx="5.6" cy="18.4" r="2.2"/><circle cx="5.6" cy="5.6" r="2.2"/><circle cx="12" cy="12" r="2.2"/></svg>`;
const ICON_CF   = `<svg class="btn-svg" viewBox="0 0 24 24" fill="currentColor"><path d="M17.2 10.6c-.1-.6-.5-1-.9-1.3-.5-.3-1-.4-1.6-.3l-.2.1c-.2-.6-.5-1.1-1-1.5-.6-.5-1.4-.8-2.2-.8-1.6 0-2.9 1.1-3.3 2.6h-.1c-1.5.1-2.7 1.4-2.7 2.9 0 1.6 1.3 2.9 2.9 2.9h8.2c1.1 0 2-.9 2-2 0-1-.7-1.9-1.6-2.3-.2-.1-.3-.2-.5-.3z"/></svg>`;
const ICON_TRASH = `<svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

const ICON_SUN  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const ICON_MOON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

// ── Theme toggle ────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeIcon').innerHTML = theme === 'dark' ? ICON_SUN : ICON_MOON;
}

applyTheme(localStorage.getItem('theme') || 'dark');

document.getElementById('themeBtn').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  applyTheme(next);
});

// ── Fetch & Render ──────────────────────────────────────────────────────────
async function fetchApps() {
  document.getElementById('loadingState').classList.remove('is-hidden');
  document.getElementById('appGrid').classList.add('is-hidden');
  document.getElementById('emptyState').classList.add('is-hidden');

  try {
    const res = await fetch('/api/containers');
    const data = await res.json();
    allApps = data.apps || [];
    config = data.config || {};
    document.getElementById('dashTitle').textContent = config.title || 'Homelab Dashboard';
    if (data.version) document.getElementById('versionBadge').textContent = `v${data.version}`;
    applyDisplaySettings(config);
    renderApps(allApps);
  } catch (e) {
    console.error('Fetch error:', e);
    renderApps([]);
  } finally {
    document.getElementById('loadingState').classList.add('is-hidden');
  }
}

function renderApps(apps) {
  const grid = document.getElementById('appGrid');
  const empty = document.getElementById('emptyState');

  if (!apps.length) {
    grid.classList.add('is-hidden');
    empty.classList.remove('is-hidden');
    return;
  }

  empty.classList.add('is-hidden');
  grid.classList.remove('is-hidden');

  const groups = {};
  for (const app of apps) {
    const g = app.group || 'Apps';
    if (!groups[g]) groups[g] = [];
    groups[g].push(app);
  }

  const sortedGroups = Object.keys(groups).sort((a, b) => a.localeCompare(b));

  grid.innerHTML = sortedGroups.map(group => `
    <div class="group-label">${escHtml(group)}</div>
    <div class="app-smart-grid">
      ${groups[group].map(app => renderCard(app)).join('')}
    </div>
  `).join('');

  grid.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const name = btn.dataset.delete;
      if (!confirm(`Remove "${name}"?`)) return;
      await fetch(`/api/custom-apps/${encodeURIComponent(name)}`, { method: 'DELETE' });
      fetchApps();
    });
  });
}

function renderCard(app) {
  const isCustom = app.id?.startsWith('custom-');

  const iconHtml = `
    <div class="card-icon-wrap">
      <img class="app-icon" src="${escHtml(app.icon)}" alt="" loading="lazy"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="app-icon-fallback" style="display:none">${escHtml(app.name.slice(0,2))}</div>
    </div>`;

  const directBtn = app.directUrl
    ? `<a class="action-btn btn-direct" href="${escHtml(app.directUrl)}" target="_blank" rel="noopener" title="Direct — ${escHtml(app.directUrl)}">${ICON_LINK}</a>`
    : `<span class="action-btn btn-direct disabled" title="No port exposed">${ICON_LINK}</span>`;

  const tsBtn = app.tailscaleUrl
    ? `<a class="action-btn btn-ts" href="${escHtml(app.tailscaleUrl)}" target="_blank" rel="noopener" title="Tailscale — ${escHtml(app.tailscaleUrl)}">${ICON_TS}</a>`
    : `<span class="action-btn btn-ts disabled" title="Tailscale not configured">${ICON_TS}</span>`;

  const cfBtn = app.cloudflareUrl
    ? `<a class="action-btn btn-cf" href="${escHtml(app.cloudflareUrl)}" target="_blank" rel="noopener" title="Cloudflare — ${escHtml(app.cloudflareUrl)}">${ICON_CF}</a>`
    : `<span class="action-btn btn-cf disabled" title="Cloudflare not configured">${ICON_CF}</span>`;

  const deleteBtn = isCustom
    ? `<button class="action-btn btn-delete" data-delete="${escHtml(app.name)}" title="Remove">${ICON_TRASH}</button>`
    : '';

  return `
    <div class="box app-card">
      ${iconHtml}
      <div class="card-info">
        <div class="card-name">${escHtml(app.name)}</div>
        ${app.description ? `<div class="card-desc">${escHtml(app.description)}</div>` : ''}
      </div>
      <div class="card-actions">
        ${directBtn}${tsBtn}${cfBtn}${deleteBtn}
      </div>
    </div>`;
}

function escHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Search ──────────────────────────────────────────────────────────────────
document.getElementById('searchInput').addEventListener('input', e => {
  const q = e.target.value.toLowerCase().trim();
  renderApps(q ? allApps.filter(a =>
    a.name.toLowerCase().includes(q) ||
    (a.description || '').toLowerCase().includes(q) ||
    (a.group || '').toLowerCase().includes(q)
  ) : allApps);
});

// ── Settings modal ──────────────────────────────────────────────────────────
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('openSettingsLink')?.addEventListener('click', e => { e.preventDefault(); openSettings(); });
document.getElementById('refreshBtn').addEventListener('click', fetchApps);

function applyDisplaySettings(cfg) {
  const root = document.documentElement.style;
  if (cfg.iconSize)   root.setProperty('--icon-size', cfg.iconSize + 'px');
  if (cfg.textSize)   root.setProperty('--text-size', cfg.textSize + 'px');
  if (cfg.buttonSize) root.setProperty('--btn-size',  cfg.buttonSize + 'px');

  // screen.width is in CSS points and is NOT affected by initial-scale/viewportScale,
  // so it reliably identifies phones even when the viewport meta has been changed.
  const isPhone = window.screen.width <= 600;
  const gridCols = isPhone
    ? '1fr'
    : `repeat(auto-fill, minmax(${cfg.minCardWidth || 260}px, 1fr))`;
  root.setProperty('--app-grid-cols', gridCols);

  if (cfg.viewportScale) {
    const vp = document.getElementById('viewportMeta');
    if (vp) vp.content = `width=device-width, initial-scale=${cfg.viewportScale}`;
  }
}

function openSettings() {
  document.getElementById('cfgTitle').value         = config.title || '';
  document.getElementById('cfgHostIP').value        = config.hostIP || '';
  document.getElementById('cfgCFDomain').value      = config.cloudflareDomain || '';
  document.getElementById('cfgTailnetDomain').value = config.tailnetDomain || '';
  document.getElementById('cfgIconSize').value      = config.iconSize || 38;
  document.getElementById('cfgTextSize').value      = config.textSize || 13;
  document.getElementById('cfgButtonSize').value    = config.buttonSize || 30;
  document.getElementById('cfgMinCardWidth').value  = config.minCardWidth || 260;
  document.getElementById('cfgViewportScale').value = config.viewportScale || 1.0;
  showModal('settingsModal');
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const payload = {
    title:           document.getElementById('cfgTitle').value.trim() || 'Homelab Dashboard',
    hostIP:          document.getElementById('cfgHostIP').value.trim(),
    cloudflareDomain: document.getElementById('cfgCFDomain').value.trim(),
    tailnetDomain:   document.getElementById('cfgTailnetDomain').value.trim(),
    iconSize:        Number(document.getElementById('cfgIconSize').value) || 38,
    textSize:        Number(document.getElementById('cfgTextSize').value) || 13,
    buttonSize:      Number(document.getElementById('cfgButtonSize').value) || 30,
    minCardWidth:    Number(document.getElementById('cfgMinCardWidth').value) || 260,
    viewportScale:   Number(document.getElementById('cfgViewportScale').value) || 1.0,
  };
  await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  closeModal('settingsModal');
  fetchApps();
});

// ── Add Custom App ──────────────────────────────────────────────────────────
document.getElementById('addAppBtn').addEventListener('click', () => {
  ['customName','customDesc','customGroup','customIcon','customCFUrl','customTSUrl','customDirectUrl']
    .forEach(id => { document.getElementById(id).value = ''; });
  showModal('addAppModal');
});

document.getElementById('saveCustomAppBtn').addEventListener('click', async () => {
  const name = document.getElementById('customName').value.trim();
  if (!name) { alert('Name is required.'); return; }
  const payload = {
    name,
    description: document.getElementById('customDesc').value.trim(),
    group:       document.getElementById('customGroup').value.trim() || 'Apps',
    icon:        document.getElementById('customIcon').value.trim() ||
      `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${name.toLowerCase().replace(/\s+/g,'-')}.png`,
    cloudflareUrl: document.getElementById('customCFUrl').value.trim() || null,
    tailscaleUrl:  document.getElementById('customTSUrl').value.trim() || null,
    directUrl:     document.getElementById('customDirectUrl').value.trim() || null,
  };
  await fetch('/api/custom-apps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  closeModal('addAppModal');
  fetchApps();
});

// ── Modal helpers ────────────────────────────────────────────────────────────
function showModal(id) { document.getElementById(id).classList.add('is-active'); }
function closeModal(id) { document.getElementById(id).classList.remove('is-active'); }

document.querySelectorAll('[data-close]').forEach(btn =>
  btn.addEventListener('click', () => closeModal(btn.dataset.close)));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape')
    document.querySelectorAll('.modal.is-active').forEach(m => closeModal(m.id));
});

fetchApps();
