#!/usr/bin/env node
/**
 * AtomQuest Launcher
 * Kills stale processes, then starts Express/mediasoup + ngrok together.
 * Prints the public URL to share with customers.
 */

const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');

// Path to the local ngrok binary (bundled in project root)
const NGROK_BIN = path.join(__dirname, 'ngrok.exe');

// ─────────────────────────────────────────────
// 0. Kill any stale node/ngrok processes first
// ─────────────────────────────────────────────
function killStale() {
  console.log('🧹  Cleaning up stale processes...');
  try {
    // Kill ngrok first
    execSync('taskkill /F /IM ngrok.exe', { stdio: 'ignore', shell: true });
  } catch (_) {}
  try {
    // Kill any process holding port 3000 (PowerShell compatible)
    execSync(
      'Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }',
      { stdio: 'ignore', shell: 'powershell.exe' }
    );
  } catch (_) {}
  // Pause to let OS release ports
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
}

killStale();

const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// 1. Start the backend server
// ─────────────────────────────────────────────
console.log('\n🚀  Starting AtomQuest server...\n');
const serverProc = spawn(
  'node',
  ['--experimental-sqlite', 'server/index.js'],
  { stdio: 'inherit', env: { ...process.env } }
);

serverProc.on('error', (err) => {
  console.error('❌  Failed to start server:', err.message);
  process.exit(1);
});

// ─────────────────────────────────────────────
// 2. Wait for server to be ready, then start ngrok
// ─────────────────────────────────────────────
function waitForServer(retries = 20) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${PORT}`, (res) => {
        resolve();
      });
      req.on('error', () => {
        if (retries-- > 0) {
          setTimeout(check, 500);
        } else {
          reject(new Error('Server did not start in time'));
        }
      });
      req.end();
    };
    setTimeout(check, 1500); // Give server 1.5s head-start
  });
}

async function startNgrok() {
  try {
    await waitForServer();
  } catch (e) {
    console.warn('⚠️   Server readiness check timed out, starting ngrok anyway...');
  }

  console.log('\n🌐  Starting ngrok tunnel...\n');
  const ngrokProc = spawn(NGROK_BIN, ['http', String(PORT)], { stdio: 'pipe' });

  ngrokProc.stderr.on('data', (d) => process.stderr.write(d));
  ngrokProc.on('error', (err) => {
    console.error('❌  ngrok failed to start:', err.message);
    console.error('   Make sure ngrok.exe exists in the project root folder.');
  });

  // Poll ngrok local API to get the public URL
  let attempts = 0;
  const pollNgrok = setInterval(() => {
    attempts++;
    if (attempts > 30) {
      clearInterval(pollNgrok);
      console.warn('⚠️   Could not detect ngrok URL automatically. Check http://127.0.0.1:4040');
      return;
    }

    const req = http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const tunnel = data.tunnels?.find((t) => t.proto === 'https');
          if (tunnel) {
            clearInterval(pollNgrok);
            const publicUrl = tunnel.public_url;
            console.log('\n╔══════════════════════════════════════════════════════╗');
            console.log('║           AtomQuest is LIVE on the internet!         ║');
            console.log('╠══════════════════════════════════════════════════════╣');
            console.log(`║  Public URL : ${publicUrl.padEnd(38)}║`);
            console.log(`║  Agent URL  : ${(publicUrl + '/dashboard').padEnd(38)}║`);
            console.log(`║  Guest URL  : ${(publicUrl + '/join?token=<token>').padEnd(38)}║`);
            console.log('╠══════════════════════════════════════════════════════╣');
            console.log('║  Share the Guest URL with your customers.            ║');
            console.log('║  The agent dashboard will auto-generate direct links.║');
            console.log('╚══════════════════════════════════════════════════════╝\n');
          }
        } catch (e) {
          // still waiting
        }
      });
    });
    req.on('error', () => {}); // ignore — ngrok not ready yet
    req.end();
  }, 1000);
}

startNgrok();

// ─────────────────────────────────────────────
// 3. Graceful shutdown
// ─────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n\n🛑  Shutting down AtomQuest...');
  serverProc.kill();
  process.exit(0);
});
