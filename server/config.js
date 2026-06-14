require('dotenv').config();

module.exports = {
  // HTTP server port
  port: process.env.PORT || 3000,

  // JWT configuration
  jwtSecret: process.env.JWT_SECRET || 'atomquest_super_secret_session_token_key_2026',

  // mediasoup settings
  mediasoup: {
    // Number of workers to spawn
    numWorkers: 1,
    
    // Worker settings
    worker: {
      logLevel: 'warn',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
      rtcMinPort: parseInt(process.env.RTC_MIN_PORT || 20000, 10),
      rtcMaxPort: parseInt(process.env.RTC_MAX_PORT || 20100, 10)
    },

    // Router settings
    router: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: { 'x-google-start-bitrate': 1000 }
        },
        {
          kind: 'video',
          mimeType: 'video/H264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1
          }
        }
      ]
    },

    // WebRtcTransport settings
    webRtcTransport: {
      listenIps: [
        {
          ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || null
        }
      ],
      initialAvailableOutgoingBitrate: 1000000,
      minimumAvailableOutgoingBitrate: 600000,
      maxSctpMessageSize: 262144,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    }
  },

  // STUN/TURN servers for cross-network WebRTC relay.
  // STUN: helps discover the server's public IP (works same-network only).
  // TURN: relays media when direct UDP is blocked (mobile data, strict firewalls, Render/Railway).
  // Set TURN_SERVER_URL, TURN_USERNAME, TURN_CREDENTIAL in your Render environment variables.
  // Get free credentials at: https://www.metered.ca/tools/openrelay/ (1 GB/month free)
  iceServers: (() => {
    const servers = [
      // Google STUN — very reliable, free, no account needed
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // Cloudflare STUN
      { urls: 'stun:stun.cloudflare.com:3478' },
    ];

    // Load TURN server from environment variables (set these in Render dashboard)
    if (process.env.TURN_SERVER_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      const turnUrl = process.env.TURN_SERVER_URL; // e.g. openrelay.metered.ca
      const username = process.env.TURN_USERNAME;
      const credential = process.env.TURN_CREDENTIAL;

      servers.push(
        // UDP on port 80 — rarely blocked by firewalls
        { urls: `turn:${turnUrl}:80`, username, credential },
        // TCP on port 443 — works through almost all firewalls and strict corporate networks
        { urls: `turns:${turnUrl}:443?transport=tcp`, username, credential },
        // UDP on port 443 as fallback
        { urls: `turn:${turnUrl}:443`, username, credential },
      );
    } else {
      console.warn('⚠️  No TURN credentials configured. Video calls may fail across different networks.');
      console.warn('   Set TURN_SERVER_URL, TURN_USERNAME, TURN_CREDENTIAL in your environment variables.');
      console.warn('   Get free credentials at: https://www.metered.ca/tools/openrelay/');
    }

    return servers;
  })()
};
