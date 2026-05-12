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

## Volume Mounts

| Host Path | Container Path | Purpose |
|---|---|---|
| `/var/run/docker.sock` | `/var/run/docker.sock` | Container discovery (read-only) |
| `./config` | `/config` | Persistent settings |
| `/boot/config/plugins/dockerMan/templates-user` | `/unraid-templates` | Tailscale hostname detection |
| `/boot/config/plugins/folderview.plus` | `/folderview-config` | FolderView Plus groups |

---

## Debug Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/containers` | All discovered containers with resolved URLs |
| `GET /api/config` | Current settings |
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
