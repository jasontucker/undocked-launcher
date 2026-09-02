let allServers = [];
let allApps = [];
let config = {};

// ── SVG Icons ──────────────────────────────────────────────────────────────
const ICON_OPEN    = `<svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
const ICON_CHEVRON = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>`;
const ICON_EDIT    = `<svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const ICON_TRASH = `<svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const ICON_KEY   = `<svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`;
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
    allServers = data.servers || [];
    allApps = allServers.flatMap(s => s.apps || []);
    config = data.config || {};
    document.getElementById('dashTitle').textContent = config.title || 'Homelab Dashboard';
    if (data.version) document.getElementById('versionBadge').textContent = `v${data.version}`;
    applyDisplaySettings(config);
    renderApps(allServers);
  } catch (e) {
    console.error('Fetch error:', e);
    renderApps([]);
  } finally {
    document.getElementById('loadingState').classList.add('is-hidden');
  }
}

function formatAge(timestamp) {
  const mins = Math.floor((Date.now() - timestamp) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  return `${mins} min ago`;
}

function renderGroupedApps(apps) {
  if (!apps.length) return '';
  const groups = {};
  for (const app of apps) {
    const g = app.group || 'Apps';
    if (!groups[g]) groups[g] = [];
    groups[g].push(app);
  }
  const order = config.groupOrder || [];
  const sortedGroups = Object.keys(groups).sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return a.localeCompare(b);
  });
  return sortedGroups.map(group => `
    <div class="group-label">${escHtml(group)}</div>
    <div class="app-smart-grid">
      ${groups[group].map(app => renderCard(app)).join('')}
    </div>
  `).join('');
}

function renderApps(servers, searchQuery = '') {
  const grid = document.getElementById('appGrid');
  const empty = document.getElementById('emptyState');

  const hasMultiple = servers.length > 1;
  let totalApps = 0;
  let html = '';

  for (const server of servers) {
    let apps = server.apps || [];
    if (searchQuery) {
      apps = apps.filter(a =>
        a.name.toLowerCase().includes(searchQuery) ||
        (a.description || '').toLowerCase().includes(searchQuery) ||
        (a.group || '').toLowerCase().includes(searchQuery)
      );
    }
    totalApps += apps.length;

    if (hasMultiple) {
      const cacheInfo = server.cachedAt
        ? `<span class="server-cache-time">updated ${formatAge(server.cachedAt)}</span>`
        : '';
      const errorBadge = server.error
        ? `<span class="server-error-badge">offline</span>`
        : '';
      html += `<div class="server-header">${escHtml(server.name)}${cacheInfo}${errorBadge}</div>`;
    }

    if (server.error && !apps.length) {
      html += `<p class="server-error-msg">Could not connect: ${escHtml(server.error)}</p>`;
    } else {
      html += renderGroupedApps(apps);
    }
  }

  if (!totalApps && !servers.some(s => s.error)) {
    grid.classList.add('is-hidden');
    empty.classList.remove('is-hidden');
    return;
  }

  empty.classList.add('is-hidden');
  grid.classList.remove('is-hidden');
  grid.innerHTML = html;

  grid.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const name = btn.dataset.delete;
      if (!confirm(`Remove "${name}"?`)) return;
      await fetch(`/api/custom-apps/${encodeURIComponent(name)}`, { method: 'DELETE' });
      fetchApps();
    });
  });

  // Edit custom app
  grid.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const name = btn.dataset.edit;
      const app = allApps.find(a => a.name === name);
      if (!app) return;
      openCustomAppModal(app);
    });
  });

  // Override icon on Docker container
  grid.querySelectorAll('[data-container]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openIconPicker(null, btn.dataset.container, btn.dataset.container);
    });
  });

  grid.querySelectorAll('.url-dropdown-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const dropdown = btn.closest('.url-dropdown');
      const isOpen = dropdown.classList.contains('is-open');
      closeAllDropdowns();
      if (!isOpen) dropdown.classList.add('is-open');
    });
  });

  grid.querySelectorAll('.url-option').forEach(link => {
    link.addEventListener('click', () => closeAllDropdowns());
  });

  grid.querySelectorAll('[data-apikey]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openApiKeyModal(btn.dataset.apikey, btn.dataset.apikeyName);
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

  const options = [
    app.directUrl    && `<a class="url-option url-direct" href="${escHtml(app.directUrl)}" target="_blank" rel="noopener"><span class="url-dot"></span>Direct</a>`,
    app.tailscaleUrl && `<a class="url-option url-ts"     href="${escHtml(app.tailscaleUrl)}" target="_blank" rel="noopener"><span class="url-dot"></span>Tailscale</a>`,
    app.cloudflareUrl && `<a class="url-option url-cf"    href="${escHtml(app.cloudflareUrl)}" target="_blank" rel="noopener"><span class="url-dot"></span>Cloudflare</a>`,
  ].filter(Boolean).join('');

  const editBtn = isCustom
    ? `<button class="action-btn btn-edit-app" data-edit="${escHtml(app.name)}" title="Edit">${ICON_EDIT}</button>`
    : `<button class="action-btn btn-edit-icon" data-container="${escHtml(app.rawName)}" data-icon="${escHtml(app.icon)}" title="Change icon">${ICON_EDIT}</button>`;

  const deleteBtn = isCustom
    ? `<button class="action-btn btn-delete" data-delete="${escHtml(app.name)}" title="Remove">${ICON_TRASH}</button>`
    : '';

  const keyBtn = app.hasApiKey
    ? `<button class="action-btn btn-key" data-apikey="${escHtml(app.rawName)}" data-apikey-name="${escHtml(app.name)}" title="Show API Key">${ICON_KEY}</button>`
    : '';

  const dropdown = options
    ? `<div class="url-dropdown">
        <button class="url-dropdown-btn" title="Open">${ICON_OPEN}${ICON_CHEVRON}</button>
        <div class="url-dropdown-menu">${options}</div>
       </div>`
    : '';

  return `
    <div class="box app-card">
      <div class="card-main">
        ${iconHtml}
        <div class="card-info">
          <div class="card-name">${escHtml(app.name)}</div>
        </div>
        <div class="card-actions">${dropdown}${keyBtn}${editBtn}${deleteBtn}</div>
      </div>
      ${app.description ? `<div class="card-desc">${escHtml(app.description)}</div>` : ''}
    </div>`;
}

function escHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Search ──────────────────────────────────────────────────────────────────
document.getElementById('searchInput').addEventListener('input', e => {
  const q = e.target.value.toLowerCase().trim();
  renderApps(allServers, q);
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
  renderServerList();
  renderGroupOrderList();
  showModal('settingsModal');
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const payload = {
    title:            document.getElementById('cfgTitle').value.trim() || 'Homelab Dashboard',
    hostIP:           document.getElementById('cfgHostIP').value.trim(),
    cloudflareDomain: document.getElementById('cfgCFDomain').value.trim(),
    tailnetDomain:    document.getElementById('cfgTailnetDomain').value.trim(),
    iconSize:         Number(document.getElementById('cfgIconSize').value) || 38,
    textSize:         Number(document.getElementById('cfgTextSize').value) || 13,
    buttonSize:       Number(document.getElementById('cfgButtonSize').value) || 30,
    minCardWidth:     Number(document.getElementById('cfgMinCardWidth').value) || 260,
    viewportScale:    Number(document.getElementById('cfgViewportScale').value) || 1.0,
    groupOrder:       getGroupOrderFromList(),
  };
  const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  config = data.config;
  closeModal('settingsModal');
  fetchApps();
});

// ── Remote server list ───────────────────────────────────────────────────────
function renderServerList() {
  const list = document.getElementById('serverList');
  const servers = config.remoteServers || [];
  if (!servers.length) {
    list.innerHTML = '<p class="has-text-grey is-size-7 mb-2">No remote servers configured.</p>';
    return;
  }
  list.innerHTML = servers.map(s => `
    <div class="server-list-item">
      <div>
        <strong>${escHtml(s.name)}</strong>
        <span class="has-text-grey is-size-7 ml-2">${s.connectionType === 'ssh' ? 'SSH' : 'TCP'} · ${escHtml(s.host)}</span>
      </div>
      <button class="button is-small is-danger is-light" data-delete-server="${escHtml(s.name)}">Remove</button>
    </div>
  `).join('');

  list.querySelectorAll('[data-delete-server]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.deleteServer;
      if (!confirm(`Remove server "${name}"?`)) return;
      await fetch(`/api/servers/${encodeURIComponent(name)}`, { method: 'DELETE' });
      config.remoteServers = (config.remoteServers || []).filter(s => s.name !== name);
      renderServerList();
      fetchApps();
    });
  });
}

// ── Group Order drag-and-drop ────────────────────────────────────────────────
function renderGroupOrderList() {
  const el = document.getElementById('groupOrderList');

  // Collect all unique group names from current data
  const allGroups = [...new Set(allServers.flatMap(s => (s.apps || []).map(a => a.group).filter(Boolean)))];
  if (!allGroups.length) {
    el.innerHTML = '<p class="has-text-grey is-size-7">No groups found.</p>';
    return;
  }

  // Merge: saved order first, then any new groups not yet in the list
  const saved = config.groupOrder || [];
  const ordered = [...saved.filter(g => allGroups.includes(g)),
                   ...allGroups.filter(g => !saved.includes(g)).sort()];

  el.innerHTML = ordered.map(g => `
    <div class="group-order-item" draggable="true" data-group="${escHtml(g)}">
      <svg class="drag-handle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="9" cy="5" r="1.5" fill="currentColor" stroke="none"/>
        <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/>
        <circle cx="9" cy="19" r="1.5" fill="currentColor" stroke="none"/>
        <circle cx="15" cy="5" r="1.5" fill="currentColor" stroke="none"/>
        <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none"/>
        <circle cx="15" cy="19" r="1.5" fill="currentColor" stroke="none"/>
      </svg>
      <span>${escHtml(g)}</span>
    </div>
  `).join('');

  let dragSrc = null;

  el.querySelectorAll('.group-order-item').forEach(item => {
    item.addEventListener('dragstart', () => {
      dragSrc = item;
      setTimeout(() => item.classList.add('dragging'), 0);
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      el.querySelectorAll('.group-order-item').forEach(i => i.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      if (item === dragSrc) return;
      el.querySelectorAll('.group-order-item').forEach(i => i.classList.remove('drag-over'));
      item.classList.add('drag-over');
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragSrc || dragSrc === item) return;
      item.classList.remove('drag-over');
      // Insert dragSrc before or after item depending on position
      const srcRect = dragSrc.getBoundingClientRect();
      const tgtRect = item.getBoundingClientRect();
      if (srcRect.top < tgtRect.top) {
        item.after(dragSrc);
      } else {
        item.before(dragSrc);
      }
    });
  });
}

function getGroupOrderFromList() {
  return [...document.querySelectorAll('#groupOrderList .group-order-item')]
    .map(el => el.dataset.group);
}

document.getElementById('addServerBtn').addEventListener('click', () => {
  ['srvName', 'srvHost', 'srvSshUser'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('srvPort').value = '2375';
  document.getElementById('srvSshPort').value = '22';
  document.getElementById('srvConnectionType').value = 'tcp';
  document.getElementById('srvTcpFields').style.display = '';
  document.getElementById('srvSshFields').style.display = 'none';
  showModal('addServerModal');
});

document.getElementById('srvConnectionType').addEventListener('change', e => {
  const isSsh = e.target.value === 'ssh';
  document.getElementById('srvTcpFields').style.display = isSsh ? 'none' : '';
  document.getElementById('srvSshFields').style.display = isSsh ? '' : 'none';
});

document.getElementById('saveServerBtn').addEventListener('click', async () => {
  const name = document.getElementById('srvName').value.trim();
  const host = document.getElementById('srvHost').value.trim();
  if (!name || !host) { alert('Name and host are required.'); return; }

  const connectionType = document.getElementById('srvConnectionType').value;
  const payload = { name, host, connectionType };

  if (connectionType === 'tcp') {
    payload.port = Number(document.getElementById('srvPort').value) || 2375;
  } else {
    payload.sshUser = document.getElementById('srvSshUser').value.trim() || 'root';
    payload.sshPort = Number(document.getElementById('srvSshPort').value) || 22;
  }

  await fetch('/api/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  config.remoteServers = config.remoteServers || [];
  const idx = config.remoteServers.findIndex(s => s.name === name);
  if (idx >= 0) config.remoteServers[idx] = payload;
  else config.remoteServers.push(payload);
  closeModal('addServerModal');
  renderServerList();
  fetchApps();
});

document.getElementById('clearCacheBtn').addEventListener('click', async () => {
  await fetch('/api/cache/clear', { method: 'POST' });
  fetchApps();
});

// ── Add / Edit Custom App ────────────────────────────────────────────────────
let editingAppName = null; // null = adding new, string = editing existing

function openCustomAppModal(app = null) {
  editingAppName = app ? app.name : null;
  document.getElementById('customName').value       = app?.name || '';
  document.getElementById('customDesc').value       = app?.description || '';
  document.getElementById('customGroup').value      = app?.group || '';
  document.getElementById('customIcon').value       = app?.icon || '';
  document.getElementById('customCFUrl').value      = app?.cloudflareUrl || '';
  document.getElementById('customTSUrl').value      = app?.tailscaleUrl || '';
  document.getElementById('customDirectUrl').value  = app?.directUrl || '';
  document.querySelector('#addAppModal .modal-card-title').textContent =
    app ? 'Edit Custom App' : 'Add Custom App';
  document.getElementById('saveCustomAppBtn').textContent =
    app ? 'Save Changes' : 'Add App';
  showModal('addAppModal');
}

document.getElementById('addAppBtn').addEventListener('click', () => openCustomAppModal());

document.getElementById('saveCustomAppBtn').addEventListener('click', async () => {
  const name = document.getElementById('customName').value.trim();
  if (!name) { alert('Name is required.'); return; }
  const payload = {
    name,
    description:   document.getElementById('customDesc').value.trim(),
    group:         document.getElementById('customGroup').value.trim() || 'Apps',
    icon:          document.getElementById('customIcon').value.trim() ||
      `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${name.toLowerCase().replace(/\s+/g,'-')}.png`,
    cloudflareUrl: document.getElementById('customCFUrl').value.trim() || null,
    tailscaleUrl:  document.getElementById('customTSUrl').value.trim() || null,
    directUrl:     document.getElementById('customDirectUrl').value.trim() || null,
  };
  // If renaming, delete old entry first
  if (editingAppName && editingAppName !== name) {
    await fetch(`/api/custom-apps/${encodeURIComponent(editingAppName)}`, { method: 'DELETE' });
  }
  await fetch('/api/custom-apps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  closeModal('addAppModal');
  fetchApps();
});

document.getElementById('browseIconBtn').addEventListener('click', () => {
  const appName = document.getElementById('customName').value.trim();
  openIconPicker('customIcon', null, appName);
});

// ── Icon Picker ──────────────────────────────────────────────────────────────
let iconPickerTargetField = null;   // input field id to fill, or null
let iconPickerTargetContainer = null; // container rawName for override, or null

function openIconPicker(fieldId, containerName, appName) {
  iconPickerTargetField     = fieldId;
  iconPickerTargetContainer = containerName;
  const defaultQuery = appName ? appName.trim().split(/[\s_\-]+/)[0].toLowerCase() : '';
  document.getElementById('iconSearch').value = defaultQuery;
  renderIconGrid(defaultQuery);
  showModal('iconPickerModal');
}

function renderIconGrid(query) {
  const grid = document.getElementById('iconGrid');
  const hint = document.getElementById('iconGridHint');
  const q = query.toLowerCase().trim();
  const filtered = q
    ? DASHBOARD_ICONS.filter(n => n.includes(q))
    : DASHBOARD_ICONS;
  const shown = filtered.slice(0, 48);

  if (!shown.length) {
    grid.innerHTML = '<p class="has-text-grey is-size-7">No icons found.</p>';
    hint.textContent = '';
    return;
  }

  grid.innerHTML = shown.map(name => `
    <div class="icon-pick-item" data-icon-name="${escHtml(name)}" title="${escHtml(name)}">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${escHtml(name)}.png"
           alt="${escHtml(name)}" loading="lazy"
           onerror="this.parentElement.style.opacity='0.3'">
      <span>${escHtml(name)}</span>
    </div>
  `).join('');

  hint.textContent = filtered.length > 48
    ? `Showing 48 of ${filtered.length} results — type more to narrow down`
    : `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`;

  grid.querySelectorAll('.icon-pick-item').forEach(item => {
    item.addEventListener('click', async () => {
      const name = item.dataset.iconName;
      const url  = `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${name}.png`;
      if (iconPickerTargetField) {
        document.getElementById(iconPickerTargetField).value = url;
        closeModal('iconPickerModal');
      } else if (iconPickerTargetContainer) {
        closeModal('iconPickerModal');
        // Optimistically update the card icon immediately in the DOM
        document.querySelectorAll(`[data-container="${CSS.escape(iconPickerTargetContainer)}"]`).forEach(btn => {
          const img = btn.closest('.app-card')?.querySelector('.app-icon');
          if (img) { img.style.display = ''; img.src = url; }
          const fallback = btn.closest('.app-card')?.querySelector('.app-icon-fallback');
          if (fallback) fallback.style.display = 'none';
        });
        const res = await fetch('/api/icon-override', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ containerName: iconPickerTargetContainer, iconUrl: url }),
        });
        if (res.ok) fetchApps();
      }
    });
  });
}

document.getElementById('iconSearch').addEventListener('input', e => {
  renderIconGrid(e.target.value);
});

// ── API Key reveal ──────────────────────────────────────────────────────────
async function openApiKeyModal(rawName, displayName) {
  document.getElementById('apiKeyModalTitle').textContent = `${displayName} — API Key`;
  const input = document.getElementById('apiKeyValue');
  const copyBtn = document.getElementById('copyApiKeyBtn');
  input.value = 'Loading…';
  copyBtn.textContent = 'Copy';
  copyBtn.disabled = true;
  showModal('apiKeyModal');
  try {
    const res = await fetch(`/api/apikey/${encodeURIComponent(rawName)}`);
    if (!res.ok) throw new Error('not found');
    const data = await res.json();
    input.value = data.key || '';
    copyBtn.disabled = !data.key;
  } catch {
    input.value = 'Unable to retrieve key';
  }
}

document.getElementById('copyApiKeyBtn').addEventListener('click', async () => {
  const input = document.getElementById('apiKeyValue');
  const btn = document.getElementById('copyApiKeyBtn');
  try {
    await navigator.clipboard.writeText(input.value);
    btn.textContent = 'Copied!';
  } catch (e) {
    console.error('Clipboard write failed:', e);
    btn.textContent = 'Failed';
  }
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
});

// ── Dropdown helpers ─────────────────────────────────────────────────────────
function closeAllDropdowns() {
  document.querySelectorAll('.url-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
}
document.addEventListener('click', closeAllDropdowns);

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
