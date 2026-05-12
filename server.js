const express = require('express');
const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');

const VERSION = '1.3.1';

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

function buildDirectURL(hostIP, ports) {
  if (!ports || !hostIP) return null;
  for (const binding of Object.values(ports)) {
    if (Array.isArray(binding) && binding.length > 0) {
      const port = binding[0].HostPort;
      if (port) return `http://${hostIP}:${port}`;
    }
  }
  return null;
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

// FolderView Plus group lookup.
// Tries several common file locations and formats used by the Unraid plugin.
const FOLDERVIEW_DIR = process.env.FOLDERVIEW_DIR || '/folderview-config';
let folderViewCache = null;
let folderViewCacheTime = 0;

function loadFolderViewGroups() {
  const now = Date.now();
  if (folderViewCache && now - folderViewCacheTime < 30_000) return folderViewCache;

  // FolderView Plus stores folder assignments in docker.json.
  // Format: { "<randomId>": { "name": "FolderName", "containers": ["app1", "app2"] } }
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
  const custom = labelVal(labels, 'icon');
  if (custom) return custom;
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${normalized}.png`;
}

// Extract Tailscale hostname from container environment variables.
// Unraid sets one of these when "Tailscale Hostname" is configured in the Docker manager.
function tsHostnameFromEnv(envArray) {
  if (!Array.isArray(envArray)) return null;
  const keys = ['TAILSCALE_HOSTNAME', 'TS_HOSTNAME', 'TAILSCALE_NAME', 'TS_EXTRA_ARGS'];
  for (const entry of envArray) {
    const eqIdx = entry.indexOf('=');
    if (eqIdx === -1) continue;
    const k = entry.slice(0, eqIdx);
    const v = entry.slice(eqIdx + 1);
    if (keys.includes(k) && v) {
      // TS_EXTRA_ARGS may contain --hostname=foo
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

// Read Tailscale hostname from Unraid's Docker template XML files.
// Templates live at /boot/config/plugins/dockerMan/templates-user/<ContainerName>.xml
const TEMPLATES_DIR = process.env.UNRAID_TEMPLATES_DIR || '/unraid-templates';
function tsHostnameFromTemplate(containerName) {
  try {
    const filePath = path.join(TEMPLATES_DIR, `${containerName}.xml`);
    if (!fs.existsSync(filePath)) return null;
    const xml = fs.readFileSync(filePath, 'utf8');

    // Only proceed if Tailscale is enabled in the template
    const enabledMatch = xml.match(/<TailscaleEnabled[^>]*>([^<]+)<\/TailscaleEnabled>/i)
      || xml.match(/<Tailscale[^>]*>\s*<Enabled[^>]*>([^<]+)<\/Enabled>/i);
    if (enabledMatch && enabledMatch[1].trim().toLowerCase() !== 'true') return null;

    // Extract the hostname field
    const hostnameMatch = xml.match(/<TailscaleHostname[^>]*>([^<]+)<\/TailscaleHostname>/i)
      || xml.match(/<Tailscale[^>]*>[\s\S]*?<Hostname[^>]*>([^<]+)<\/Hostname>/i);
    return hostnameMatch ? hostnameMatch[1].trim() : null;
  } catch {
    return null;
  }
}

async function inspectContainer(id) {
  try {
    return await docker.getContainer(id).inspect();
  } catch {
    return null;
  }
}

async function getContainers(config) {
  let containers;
  try {
    containers = await docker.listContainers({ all: false });
  } catch (e) {
    console.error('Docker socket error:', e.message);
    return [];
  }

  const filtered = containers.filter(c => {
    const enabled = labelVal(c.Labels, 'enable');
    return enabled === null || enabled === 'true';
  });

  // Inspect all containers in parallel to get env vars
  const inspected = await Promise.all(filtered.map(c => inspectContainer(c.Id)));

  const folderGroups = loadFolderViewGroups();

  const results = filtered.map((c, i) => {
    const info = inspected[i];
    const labels = c.Labels || {};
    const rawName = c.Names?.[0]?.replace(/^\//, '') || c.Id.slice(0, 12);
    const name = labelVal(labels, 'name') || rawName;
    const port = labelVal(labels, 'port') || getFirstPort(c.Ports ? buildPortsMap(c.Ports) : null);
    const hostIP = config.hostIP || 'localhost';

    // Hostname priority (shared by both Tailscale and Cloudflare):
    // 1. homepage.tailscale.hostname label (manual override)
    // 2. Unraid Docker template XML (TailscaleHostname field)
    // 3. TAILSCALE_HOSTNAME / TS_HOSTNAME / TS_EXTRA_ARGS env var
    // 4. Container name as fallback
    const envVars = info?.Config?.Env || [];
    const tsHostname = labelVal(labels, 'tailscale.hostname')
      || tsHostnameFromTemplate(rawName)
      || tsHostnameFromEnv(envVars)
      || rawName;

    const cfUrl = labelVal(labels, 'cloudflare.url') ||
      (config.cloudflareDomain ? `https://${tsHostname}.${config.cloudflareDomain}` : null);

    const tsUrl = labelVal(labels, 'tailscale.url') ||
      (config.tailnetDomain
        ? `https://${tsHostname}.${config.tailnetDomain}`
        : null);

    const directUrl = labelVal(labels, 'direct.url') ||
      (port ? `http://${hostIP}:${port}` : null);

    return {
      id: c.Id,
      name,
      rawName,
      description: labelVal(labels, 'description') || '',
      group: labelVal(labels, 'group') || folderGroups[rawName.toLowerCase()] || 'Apps',
      icon: resolveIcon(rawName, labels),
      status: c.State,
      cloudflareUrl: cfUrl,
      tailscaleUrl: tsUrl,
      tailscaleHostname: tsHostname,
      directUrl,
      port,
    };
  });

  return results.sort((a, b) => {
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    return a.name.localeCompare(b.name);
  });
}

// c.Ports from listContainers is an array, convert to HostConfig.PortBindings shape
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

app.get('/api/containers', async (req, res) => {
  const config = loadConfig();
  const apps = await getContainers(config);
  const custom = (config.customApps || []).map(a => ({ ...a, id: `custom-${a.name}`, status: 'running' }));
  res.json({ apps: [...apps, ...custom], config, version: VERSION });
});

app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

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

// Debug: shows FolderView config
app.get('/api/debug/folderview', (req, res) => {
  folderViewCache = null;
  const groups = loadFolderViewGroups();
  const dir = FOLDERVIEW_DIR;
  let files = [];
  try { files = fs.readdirSync(dir); } catch {}
  res.json({ dir, files, groups });
});

// Debug: shows raw env vars + template detection for a container by name
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

app.delete('/api/custom-apps/:name', (req, res) => {
  const config = loadConfig();
  config.customApps = (config.customApps || []).filter(a => a.name !== req.params.name);
  saveConfig(config);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Undocked Launcher v${VERSION} running on http://localhost:${PORT}`));
