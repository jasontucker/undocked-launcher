const express = require('express');
const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');

const VERSION = '1.5.5';

const app = express();
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const CONFIG_PATH = '/config/settings.json';
const DEFAULT_CONFIG = {
  title: 'Undocked Launcher',
  tailnetDomain: '',
  cloudflareDomain: '',
  hostIP: '',
  customApps: [],
  iconSize: 38,
  textSize: 13,
  buttonSize: 30,
  minCardWidth: 260,
  viewportScale: 1.0,
  remoteServers: [],
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('Config read error:', e.message);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(data) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

function labelVal(labels, key) {
  return labels?.[`homepage.${key}`] || null;
}

function getFirstPort(ports) {
  if (!ports) return null;
  for (const [proto, binding] of Object.entries(ports)) {
    if (proto.endsWith('/tcp') && Array.isArray(binding) && binding.length > 0) {
      return binding[0].HostPort;
    }
  }
  return null;
}

// FolderView Plus group lookup — 30s local cache
const FOLDERVIEW_DIR = process.env.FOLDERVIEW_DIR || '/folderview-config';
let folderViewCache = null;
let folderViewCacheTime = 0;

function loadFolderViewGroups() {
  const now = Date.now();
  if (folderViewCache && now - folderViewCacheTime < 30_000) return folderViewCache;

  const file = path.join(FOLDERVIEW_DIR, 'docker.json');
  try {
    if (!fs.existsSync(file)) {
      console.warn(`FolderView: docker.json not found at ${file}`);
      folderViewCache = {};
      folderViewCacheTime = now;
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const map = {};
    for (const folder of Object.values(parsed)) {
      if (folder.name && Array.isArray(folder.containers)) {
        for (const containerName of folder.containers) {
          map[containerName.toLowerCase()] = folder.name;
        }
      }
    }
    folderViewCache = map;
    folderViewCacheTime = now;
    console.log(`FolderView: loaded ${Object.keys(map).length} container→group mappings`);
    return map;
  } catch (e) {
    console.warn(`FolderView: failed to parse docker.json: ${e.message}`);
    folderViewCache = {};
    folderViewCacheTime = now;
    return {};
  }
}

function resolveIcon(name, labels) {
  // Priority: homepage.icon → CasaOS icon → Unraid icon → CDN fallback
  const custom = labelVal(labels, 'icon');
  if (custom) return custom;
  if (labels?.icon) return labels.icon;
  const unraidIcon = labels?.['net.unraid.docker.icon']?.replace(/^'|'$/g, '');
  if (unraidIcon) return unraidIcon;
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${normalized}.png`;
}

// Resolve net.unraid.docker.webui / CasaOS webui templates like http://[IP]:[PORT:11080]/
function resolveWebUI(webuiTemplate, hostIP, portsMap) {
  if (!webuiTemplate) return null;
  let url = webuiTemplate.replace(/^'|'$/g, '');
  url = url.replace(/\[IP\]/g, hostIP || 'localhost');
  url = url.replace(/\[PORT:(\d+)\]/g, (_, defaultPort) => {
    const mapped = portsMap?.[`${defaultPort}/tcp`]?.[0]?.HostPort;
    return mapped || defaultPort;
  });
  return url.startsWith('http') ? url : null;
}

function tsHostnameFromEnv(envArray) {
  if (!Array.isArray(envArray)) return null;
  const keys = ['TAILSCALE_HOSTNAME', 'TS_HOSTNAME', 'TAILSCALE_NAME', 'TS_EXTRA_ARGS'];
  for (const entry of envArray) {
    const eqIdx = entry.indexOf('=');
    if (eqIdx === -1) continue;
    const k = entry.slice(0, eqIdx);
    const v = entry.slice(eqIdx + 1);
    if (keys.includes(k) && v) {
      if (k === 'TS_EXTRA_ARGS') {
        const m = v.match(/--hostname[= ]([^\s]+)/);
        if (m) return m[1];
        continue;
      }
      return v;
    }
  }
  return null;
}

const TEMPLATES_DIR = process.env.UNRAID_TEMPLATES_DIR || '/unraid-templates';

function readTemplateXml(containerName) {
  try {
    const filePath = path.join(TEMPLATES_DIR, `${containerName}.xml`);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function displayNameFromTemplate(containerName) {
  const xml = readTemplateXml(containerName);
  if (!xml) return null;
  const m = xml.match(/<Name>([^<]+)<\/Name>/i);
  return m ? m[1].trim() : null;
}

function tsHostnameFromTemplate(containerName) {
  try {
    const xml = readTemplateXml(containerName);
    if (!xml) return null;

    const enabledMatch = xml.match(/<TailscaleEnabled[^>]*>([^<]+)<\/TailscaleEnabled>/i)
      || xml.match(/<Tailscale[^>]*>\s*<Enabled[^>]*>([^<]+)<\/Enabled>/i);
    if (enabledMatch && enabledMatch[1].trim().toLowerCase() !== 'true') return null;

    const hostnameMatch = xml.match(/<TailscaleHostname[^>]*>([^<]+)<\/TailscaleHostname>/i)
      || xml.match(/<Tailscale[^>]*>[\s\S]*?<Hostname[^>]*>([^<]+)<\/Hostname>/i);
    return hostnameMatch ? hostnameMatch[1].trim() : null;
  } catch {
    return null;
  }
}

async function inspectContainerWith(dockerClient, id) {
  try {
    return await dockerClient.getContainer(id).inspect();
  } catch {
    return null;
  }
}

// Remote server cache — 5 minute TTL
const remoteCache = new Map();
const REMOTE_CACHE_TTL = 5 * 60 * 1000;

function createDockerClient(server) {
  if (server.connectionType === 'ssh') {
    return new Docker({
      protocol: 'ssh',
      host: server.host,
      port: server.sshPort || 22,
      username: server.sshUser || 'root',
      sshAuthAgent: process.env.SSH_AUTH_SOCK || undefined,
    });
  }
  return new Docker({
    host: server.host,
    port: server.port || 2375,
    protocol: 'http',
  });
}

async function getContainers(config, opts = {}) {
  const { dockerClient = docker, useLocalFeatures = true, serverHostIP } = opts;
  const hostIP = serverHostIP || config.hostIP || 'localhost';

  let containers;
  try {
    containers = await dockerClient.listContainers({ all: false });
  } catch (e) {
    console.error('Docker error:', e.message);
    return [];
  }

  const filtered = containers.filter(c => {
    const enabled = labelVal(c.Labels, 'enable');
    return enabled === null || enabled === 'true';
  });

  const inspected = await Promise.all(filtered.map(c => inspectContainerWith(dockerClient, c.Id)));

  const folderGroups = useLocalFeatures ? loadFolderViewGroups() : {};

  const results = filtered.map((c, i) => {
    const info = inspected[i];
    const labels = c.Labels || {};
    const rawName = c.Names?.[0]?.replace(/^\//, '') || c.Id.slice(0, 12);
    const name = labelVal(labels, 'name')
      || labels['org.opencontainers.image.title']
      || rawName;
    const portsMap = c.Ports ? buildPortsMap(c.Ports) : null;
    const port = labelVal(labels, 'port') || getFirstPort(portsMap);
    const webuiUrl = resolveWebUI(labels['net.unraid.docker.webui'], hostIP, portsMap);

    const envVars = info?.Config?.Env || [];
    const tsHostname = labelVal(labels, 'tailscale.hostname')
      || (useLocalFeatures ? tsHostnameFromTemplate(rawName) : null)
      || tsHostnameFromEnv(envVars)
      || rawName;

    const cfUrl = labelVal(labels, 'cloudflare.url') ||
      (config.cloudflareDomain ? `https://${tsHostname}.${config.cloudflareDomain}` : null);

    const tsUrl = labelVal(labels, 'tailscale.url') ||
      (config.tailnetDomain ? `https://${tsHostname}.${config.tailnetDomain}` : null);

    const directUrl = labelVal(labels, 'direct.url') ||
      (port ? `http://${hostIP}:${port}` : null) ||
      webuiUrl;

    const hasWebInterface = !!port || !!webuiUrl
      || !!labelVal(labels, 'direct.url')
      || !!labelVal(labels, 'tailscale.url')
      || !!labelVal(labels, 'cloudflare.url');

    let group = labelVal(labels, 'group');
    if (!group && useLocalFeatures) {
      group = folderGroups[rawName.toLowerCase()]
        || folderGroups[(displayNameFromTemplate(rawName) || '').toLowerCase()]
        || null;
    }
    group = group || 'Apps';

    return {
      id: c.Id,
      name,
      rawName,
      description: labelVal(labels, 'description')
        || labels['org.opencontainers.image.description']
        || '',
      group,
      icon: resolveIcon(rawName, labels),
      status: c.State,
      cloudflareUrl: cfUrl,
      tailscaleUrl: tsUrl,
      tailscaleHostname: tsHostname,
      directUrl,
      port,
      _forceShow: labelVal(labels, 'enable') === 'true',
      _hasWebInterface: hasWebInterface,
    };
  });

  const webResults = results
    .filter(r => r._forceShow || r._hasWebInterface)
    .map(({ _forceShow, _hasWebInterface, ...r }) => r);

  return webResults.sort((a, b) => {
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    return a.name.localeCompare(b.name);
  });
}

async function getRemoteContainers(server, config) {
  const cached = remoteCache.get(server.name);
  if (cached && Date.now() - cached.timestamp < REMOTE_CACHE_TTL) {
    return { containers: cached.containers, cachedAt: cached.timestamp };
  }
  const client = createDockerClient(server);
  const containers = await getContainers(config, {
    dockerClient: client,
    useLocalFeatures: false,
    serverHostIP: server.hostIP || server.host,
  });
  remoteCache.set(server.name, { containers, timestamp: Date.now() });
  return { containers, cachedAt: Date.now() };
}

function buildPortsMap(portsArray) {
  const map = {};
  for (const p of portsArray) {
    if (p.PublicPort) {
      const key = `${p.PrivatePort}/${p.Type}`;
      if (!map[key]) map[key] = [];
      map[key].push({ HostPort: String(p.PublicPort) });
    }
  }
  return map;
}

// ── API routes ──────────────────────────────────────────────────────────────

app.get('/api/containers', async (req, res) => {
  const config = loadConfig();

  const localApps = await getContainers(config);
  const custom = (config.customApps || []).map(a => ({ ...a, id: `custom-${a.name}`, status: 'running' }));

  const servers = [{
    name: config.title || 'Unraid',
    isLocal: true,
    apps: [...localApps, ...custom],
    cachedAt: null,
  }];

  await Promise.all((config.remoteServers || []).map(async server => {
    try {
      const { containers, cachedAt } = await getRemoteContainers(server, config);
      servers.push({ name: server.name, isLocal: false, apps: containers, cachedAt });
    } catch (e) {
      servers.push({ name: server.name, isLocal: false, apps: [], cachedAt: null, error: e.message });
    }
  }));

  res.json({ servers, config, version: VERSION });
});

app.get('/api/config', (req, res) => res.json(loadConfig()));

app.post('/api/config', (req, res) => {
  const current = loadConfig();
  const updated = { ...current, ...req.body };
  saveConfig(updated);
  res.json({ ok: true, config: updated });
});

app.post('/api/custom-apps', (req, res) => {
  const config = loadConfig();
  const app = req.body;
  if (!app.name) return res.status(400).json({ error: 'name required' });
  config.customApps = config.customApps || [];
  const idx = config.customApps.findIndex(a => a.name === app.name);
  if (idx >= 0) config.customApps[idx] = app;
  else config.customApps.push(app);
  saveConfig(config);
  res.json({ ok: true });
});

app.delete('/api/custom-apps/:name', (req, res) => {
  const config = loadConfig();
  config.customApps = (config.customApps || []).filter(a => a.name !== req.params.name);
  saveConfig(config);
  res.json({ ok: true });
});

app.post('/api/servers', (req, res) => {
  const config = loadConfig();
  const server = req.body;
  if (!server.name || !server.host) return res.status(400).json({ error: 'name and host required' });
  config.remoteServers = config.remoteServers || [];
  const idx = config.remoteServers.findIndex(s => s.name === server.name);
  if (idx >= 0) config.remoteServers[idx] = server;
  else config.remoteServers.push(server);
  saveConfig(config);
  res.json({ ok: true });
});

app.delete('/api/servers/:name', (req, res) => {
  const config = loadConfig();
  config.remoteServers = (config.remoteServers || []).filter(s => s.name !== req.params.name);
  remoteCache.delete(req.params.name);
  saveConfig(config);
  res.json({ ok: true });
});

app.post('/api/cache/clear', (req, res) => {
  remoteCache.clear();
  res.json({ ok: true });
});

app.get('/api/debug/folderview', (req, res) => {
  folderViewCache = null;
  const groups = loadFolderViewGroups();
  const dir = FOLDERVIEW_DIR;
  let files = [];
  try { files = fs.readdirSync(dir); } catch {}
  res.json({ dir, files, groups });
});

app.get('/api/debug/:name', async (req, res) => {
  try {
    const list = await docker.listContainers({ all: false });
    const match = list.find(c =>
      (c.Names?.[0]?.replace(/^\//, '') || '').toLowerCase() === req.params.name.toLowerCase()
    );
    if (!match) return res.status(404).json({ error: 'container not found' });
    const info = await docker.getContainer(match.Id).inspect();
    res.json({
      name: req.params.name,
      envVars: info.Config?.Env || [],
      tsFromEnv: tsHostnameFromEnv(info.Config?.Env || []),
      tsFromTemplate: tsHostnameFromTemplate(req.params.name),
      templatesDir: TEMPLATES_DIR,
      templateExists: fs.existsSync(path.join(TEMPLATES_DIR, `${req.params.name}.xml`)),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 7654;
app.listen(PORT, () => console.log(`Undocked Launcher v${VERSION} running on http://localhost:${PORT}`));
