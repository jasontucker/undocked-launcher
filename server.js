const express = require('express');
const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');

const VERSION = '1.7.0';

const app = express();
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const CONFIG_PATH = '/config/settings.json';
const DEFAULT_CONFIG = {
  title: 'Undocked Launcher',
  tailnetDomain: '',
  cloudflareDomain: '',
  hostIP: '',
  customApps: [],
  iconOverrides: {},
  iconSize: 38,
  textSize: 13,
  buttonSize: 30,
  minCardWidth: 260,
  viewportScale: 1.0,
  remoteServers: [],
  groupOrder: [],
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

function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // ![alt](url) → alt
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [text](url) → text
    .replace(/\*\*([^*]+)\*\*/g, '$1')         // **bold** → bold
    .replace(/\*([^*]+)\*/g, '$1')             // *italic* → italic
    .replace(/`([^`]+)`/g, '$1')              // `code` → code
    .replace(/^#{1,6}\s+/gm, '')              // # headers
    .replace(/\n+/g, ' ')                     // newlines → space
    .trim();
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

// ── API Key discovery ────────────────────────────────────────────────────────
// Reads each app's own API key from its config file on disk (read-only appdata
// mount). Registry maps lowercased container name → { paths, format, field/section }.
// Local containers only — remote servers don't share this container's appdata mount.
// Only ever returns the single extracted field — never raw file contents.
const APPDATA_ROOT = process.env.APPDATA_ROOT || '/appdata';

const API_KEY_REGISTRY = {
  // *arr family — Servarr apps all share the config.xml + <ApiKey> shape.
  radarr:   { paths: ['config.xml'], format: 'xml-tag', field: 'ApiKey' },
  sonarr:   { paths: ['config.xml'], format: 'xml-tag', field: 'ApiKey' },
  lidarr:   { paths: ['config.xml'], format: 'xml-tag', field: 'ApiKey' },
  prowlarr: { paths: ['config.xml'], format: 'xml-tag', field: 'ApiKey' },
  readarr:  { paths: ['config.xml'], format: 'xml-tag', field: 'ApiKey' },
  whisparr: { paths: ['config.xml'], format: 'xml-tag', field: 'ApiKey' },

  bazarr:   { paths: ['config/config.yaml'], format: 'yaml-block', section: 'auth', field: 'apikey' },

  sabnzbd:  { paths: ['sabnzbd.ini'], format: 'ini', section: 'misc', field: 'api_key' },
  nzbget:   { format: 'unsupported' }, // ControlUsername/ControlPassword, not a single key

  tautulli: { paths: ['config.ini'], format: 'ini', section: 'General', field: 'api_key' },

  // Seerr / Overseerr / Jellyseerr rebrand — same settings.json shape across all three names
  // and across native vs. binhex layouts (binhex nests one extra `seerr/` folder).
  seerr:      { paths: ['settings.json', 'seerr/settings.json'], format: 'json-path', field: 'main.apiKey' },
  overseerr:  { paths: ['settings.json', 'seerr/settings.json'], format: 'json-path', field: 'main.apiKey' },
  jellyseerr: { paths: ['settings.json', 'seerr/settings.json'], format: 'json-path', field: 'main.apiKey' },
};

// Case-insensitive appdata folder resolution + cache (mirrors loadFolderViewGroups()).
let appdataDirCache = null;
let appdataDirCacheTime = 0;

function loadAppdataDirs() {
  const now = Date.now();
  if (appdataDirCache && now - appdataDirCacheTime < 30_000) return appdataDirCache;
  const map = {};
  try {
    for (const entry of fs.readdirSync(APPDATA_ROOT, { withFileTypes: true })) {
      if (entry.isDirectory()) map[entry.name.toLowerCase()] = entry.name;
    }
  } catch (e) {
    console.warn(`Appdata: failed to list ${APPDATA_ROOT}: ${e.message}`);
  }
  appdataDirCache = map;
  appdataDirCacheTime = now;
  return map;
}

function resolveAppdataDir(rawName) {
  return loadAppdataDirs()[rawName.toLowerCase()] || null;
}

// Per-container override via homepage.apikey.* labels, same convention as labelVal().
function resolveApiKeyEntry(rawName, labels) {
  const overridePath = labelVal(labels, 'apikey.path');
  if (overridePath) {
    return {
      paths: [overridePath],
      format: labelVal(labels, 'apikey.format') || 'ini',
      section: labelVal(labels, 'apikey.section') || undefined,
      field: labelVal(labels, 'apikey.field') || 'api_key',
    };
  }
  return API_KEY_REGISTRY[rawName.toLowerCase()] || null;
}

function extractXmlTag(content, field) {
  const m = content.match(new RegExp(`<${field}[^>]*>([^<]*)</${field}>`, 'i'));
  return m && m[1] ? m[1].trim() : null;
}

function extractIniField(content, section, field) {
  const secMatch = content.match(new RegExp(`^\\[${section}\\]\\r?\\n([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, 'mi'));
  const scope = secMatch ? secMatch[1] : content;
  const m = scope.match(new RegExp(`^${field}\\s*=\\s*(.*)$`, 'mi'));
  return m && m[1] ? m[1].trim() : null;
}

function extractYamlBlockField(content, section, field) {
  const secMatch = content.match(new RegExp(`^${section}:\\r?\\n((?:[ \\t]+.*\\r?\\n?)*)`, 'm'));
  if (!secMatch) return null;
  const m = secMatch[1].match(new RegExp(`^[ \\t]+${field}:\\s*(.+)$`, 'm'));
  return m && m[1] ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

function extractJsonPath(content, dottedField) {
  let data;
  try { data = JSON.parse(content); } catch { return null; }
  const val = dottedField.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
  return val || null;
}

function getApiKey(rawName, labels) {
  const entry = resolveApiKeyEntry(rawName, labels);
  if (!entry || entry.format === 'unsupported') return null;
  const dirName = resolveAppdataDir(rawName);
  if (!dirName) return null;

  for (const relPath of entry.paths) {
    const filePath = path.join(APPDATA_ROOT, dirName, relPath);
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      let key = null;
      if (entry.format === 'xml-tag')         key = extractXmlTag(content, entry.field);
      else if (entry.format === 'ini')        key = extractIniField(content, entry.section, entry.field);
      else if (entry.format === 'yaml-block') key = extractYamlBlockField(content, entry.section, entry.field);
      else if (entry.format === 'json-path')  key = extractJsonPath(content, entry.field);
      if (key) return key;
    } catch (e) {
      console.warn(`ApiKey: failed to read ${filePath}: ${e.message}`);
    }
  }
  return null;
}

function hasApiKeyFile(rawName, labels) {
  const entry = resolveApiKeyEntry(rawName, labels);
  if (!entry || entry.format === 'unsupported') return false;
  const dirName = resolveAppdataDir(rawName);
  if (!dirName) return false;
  return entry.paths.some(p => fs.existsSync(path.join(APPDATA_ROOT, dirName, p)));
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
        || stripMarkdown(labels['org.opencontainers.image.description'])
        || '',
      group,
      icon: config.iconOverrides?.[rawName] || resolveIcon(rawName, labels),
      status: c.State,
      cloudflareUrl: cfUrl,
      tailscaleUrl: tsUrl,
      tailscaleHostname: tsHostname,
      directUrl,
      port,
      hasApiKey: useLocalFeatures ? hasApiKeyFile(rawName, labels) : false,
      _forceShow: labelVal(labels, 'enable') === 'true',
      _hasWebInterface: hasWebInterface,
    };
  });

  const webResults = results
    .filter(r => r._forceShow || r._hasWebInterface)
    .map(({ _forceShow, _hasWebInterface, ...r }) => r);

  const order = config.groupOrder || [];
  return webResults.sort((a, b) => {
    if (a.group !== b.group) {
      const ai = order.indexOf(a.group);
      const bi = order.indexOf(b.group);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a.group.localeCompare(b.group);
    }
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

app.post('/api/icon-override', (req, res) => {
  const { containerName, iconUrl } = req.body;
  if (!containerName || !iconUrl) return res.status(400).json({ error: 'containerName and iconUrl required' });
  const config = loadConfig();
  config.iconOverrides = config.iconOverrides || {};
  config.iconOverrides[containerName] = iconUrl;
  saveConfig(config);
  remoteCache.clear(); // ensure remote containers reflect the new override immediately
  res.json({ ok: true });
});

app.delete('/api/icon-override/:name', (req, res) => {
  const config = loadConfig();
  delete (config.iconOverrides || {})[req.params.name];
  saveConfig(config);
  remoteCache.clear();
  res.json({ ok: true });
});

app.post('/api/cache/clear', (req, res) => {
  remoteCache.clear();
  res.json({ ok: true });
});

// Returns a single local app's API key, resolved via the registry. Only the
// extracted key is ever returned — never raw file contents.
app.get('/api/apikey/:name', async (req, res) => {
  try {
    const list = await docker.listContainers({ all: false });
    const match = list.find(c =>
      (c.Names?.[0]?.replace(/^\//, '') || '').toLowerCase() === req.params.name.toLowerCase()
    );
    if (!match) return res.status(404).json({ error: 'container not found' });
    const rawName = match.Names[0].replace(/^\//, '');
    const key = getApiKey(rawName, match.Labels || {});
    if (!key) return res.status(404).json({ error: 'no API key found' });
    res.json({ key });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
