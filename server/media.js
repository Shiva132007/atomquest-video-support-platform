const mediasoup = require('mediasoup');
const config = require('./config');

const workers = [];
let nextWorkerIdx = 0;

// Active rooms map: sessionId -> { router, peers: Map(peerId -> { transports: Map, producers: Map, consumers: Map }) }
const rooms = new Map();

// Start mediasoup workers
async function startMediasoup() {
  const numWorkers = config.mediasoup.numWorkers;
  console.log(`Spawning ${numWorkers} mediasoup Workers...`);

  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: config.mediasoup.worker.logLevel,
      logTags: config.mediasoup.worker.logTags,
      rtcMinPort: config.mediasoup.worker.rtcMinPort,
      rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
    });

    worker.on('died', () => {
      console.error(`mediasoup Worker died, exiting in 2 seconds...`);
      setTimeout(() => process.exit(1), 2000);
    });

    workers.push(worker);
  }

  console.log(`Successfully spawned ${workers.length} mediasoup Workers.`);
}

// Get next worker round-robin
function getWorker() {
  const worker = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
}

// Get or create room
async function getOrCreateRoom(sessionId) {
  let room = rooms.get(sessionId);
  if (!room) {
    const worker = getWorker();
    const router = await worker.createRouter({
      mediaCodecs: config.mediasoup.router.mediaCodecs,
    });
    room = {
      router,
      peers: new Map()
    };
    rooms.set(sessionId, room);
    console.log(`Created mediasoup Router for session: ${sessionId}`);
  }
  return room;
}

// Create WebRtcTransport
async function createWebRtcTransport(sessionId, peerId, direction) {
  const room = await getOrCreateRoom(sessionId);
  const { router } = room;

  const transport = await router.createWebRtcTransport({
    listenIps: config.mediasoup.webRtcTransport.listenIps,
    enableUdp: config.mediasoup.webRtcTransport.enableUdp,
    enableTcp: config.mediasoup.webRtcTransport.enableTcp,
    preferUdp: config.mediasoup.webRtcTransport.preferUdp,
    initialAvailableOutgoingBitrate: config.mediasoup.webRtcTransport.initialAvailableOutgoingBitrate
  });

  if (config.mediasoup.webRtcTransport.maxSctpMessageSize) {
    // SCTP parameters are configured if SCTP capability exists
  }

  // Handle transport close or timeout events
  transport.on('dtlsstatechange', (dtlsState) => {
    if (dtlsState === 'failed' || dtlsState === 'closed') {
      console.log(`Transport DTLS state changed to ${dtlsState}, closing transport.`);
      transport.close();
    }
  });

  // Track the transport on the peer
  let peer = room.peers.get(peerId);
  if (!peer) {
    peer = { transports: new Map(), producers: new Map(), consumers: new Map() };
    room.peers.set(peerId, peer);
  }
  peer.transports.set(transport.id, { transport, direction });

  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
    sctpParameters: transport.sctpParameters
  };
}

// Close session/room
function closeRoom(sessionId) {
  const room = rooms.get(sessionId);
  if (!room) return;

  console.log(`Closing mediasoup room for session: ${sessionId}`);
  for (const [peerId, peer] of room.peers.entries()) {
    for (const { transport } of peer.transports.values()) {
      transport.close();
    }
  }
  room.router.close();
  rooms.delete(sessionId);
}

// Clean up single peer on leave
function removePeer(sessionId, peerId) {
  const room = rooms.get(sessionId);
  if (!room) return;

  const peer = room.peers.get(peerId);
  if (!peer) return;

  console.log(`Removing peer ${peerId} from mediasoup room ${sessionId}`);
  for (const { transport } of peer.transports.values()) {
    transport.close();
  }
  room.peers.delete(peerId);

  // If no peers left, close the room
  if (room.peers.size === 0) {
    closeRoom(sessionId);
  }
}

module.exports = {
  startMediasoup,
  getOrCreateRoom,
  createWebRtcTransport,
  closeRoom,
  removePeer,
  rooms
};
