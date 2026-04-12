# Bassani Health — Deployment Guide

## Option A: Local / On-Premise (fastest to get running)

### Prerequisites
- A PC or server running Windows 10+, macOS, or Ubuntu
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed
- Port 8000 open on your router (for LAN access from phones/tablets)

### Steps

```bash
# 1. Unzip the project
unzip bassani-LIVE-ready.zip
cd bassani-health

# 2. Generate a secure JWT secret
openssl rand -base64 48
# Paste the output into backend/.env as JWT_SECRET

# 3. Start everything
docker compose up --build

# 4. Open the app
# From the server:    http://localhost:8000
# From phones/tablets on same WiFi: http://[SERVER-IP]:8000
```

Find your server IP:
- Windows: `ipconfig` → look for IPv4 address
- Mac/Linux: `ifconfig` or `ip addr`

---

## Option B: Cloud Deployment (recommended for production)

### Recommended: DigitalOcean Droplet (~R180/month)

```bash
# 1. Create a Ubuntu 22.04 droplet on DigitalOcean / Hetzner / Linode
# Choose: 2 vCPU, 2GB RAM — plenty for this app

# 2. SSH into your server
ssh root@your-server-ip

# 3. Install Docker
curl -fsSL https://get.docker.com | sh

# 4. Upload your project (from your local machine)
scp -r bassani-health root@your-server-ip:/opt/bassani

# 5. On the server — start the app
cd /opt/bassani
docker compose up --build -d

# 6. Set up SSL with Let's Encrypt (free HTTPS)
apt install certbot python3-certbot-nginx -y
certbot --nginx -d your-domain.com

# 7. Copy nginx config
cp nginx.conf /etc/nginx/sites-available/bassani
ln -s /etc/nginx/sites-available/bassani /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

The app is now live at `https://your-domain.com` ✅

---

## Installing as an App on Phones & Tablets

### iPhone / iPad (Safari)
1. Open `https://your-domain.com` in **Safari** (must be Safari, not Chrome)
2. Tap the **Share** button (box with arrow)
3. Scroll down → tap **"Add to Home Screen"**
4. Name it "Bassani" → tap **Add**
5. The app icon appears on your home screen — opens fullscreen, no browser chrome

### Android Phone / Tablet (Chrome)
1. Open `https://your-domain.com` in **Chrome**
2. Chrome shows a banner: **"Add Bassani Health to Home screen"** — tap it
3. Or: tap the three-dot menu → **"Add to Home screen"** / **"Install app"**
4. App icon appears, opens fullscreen like a native app

### Access levels by device
| Device | Best for |
|--------|----------|
| Admin PC / laptop | Full management, reports, settings |
| iPad (admin) | Orders, customers, approvals |
| iPhone (supervisor) | Packing assignment (`/supervisor.html`) |
| 85" screen | Packing board (`/packing-board.html`) — open in Chrome, press F11 |
| Packer's phone | Packing board read-only or supervisor view |

---

## Syncing Existing Odoo Stock

**No import needed.** The moment the app starts:

1. All your Odoo products, stock levels, customers, orders and invoices
   load automatically via live XML-RPC calls
2. Nothing is duplicated — Odoo remains the single source of truth
3. The app adds a MongoDB layer only for: resellers, commission rates,
   healthcare submissions, audit logs, packing board state

**To verify your live Odoo data is flowing:**
```bash
cd backend
python3 test_odoo.py
```

This shows a live count of all records the app can see.

---

## Environment Variables (backend/.env)

| Variable | Value |
|----------|-------|
| `ODOO_URL` | `https://multisaas-odoo-bassani-health.odoo.com` |
| `ODOO_DB` | `multisaas_odoo_bassani_health_production_26851697` |
| `ODOO_USERNAME` | `support@multisaas.co.za` |
| `ODOO_PASSWORD` | *(your current API key — rotate after first deploy)* |
| `JWT_SECRET` | Generate: `openssl rand -base64 48` |
| `MONGO_URL` | `mongodb://mongo:27017` *(Docker handles this)* |

---

## URLs once deployed

| URL | Purpose |
|-----|---------|
| `https://your-domain.com` | Main app (login required) |
| `https://your-domain.com/packing-board.html` | 85" screen |
| `https://your-domain.com/supervisor.html` | Supervisor phone |
| `https://your-domain.com/docs` | API documentation |
| `https://your-domain.com/health` | Health check endpoint |

---

## Auto-restart on server reboot

```bash
# The app restarts automatically thanks to Docker's restart: always policy
# Verify with:
docker ps
# Should show containers as "Up X hours" or "Up X minutes (healthy)"
```

---

## Updating the app

```bash
cd /opt/bassani
git pull  # or re-upload changed files
docker compose up --build -d
# Zero-downtime: Docker restarts containers one by one
```
