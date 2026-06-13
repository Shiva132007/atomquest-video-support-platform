const db = require('./db');
const media = require('./media');

const disconnectTimeouts = new Map(); // userId -> timeoutObject
const userActiveSessions = new Map(); // socket.id -> { sessionId, userId, userName, role }
const sessionPeers = new Map(); // sessionId -> Map(userId -> { name, role })

function setupSignaling(io) {
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Join Room
    socket.on('join-room', async ({ sessionId, userId, role, name }, callback) => {
      try {
        console.log(`User ${name} (${role}) joining session: ${sessionId}`);

        // Check if there is an active disconnect timeout for this user
        if (disconnectTimeouts.has(userId)) {
          console.log(`User ${name} reconnected within grace window. Clearing timeout.`);
          clearTimeout(disconnectTimeouts.get(userId));
          disconnectTimeouts.delete(userId);
        } else {
          // Log join event in db and notify others
          db.events.log(sessionId, 'join', userId, { name, role });
          db.participants.add(sessionId, userId, role, name);

          // If session is ended/waiting, set active
          const session = db.sessions.getById(sessionId);
          if (session && session.status === 'waiting') {
            db.sessions.updateStatus(sessionId, 'active');
          }

          // Broadcast to other peers in room
          socket.to(sessionId).emit('user-joined', { userId, name, role });
        }

        // Add socket to Socket.IO room
        socket.join(sessionId);
        userActiveSessions.set(socket.id, { sessionId, userId, userName: name, role });

        // Store peer info for this session
        if (!sessionPeers.has(sessionId)) sessionPeers.set(sessionId, new Map());
        sessionPeers.get(sessionId).set(userId, { name, role });

        // Retrieve existing producers in this mediasoup room
        const room = await media.getOrCreateRoom(sessionId);
        const existingProducerIds = [];
        const existingPeers = [];
        const producerPeerMap = {};

        for (const [peerId, peer] of room.peers.entries()) {
          if (peerId !== userId) {
            const peerInfo = sessionPeers.get(sessionId)?.get(peerId) || { name: 'Guest', role: 'customer' };
            existingPeers.push({ userId: peerId, name: peerInfo.name, role: peerInfo.role });
            for (const producerId of peer.producers.keys()) {
              existingProducerIds.push(producerId);
              producerPeerMap[producerId] = peerId;
            }
          }
        }

        callback({
          routerRtpCapabilities: room.router.rtpCapabilities,
          existingProducerIds,
          existingPeers,
          producerPeerMap
        });
      } catch (err) {
        console.error('Join room error:', err);
        callback({ error: err.message });
      }
    });

    // Get Router RTP Capabilities
    socket.on('get-rtp-capabilities', async ({ sessionId }, callback) => {
      try {
        const room = await media.getOrCreateRoom(sessionId);
        callback(room.router.rtpCapabilities);
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // Create WebRTC Transport
    socket.on('create-transport', async ({ sessionId, userId, direction }, callback) => {
      try {
        const transportParams = await media.createWebRtcTransport(sessionId, userId, direction);
        // Include TURN/STUN servers so browser can relay media cross-network
        const config = require('./config');
        callback({ ...transportParams, iceServers: config.iceServers || [] });
      } catch (err) {
        console.error('Create transport error:', err);
        callback({ error: err.message });
      }
    });

    // Connect WebRTC Transport
    socket.on('connect-transport', async ({ sessionId, userId, transportId, dtlsParameters }, callback) => {
      try {
        const room = media.rooms.get(sessionId);
        const peer = room.peers.get(userId);
        const transportData = peer.transports.get(transportId);
        if (transportData) {
          await transportData.transport.connect({ dtlsParameters });
          callback({ success: true });
        } else {
          callback({ error: 'Transport not found' });
        }
      } catch (err) {
        console.error('Connect transport error:', err);
        callback({ error: err.message });
      }
    });

    // Produce Media
    socket.on('produce', async ({ sessionId, userId, transportId, kind, rtpParameters, appData }, callback) => {
      try {
        const room = media.rooms.get(sessionId);
        const peer = room.peers.get(userId);
        const transportData = peer.transports.get(transportId);

        if (!transportData) {
          return callback({ error: 'Transport not found' });
        }

        const producer = await transportData.transport.produce({ kind, rtpParameters, appData });
        peer.producers.set(producer.id, producer);

        // Handle producer close
        producer.on('transportclose', () => {
          console.log(`Producer transport closed: ${producer.id}`);
          producer.close();
          peer.producers.delete(producer.id);
        });

        // Broadcast to other peers in room (include peer name/role for UI)
        const peerInfo = sessionPeers.get(sessionId)?.get(userId) || { name: 'Guest', role: 'customer' };
        socket.to(sessionId).emit('new-producer', {
          producerId: producer.id,
          peerId: userId,
          peerName: peerInfo.name,
          peerRole: peerInfo.role
        });

        callback({ id: producer.id });
      } catch (err) {
        console.error('Produce error:', err);
        callback({ error: err.message });
      }
    });

    // Consume Media
    socket.on('consume', async ({ sessionId, userId, transportId, producerId, rtpCapabilities }, callback) => {
      try {
        const room = media.rooms.get(sessionId);
        if (!room.router.canConsume({ producerId, rtpCapabilities })) {
          return callback({ error: 'Cannot consume producer' });
        }

        const peer = room.peers.get(userId);
        const transportData = peer.transports.get(transportId);

        if (!transportData) {
          return callback({ error: 'Transport not found' });
        }

        const consumer = await transportData.transport.consume({
          producerId,
          rtpCapabilities,
          paused: true // start paused, let client resume when ready
        });

        peer.consumers.set(consumer.id, consumer);

        // Handle consumer close
        consumer.on('transportclose', () => {
          consumer.close();
          peer.consumers.delete(consumer.id);
        });

        consumer.on('producerclose', () => {
          socket.emit('consumer-closed', { consumerId: consumer.id });
          consumer.close();
          peer.consumers.delete(consumer.id);
        });

        callback({
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters
        });
      } catch (err) {
        console.error('Consume error:', err);
        callback({ error: err.message });
      }
    });

    // Resume Consumer
    socket.on('resume-consumer', async ({ sessionId, userId, consumerId }, callback) => {
      try {
        const room = media.rooms.get(sessionId);
        const peer = room.peers.get(userId);
        const consumer = peer.consumers.get(consumerId);
        if (consumer) {
          await consumer.resume();
          callback({ success: true });
        } else {
          callback({ error: 'Consumer not found' });
        }
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // Chat messaging
    socket.on('send-message', ({ sessionId, senderId, senderName, senderRole, content, type = 'text', fileUrl = null }) => {
      try {
        const msg = db.messages.create(sessionId, senderId, senderName, senderRole, content, type, fileUrl);
        io.to(sessionId).emit('message', msg);
      } catch (err) {
        console.error('Send message error:', err);
      }
    });

    // Video state changed (camera on/off) — broadcast to other peers
    socket.on('video-state-changed', ({ sessionId, userId, enabled }) => {
      // Broadcast to everyone ELSE in the room
      socket.to(sessionId).emit('remote-video-state', { userId, enabled });
    });

    // Audio state changed (mic on/off) — broadcast to other peers
    socket.on('audio-state-changed', ({ sessionId, userId, enabled }) => {
      socket.to(sessionId).emit('remote-audio-state', { userId, enabled });
    });

    // User explicitly leaves (e.g. clicks hang up button)
    socket.on('leave-room', ({ sessionId, userId, role, name }) => {
      console.log(`User ${name} (${role}) explicitly left session: ${sessionId}`);
      
      // Clean up user active session mapping
      userActiveSessions.delete(socket.id);
      // Clean up peer info
      sessionPeers.get(sessionId)?.delete(userId);
      
      if (sessionId) {
        // Handle db updates
        db.participants.markLeft(sessionId, userId);
        db.events.log(sessionId, 'leave', userId, { name, role });

        // Clean up mediasoup structures
        media.removePeer(sessionId, userId);

        // Broadcast to other users immediately
        socket.to(sessionId).emit('user-left', { userId, name, role });
        socket.leave(sessionId);
      }
    });

    // Handle unexpected disconnects (connection dropped)
    socket.on('disconnect', () => {
      const sessionInfo = userActiveSessions.get(socket.id);
      if (sessionInfo) {
        const { sessionId, userId, userName, role } = sessionInfo;
        userActiveSessions.delete(socket.id);

        console.log(`User ${userName} disconnected. Waiting 30 seconds grace period...`);

        // Set grace period timer
        const timeout = setTimeout(() => {
          console.log(`Grace period expired for user ${userName}. Clean up session.`);
          disconnectTimeouts.delete(userId);

          // Update DB
          db.participants.markLeft(sessionId, userId);
          db.events.log(sessionId, 'leave_timeout', userId, { name: userName, role });

          // Mediasoup cleanup
          media.removePeer(sessionId, userId);

          // Clean up peer info
          sessionPeers.get(sessionId)?.delete(userId);

          // Notify others in the room
          io.to(sessionId).emit('user-left', { userId, name: userName, role });
        }, 30000); // 30 seconds

        disconnectTimeouts.set(userId, timeout);
      }
    });
  });
}

module.exports = {
  setupSignaling
};
