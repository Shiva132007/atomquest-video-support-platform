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

  // Free TURN/STUN servers for cross-network WebRTC relay
  // These are sent to the browser client so it can relay media through TURN
  // when direct UDP connection to mediasoup is blocked (mobile data / different network)
  iceServers: [
    // Google STUN (very reliable, free)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    // Cloudflare STUN (reliable, free)
    { urls: 'stun:stun.cloudflare.com:3478' },
    // Open Relay TURN (free, no account) — UDP on port 80 (rarely blocked)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    // Open Relay TURN — TCP on port 443 (works through strict firewalls)
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    // Viagenie TURN (well-known free public TURN)
    {
      urls: 'turn:numb.viagenie.ca',
      username: 'webrtc@live.com',
      credential: 'muazkh'
    },
    // Twilio STUN (free, no account needed for STUN)
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]
};
