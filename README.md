# Undocked Launcher

A self-hosted homelab dashboard that runs in Docker on Unraid. Automatically discovers all running containers and presents them as a clean, dark-themed grid — with one-tap access via **Cloudflare**, **Tailscale**, and **direct IP:port**.

![Undocked Launcher](https://img.shields.io/badge/version-1.2.3-6366f1?style=flat-square) ![Docker](https://img.shields.io/badge/docker-ready-10b981?style=flat-square) ![Unraid](https://img.shields.io/badge/unraid-compatible-f6821f?style=flat-square)

---

## Features

- **Auto-discovery** — reads all running containers via the Docker socket
- **FolderView Plus grouping** — containers are grouped using your existing FolderView Plus folder assignments
- **Tailscale support** — automatically reads the Tailscale hostname set in the Unraid Docker manager for each container
- **Cloudflare support** — uses the same hostname as Tailscale to build Cloudflare tunnel URLs
- **Three access buttons per app** — direct IP:port (green), Tailscale (purple), Cloudflare (orange)
- **Mobile-friendly** — responsive layout with large tap targets on phones
- **Custom apps** — add non-Docker services manually via the UI
- **Live version badge** — always know what's running
- **No auto-refresh** — loads fresh data on every page visit

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

### 1. Copy files to Unraid

```bash
mkdir -p /mnt/user/appdata/undocked-launcher
```

Copy the project files to `/mnt/user/appdata/undocked-launcher/` via SCP or your file manager.

### 2. Deploy with Docker Compose

```bash
cd /mnt/user/appdata/undocked-launcher
docker compose up -d --build
```

### 3. Open the dashboard

```
http://<your-unraid-ip>:7654
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
