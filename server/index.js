require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const sessionsRouter = require('./sessions');
const uploadsRouter = require('./uploads');
const adminRouter = require('./admin');
const media = require('./media');
const signaling = require('./signaling');

const app = express();
const server = http.createServer(app);

// Configure CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Express middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve public static folder
app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Mount API routes
app.use('/api/auth', auth.router);
app.use('/api/sessions', sessionsRouter);
app.use('/api/upload', uploadsRouter);
app.use('/api/admin', adminRouter);

// ICE servers config for browser clients (STUN + TURN for cross-network relay)
app.get('/api/ice-servers', (req, res) => {
  res.json({ iceServers: config.iceServers || [] });
});

// Public URL endpoint — returns the real public URL for invite links
// Works on Railway, Render, ngrok, and local dev automatically
app.get('/api/public-url', async (req, res) => {
  // 1. Railway auto-sets RAILWAY_PUBLIC_DOMAIN (e.g. myapp.up.railway.app)
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return res.json({ url: `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` });
  }

  // 2. Render auto-sets RENDER_EXTERNAL_URL (e.g. https://myapp.onrender.com)
  if (process.env.RENDER_EXTERNAL_URL) {
    return res.json({ url: process.env.RENDER_EXTERNAL_URL });
  }

  // 3. Explicit override in .env (any platform)
  if (process.env.PUBLIC_URL) {
    return res.json({ url: process.env.PUBLIC_URL });
  }

  // 4. Try ngrok local API (for local dev)
  try {
    const ngrokData = await new Promise((resolve, reject) => {
      const ngrokReq = require('http').get('http://127.0.0.1:4040/api/tunnels', (ngrokRes) => {
        let body = '';
        ngrokRes.on('data', (chunk) => (body += chunk));
        ngrokRes.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(e); }
        });
      });
      ngrokReq.on('error', reject);
      ngrokReq.setTimeout(1000, () => { ngrokReq.destroy(); reject(new Error('timeout')); });
    });
    const tunnel = ngrokData.tunnels?.find((t) => t.proto === 'https');
    if (tunnel) {
      return res.json({ url: tunnel.public_url });
    }
  } catch (_) {
    // ngrok not running — fall through
  }

  // 5. Fall back to the request origin (works behind any reverse proxy)
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return res.json({ url: `${proto}://${host}` });
});

// Fallback to landing page for unhandled client routes
app.get('*', (req, res, next) => {
  // If request is for an API route, let it pass (it will hit 404 naturally)
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// Configure Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Auto-detect public IP for cross-network WebRTC
async function detectPublicIp() {
  const stored = process.env.MEDIASOUP_ANNOUNCED_IP;
  if (stored && stored !== '127.0.0.1' && stored !== 'localhost') return stored;
  try {
    const ip = await new Promise((resolve, reject) => {
      const req = http.get('http://api.ipify.org', (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(d.trim()));
      });
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
    });
    console.log(`🌐  Public IP detected: ${ip}`);
    process.env.MEDIASOUP_ANNOUNCED_IP = ip;
    require('./config').mediasoup.webRtcTransport.listenIps[0].announcedIp = ip;
    return ip;
  } catch {
    console.warn('⚠️  Could not detect public IP — WebRTC limited to same network.');
    return stored || '127.0.0.1';
  }
}

// Start application
async function bootstrap() {
  try {
    // Detect public IP first so mediasoup announces the correct address
    await detectPublicIp();

    // Start mediasoup worker subprocesses
    await media.startMediasoup();

    // Setup Socket.IO Signaling for WebRTC & Chat
    signaling.setupSignaling(io);

    // Bind HTTP server
    server.listen(config.port, () => {
      console.log(`========================================================`);
      console.log(`  AtomQuest Video Support Server is running!`);
      console.log(`  URL: http://localhost:${config.port}`);
      console.log(`  Access is fully Secure Origin compatible (localhost/127.0.0.1)`);
      console.log(`========================================================`);
    });
  } catch (err) {
    console.error('Error starting video support server:', err);
    process.exit(1);
  }
}

bootstrap();
