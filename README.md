# Undocked Launcher

A self-hosted homelab dashboard that runs in Docker on Unraid. Automatically discovers all running containers and presents them as a clean, dark-themed grid — with one-tap access via **Cloudflare**, **Tailscale**, and **direct IP:port**.

![Undocked Launcher](https://img.shields.io/badge/version-1.2.3-6366f1?style=flat-square) ![Docker](https://img.shields.io/badge/docker-ready-10b981?style=flat-square) ![Unraid](https://img.shields.io/badge/unraid-compatible-f6821f?style=flat-square)

---

## Features

- **Auto-discovery** — reads all running containers via the Docker socket
- **FolderView Plus grouping** — mirrors your existing Unraid Docker folder layout; works even if containers are renamed
- **Tailscale support** — automatically reads the Tailscale hostname set in the Unraid Docker manager for each container
- **Cloudflare support** — uses the same hostname as Tailscale to build Cloudflare tunnel URLs
- **Three access buttons per app** — direct IP:port (green), Tailscale (purple), Cloudflare (orange)
- **Light and dark theme** — toggle in the navbar, persisted across sessions
- **Mobile-friendly** — responsive layout with large tap targets on phones
- **Custom apps** — add non-Docker services manually via the UI
- **API key reveal** — click-to-reveal + copy the API key for supported apps (Radarr/Sonarr/Lidarr/Prowlarr/Readarr/Whisparr, Bazarr, SABnzbd, Tautulli, Overseerr/Jellyseerr/Seerr), read directly from each app's own config file
- **Configurable display** — icon size, text size, button size, card width, and viewport scale via Settings
- **Auto-hides system containers** — only shows containers with a web interface unless explicitly forced with `homepage.enable=true`
- **Live version badge** — always know what's running

---

## Screenshots

| Desktop | Mobile |
|---|---|
| Cards grouped by FolderView Plus folders | Single-column layout with large tap targets |

---

## Requirements

- Unraid with Docker
- [FolderView Plus](https://forums.unraid.net/topic/156285-folderview-plus/) plugin (optional — containers fall back to "Apps" group without it)
- Tailscale Docker containers configured in Unraid (optional)
- Cloudflare Tunnel (optional)

---

## Installation

### Option A — Unraid Community Applications

1. In Unraid go to **Apps → Settings → Template Repositories** and add:
   ```
   https://raw.githubusercontent.com/jasontucker/undocked-launcher/main/
   ```
2. Click **Save**, then search for **undocked-launcher** in the Apps store
3. Click **Install** and fill in the config fields — defaults are pre-filled

> **Note:** The Docker image is hosted on GitHub Container Registry:
> `ghcr.io/jasontucker/undocked-launcher:latest`
> If installation fails with an "invalid reference format" error, do **not** paste the GitHub URL into the Repository field — that URL is only for registering the template. The image reference above is filled in automatically by the template.

---

### Option B — Clone with Git and Docker Compose

Unraid doesn't include Git by default. Install it first via **Nerd Tools** (available in Community Applications), then open the Unraid terminal:

#### 1. Install Git via Nerd Tools

In Unraid: **Apps → search "nerdtools"** → Install → enable **git** from the Nerd Tools settings page.

#### 2. Clone the repo

```bash
cd /mnt/user/appdata
git clone https://github.com/jasontucker/undocked-launcher.git
cd undocked-launcher
```

#### 3. Build and start

```bash
docker compose up -d --build
```

#### 4. Open the dashboard

```
http://<your-unraid-ip>:7654
```

#### Updating to the latest version

```bash
cd /mnt/user/appdata/undocked-launcher
git pull
docker compose up -d --build
```

---

## Configuration

Click the **gear icon** in the top right to open Settings.

| Setting | Description |
|---|---|
| **Dashboard Title** | Name shown in the header |
| **Host IP Address** | Your Unraid server's LAN IP — used for direct port links |
| **Cloudflare Base Domain** | e.g. `mydomain.com` — builds URLs as `https://<hostname>.mydomain.com` |
| **Tailnet Domain** | e.g. `tail1234ab.ts.net` — found at tailscale.com/admin/dns |

Settings are saved to `/config/settings.json` and persist across container restarts.

---

## Docker Labels

Override any value per-container by adding labels in the Unraid Docker manager:

```
homepage.name=Radarr
homepage.description=Movie Manager
homepage.group=Media
homepage.icon=https://example.com/icon.png
homepage.tailscale.hostname=movies
homepage.cloudflare.url=https://radarr.mydomain.com
homepage.tailscale.url=https://movies.tail1234ab.ts.net
homepage.direct.url=http://192.168.1.15:7878
homepage.enable=false
```

> `homepage.tailscale.hostname` is read automatically from the **Tailscale Hostname** field in the Unraid Docker manager — no label needed if you've already set it there.

---

## Tailscale Hostname Detection

Undocked Launcher resolves each container's Tailscale hostname using this priority order:

1. `homepage.tailscale.hostname` Docker label (manual override)
2. Unraid Docker template XML (`/boot/config/plugins/dockerMan/templates-user/`)
3. `TAILSCALE_HOSTNAME` / `TS_HOSTNAME` environment variable
4. Container name as fallback

The same hostname is used to build both the Tailscale URL and the Cloudflare URL.

---

## FolderView Plus Groups

Undocked Launcher reads `/boot/config/plugins/folderview.plus/docker.json` to group containers using the same folder structure you've set up in the Unraid Docker tab. Groups update within 30 seconds of any change in FolderView Plus.

To verify groups are being read:

```bash
curl http://<unraid-ip>:7654/api/debug/folderview
```

---

## API Key Reveal

Cards for supported apps get a **key icon** button. Clicking it fetches the app's own API key on demand (nothing is loaded until you click) and shows it in a copy-to-clipboard popup.

The key is read directly from each app's config file under the appdata mount — not from the app's own API — using a small registry in `server.js` (`API_KEY_REGISTRY`) that maps container name → config file path + format:

| App | Config file | Field |
|---|---|---|
| Radarr / Sonarr / Lidarr / Prowlarr / Readarr / Whisparr | `config.xml` | `<ApiKey>` |
| Bazarr | `config/config.yaml` | `auth.apikey` |
| SABnzbd | `sabnzbd.ini` | `[misc] api_key` |
| Tautulli | `config.ini` | `[General] api_key` |
| Overseerr / Jellyseerr / Seerr | `settings.json` | `main.apiKey` |

NZBGet isn't supported — it uses a control username/password pair, not a single API key. This feature is **local containers only** — apps discovered on a remote server (see Remote Servers in Settings) don't share this container's appdata mount, so they never show the key button.

**Adding a new app:** add one entry to `API_KEY_REGISTRY` in `server.js` with the container name (lowercased), the relative config path(s), the format (`xml-tag` / `ini` / `yaml-block` / `json-path`), and the field (plus `section` for ini/yaml). No frontend changes needed — the key button and modal are entirely data-driven off the registry.

**Per-container override:** if a container's name or config layout doesn't match the registry, override it with labels:
```
homepage.apikey.path=config/config.xml
homepage.apikey.format=xml-tag
homepage.apikey.field=ApiKey
```

> ⚠️ **Security note:** this feature requires mounting your entire Unraid appdata share read-only into this container (see Volume Mounts below), so it can read every app's config files — not just the API key field, though the app only ever *returns* the single extracted key, never raw file contents. This dashboard also has **no built-in authentication** — anyone who can reach its web port can now pull any discovered local app's API key on demand. If the dashboard isn't already behind Tailscale/Cloudflare Access or similar, don't expose its port publicly.

---

## Volume Mounts

| Host Path | Container Path | Purpose |
|---|---|---|
| `/var/run/docker.sock` | `/var/run/docker.sock` | Container discovery (read-only) |
| `./config` | `/config` | Persistent settings |
| `/boot/config/plugins/dockerMan/templates-user` | `/unraid-templates` | Tailscale hostname detection |
| `/boot/config/plugins/folderview.plus` | `/folderview-config` | FolderView Plus groups |
| `/mnt/user/appdata` | `/appdata` | API key discovery (read-only; see security note above) |

---

## Debug Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/containers` | All discovered containers with resolved URLs |
| `GET /api/config` | Current settings |
| `GET /api/apikey/:name` | Resolved API key for one local container (by container name), or 404 |
| `GET /api/debug/folderview` | FolderView Plus group mappings |
| `GET /api/debug/:name` | Raw env vars and Tailscale detection for a container |

---

## Tech Stack

- **Backend** — Node.js + Express + Dockerode
- **Frontend** — Vanilla HTML/CSS/JS (no build step)
- **Runtime** — Docker (Node 20 Alpine image)

---

## License

MIT
