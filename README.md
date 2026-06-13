# AtomQuest Video Support Platform

> Real-time WebRTC video support platform built with mediasoup SFU, React, and Socket.IO.
> Agents can video call customers via a direct shareable link — no customer account needed.

---

## 📋 Table of Contents

1. [What This App Does](#what-this-app-does)
2. [Prerequisites](#prerequisites)
3. [Project Structure](#project-structure)
4. [First-Time Setup](#first-time-setup)
5. [Running Locally](#running-locally)
6. [Running on Other Devices / Internet](#running-on-other-devices--internet)
7. [Default Login Credentials](#default-login-credentials)
8. [How to Share Links with Customers](#how-to-share-links-with-customers)
9. [Hosting / Deployment](#hosting--deployment)
10. [Environment Variables](#environment-variables)
11. [Troubleshooting](#troubleshooting)

---

## What This App Does

| Feature | Description |
|---|---|
| 🎥 Video Calls | Multi-participant WebRTC video via mediasoup SFU |
| 🔗 Direct Links | Agents generate one-click invite links — customers join without signing up |
| 💬 Live Chat | Real-time in-call text chat |
| 🔇 Mute / Camera | Toggle audio and video with proper hardware release |
| 📤 File Sharing | Upload and share files during the call |
| 🔴 Recording | In-browser call recording |
| 👥 Multi-User | Up to 6+ participants per session |
| 📱 WhatsApp Share | One-click WhatsApp share with pre-written message |

---

## Prerequisites

Install these before anything else:

| Tool | Version | Download |
|---|---|---|
| **Node.js** | v18+ | https://nodejs.org |
| **ngrok** | Latest | https://ngrok.com/download |
| **Git** | Any | https://git-scm.com |

Verify they are installed:
```bash
node --version     # should be v18+
npm --version
ngrok --version
```

---

## Project Structure

```
AtomQuist_final/
├── server/               # Backend (Express + Socket.IO + mediasoup)
│   ├── index.js          # Main server entry point
│   ├── config.js         # mediasoup & server config (reads from .env)
│   ├── auth.js           # JWT auth + guest-join endpoint
│   ├── signaling.js      # WebRTC signaling via Socket.IO
│   ├── media.js          # mediasoup worker/router/transport management
│   ├── sessions.js       # Session CRUD API
│   ├── admin.js          # Admin API
│   ├── db.js             # SQLite database (auto-created at startup)
│   └── uploads.js        # File upload handling
│
├── frontend/             # React + Vite frontend
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Login.jsx          # Agent/Admin login
│   │   │   ├── AgentDashboard.jsx # Session management + invite link generator
│   │   │   ├── CallRoom.jsx       # Multi-peer video call room
│   │   │   ├── GuestJoin.jsx      # Customer landing page (no login needed)
│   │   │   └── AdminDashboard.jsx # Admin panel
│   │   ├── context/
│   │   │   ├── AuthContext.jsx    # Auth state + guestLogin
│   │   │   ├── SocketContext.jsx  # Socket.IO connection
│   │   │   └── ToastContext.jsx   # Toast notifications
│   │   └── App.jsx                # Routes
│   └── dist/                      # Built frontend (served by Express)
│
├── uploads/              # Uploaded files storage
├── .env                  # Environment variables (edit this)
├── launch.js             # One-command launcher (server + ngrok)
├── data.db               # SQLite database (auto-created)
└── package.json
```

---

## First-Time Setup

### Step 1 — Clone / Download the project

If you have a zip, extract it. If using git:
```bash
git clone <your-repo-url>
cd AtomQuist_final
```

### Step 2 — Install backend dependencies

```bash
npm install
```

### Step 3 — Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### Step 4 — Configure environment variables

Copy the example and edit it:
```bash
# On Windows (PowerShell):
Copy-Item .env.example .env   # if .env.example exists
# OR just edit .env directly
```

Open `.env` and set at minimum:
```env
PORT=3000
JWT_SECRET=change_this_to_a_random_secret_string
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=192.168.x.x   # your local IP (auto-detected on startup)
RTC_MIN_PORT=20000
RTC_MAX_PORT=20100
NODE_ENV=development
DB_PATH=./data.db
```

> **Tip:** You don't need to set `MEDIASOUP_ANNOUNCED_IP` — the server auto-detects your public IP on startup.

### Step 5 — Setup ngrok (one-time)

1. Go to https://ngrok.com → Sign up free
2. Download ngrok and put it in your PATH, or note where it is
3. Authenticate ngrok:
```bash
ngrok config add-authtoken YOUR_TOKEN_HERE
```

### Step 6 — Build the frontend

```bash
npm run build:frontend
```

---

## Running Locally

### Quickest way — one command:

```bash
npm run launch
```

This will:
1. 🧹 Kill any old server/ngrok processes
2. 🚀 Start the Express + mediasoup server
3. 🌐 Connect ngrok tunnel
4. Print your public URLs

**Output will look like:**
```
╔══════════════════════════════════════════════════════╗
║           AtomQuest is LIVE on the internet!         ║
╠══════════════════════════════════════════════════════╣
║  Public URL : https://xxxx.ngrok-free.app            ║
║  Agent URL  : https://xxxx.ngrok-free.app/dashboard  ║
║  Guest URL  : https://xxxx.ngrok-free.app/join?token=<token>  ║
╚══════════════════════════════════════════════════════╝
```

### Alternative — start only the server (no ngrok):

```bash
npm start
```

Then open: http://localhost:3000

---

## Running on Other Devices / Internet

> ⚠️ `localhost:3000` only works on **your own PC**. For other devices, use ngrok.

### Same WiFi network:
Use your local IP: `http://192.168.x.x:3000`
> Camera/mic won't work on mobile over HTTP. Use ngrok for HTTPS.

### Different network (internet):
Use the ngrok URL printed when you run `npm run launch`.

### Important — Open ngrok URL, not localhost:
When the agent opens the dashboard, they **must** open it via the ngrok URL so that invite links automatically use the correct public domain:
```
✅ https://xxxx.ngrok-free.app/dashboard   ← Links work everywhere
❌ http://localhost:3000/dashboard          ← Links only work on your PC
```

### Windows Firewall:
The first time, Windows may block UDP ports 20000-20100. Run this in admin PowerShell:
```powershell
netsh advfirewall firewall add rule name="AtomQuest-WebRTC-UDP" protocol=UDP dir=in localport=20000-20100 action=allow
netsh advfirewall firewall add rule name="AtomQuest-HTTP" protocol=TCP dir=in localport=3000 action=allow
```

---

## Default Login Credentials

| Role | Username | Password |
|---|---|---|
| **Agent** | `agent@atomquest.com` | `agent123` |
| **Admin** | `admin@atomquest.com` | `admin123` |

> Customers do **not** need an account — they use the direct invite link.

---

## How to Share Links with Customers

1. Log in as an agent → `https://your-ngrok-url/dashboard`
2. Click **"Generate Call Session"**
3. A direct link appears:
   ```
   https://your-ngrok-url/join?token=abc123
   ```
4. Share it via:
   - **📋 Copy Link** — paste anywhere
   - **💬 WhatsApp** — auto-opens WhatsApp with pre-written message
5. Customer clicks the link → enters their name → joins the call instantly
6. Agent clicks **"Join Call"** → call begins

---

## Hosting / Deployment

> Vercel **cannot** host this app. It needs a persistent server with UDP access.

### Option 1 — Railway (Recommended, Free Tier)

1. Go to https://railway.app → Sign up
2. Create a new project → Deploy from GitHub
3. Set environment variables (same as `.env` but set `PUBLIC_URL=https://your-app.up.railway.app`)
4. Railway exposes TCP but **not UDP** — WebRTC media won't work natively
5. You'll need a TURN server (see below) for full cross-network support

### Option 2 — Render (Free Tier)

1. Go to https://render.com → New Web Service
2. Connect your repo, set build command: `npm install && npm run build:frontend`
3. Set start command: `npm start`
4. Add environment variables

### Option 3 — DigitalOcean / AWS EC2 / Google Cloud VM (Full Support ✅)

Best for full WebRTC support. Bare VM gives full UDP port access.

```bash
# On the VM:
git clone <repo>
cd AtomQuist_final
npm install
npm run build:frontend

# Set PUBLIC_URL in .env to your VM's public IP or domain
echo "PUBLIC_URL=http://YOUR_VM_PUBLIC_IP:3000" >> .env

# Open UDP ports in VM firewall:
sudo ufw allow 20000:20100/udp
sudo ufw allow 3000/tcp

# Run permanently with PM2:
npm install -g pm2
pm2 start "node --experimental-sqlite server/index.js" --name atomquest
pm2 save
pm2 startup
```

Then access at `http://YOUR_VM_IP:3000`

> For HTTPS on a VM, add Nginx + Let's Encrypt (needed for camera/mic on mobile).

### Adding a TURN Server (Required for different-network video on cloud)

For cloud hosting where WebRTC media can't reach the server directly, add TURN:

1. Sign up at https://www.metered.ca/tools/openrelay/ (free)
2. Get your TURN credentials
3. Add to `.env`:
```env
TURN_SERVER_URL=turn:openrelay.metered.ca:80
TURN_USERNAME=your_username
TURN_CREDENTIAL=your_credential
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `JWT_SECRET` | `atomquest_...` | Secret for signing JWTs — change in production! |
| `MEDIASOUP_LISTEN_IP` | `0.0.0.0` | IP mediasoup listens on (keep as 0.0.0.0) |
| `MEDIASOUP_ANNOUNCED_IP` | auto-detected | Public IP announced in ICE candidates |
| `RTC_MIN_PORT` | `20000` | Min UDP port for WebRTC |
| `RTC_MAX_PORT` | `20100` | Max UDP port for WebRTC |
| `NODE_ENV` | `development` | Set to `production` when hosting |
| `DB_PATH` | `./data.db` | SQLite database file path |
| `PUBLIC_URL` | auto (ngrok) | Override the public URL for invite links |

---

## Troubleshooting

### ❌ "address already in use" on port 3000
Another server is already running. `npm run launch` kills it automatically. Or manually:
```powershell
Get-NetTCPConnection -LocalPort 3000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### ❌ ERR_NGROK_334 — ngrok endpoint already online
```powershell
taskkill /F /IM ngrok.exe
npm run launch
```

### ❌ Camera/microphone not working
- Must use **HTTPS** (ngrok URL) — HTTP blocks camera on non-localhost
- On mobile, always use the ngrok URL, never the local IP

### ❌ Video connects but no audio/video (different network)
- The mediasoup server's UDP ports must be reachable
- On home network: ensure router forwards UDP 20000-20100 to your PC
- On cloud VM: open UDP 20000-20100 in VM firewall
- Easiest fix: add a TURN server (see Hosting section)

### ❌ Customer gets "Invalid token" error
- The session may have expired or been ended by the agent
- Agent should generate a new session from the dashboard

### ❌ "Failed to get RTP capabilities"
The mediasoup server is not reachable. Check:
1. Server is running (`npm run launch`)
2. The URL in browser points to the ngrok URL, not localhost

---

## Quick Command Reference

```bash
# First time setup
npm install && cd frontend && npm install && cd ..
npm run build:frontend

# Start everything (server + ngrok)
npm run launch

# Start server only
npm start

# Rebuild frontend after code changes
npm run build:frontend

# Then restart server
npm run launch
```

---

*Built with ❤️ for AtomQuest Hackathon 2026*
