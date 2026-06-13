import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Device } from 'mediasoup-client';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
import { apiFetch, formatDuration } from '../utils/api';

export default function CallRoom() {
  const { user } = useAuth();
  const socket = useSocket();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionToken = searchParams.get('token');

  // React UI state
  const [roomConnected, setRoomConnected] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingPulse, setRecordingPulse] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [chatOpen, setChatOpen] = useState(true);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  // Multi-peer state: { [peerId]: { name, role, videoOff, audioOff } }
  const [remotePeers, setRemotePeers] = useState({});

  // WebRTC & DOM Refs
  const localVideoRef = useRef(null);
  const peerVideoRefs = useRef({}); // { [peerId]: HTMLVideoElement }
  const peerStreams = useRef({});   // { [peerId]: MediaStream }
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);


  // Connection Instance Refs (To prevent React re-render loops)
  const stateRef = useRef({
    sessionId: null,
    localStream: null,
    screenStream: null,
    device: null,
    sendTransport: null,
    recvTransport: null,
    producers: new Map(),
    consumers: new Map(),
    consumerPeerMap: new Map(), // consumerId -> peerId
    peerConsumers: new Map(),   // peerId -> Set<consumerId>
    audioProducer: null,
    videoProducer: null,
    recordedChunks: [],
    mediaRecorder: null,
    // Live boolean flags (avoids stale closure bugs in handlers)
    audioEnabled: true,
    videoEnabled: true
  });

  // 1. Load Session & Connect Signaling on Mount
  useEffect(() => {
    if (!sessionToken) {
      addToast('Invalid invite link (no token provided)', 'danger');
      navigate('/dashboard');
      return;
    }

    let isMounted = true;
    let timerInterval = null;

    const setupSession = async () => {
      try {
        const session = await apiFetch(`/api/sessions/by-token/${sessionToken}`);
        if (!isMounted) return;
        stateRef.current.sessionId = session.id;

        // Ensure Socket is connected before signaling
        if (socket) {
          initializeSignaling();
          // Start Timer
          timerInterval = setInterval(() => {
            setCallDuration((prev) => prev + 1);
          }, 1000);
        }
      } catch (err) {
        addToast(err.message, 'danger');
        navigate('/dashboard');
      }
    };

    setupSession();

    return () => {
      isMounted = false;
      if (timerInterval) clearInterval(timerInterval);
      cleanupCall();
    };
  }, [sessionToken, socket]);

  // Sync peer streams → video elements every time remotePeers state changes.
  // This handles the race where the stream arrives before the DOM element is mounted.
  useEffect(() => {
    // Small delay so React has time to mount the video elements first
    const sync = () => {
      for (const [peerId, peer] of Object.entries(remotePeers)) {
        if (peer.videoOff) continue;
        const videoEl = peerVideoRefs.current[peerId];
        const stream = peerStreams.current[peerId];
        if (videoEl && stream && videoEl.srcObject !== stream) {
          videoEl.srcObject = stream;
          videoEl.play().catch(err => {
            // Autoplay blocked — will play on next user interaction
            console.warn(`Autoplay blocked for peer ${peerId}:`, err.name);
          });
        }
      }
    };
    const timer = setTimeout(sync, 50);
    return () => clearTimeout(timer);
  }, [remotePeers]);

  // Scroll chat to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, chatOpen]);

  // 2. Configure Signaling Socket Listeners
  const initializeSignaling = () => {
    if (!socket) return;
    const { sessionId } = stateRef.current;

    // Join room signaling
    socket.emit('join-room', {
      sessionId,
      userId: user.id,
      role: user.role,
      name: user.name
    }, async (response) => {
      if (response.error) {
        addToast(response.error, 'danger');
        navigate('/dashboard');
        return;
      }

      console.log('Room joined, initializing mediasoup...');
      await setupMediasoupDevice(response.routerRtpCapabilities);
      await startCameraStream();

      // Populate already-present peers in state
      if (response.existingPeers && response.existingPeers.length > 0) {
        const peersObj = {};
        response.existingPeers.forEach(p => {
          peersObj[p.userId] = { name: p.name, role: p.role, videoOff: false, audioOff: false };
        });
        setRemotePeers(peersObj);
      }

      // Consume any existing users already broadcasting
      if (response.existingProducerIds && response.existingProducerIds.length > 0) {
        const peerMap = response.producerPeerMap || {};
        for (const producerId of response.existingProducerIds) {
          const peerId = peerMap[producerId];
          const peerInfo = response.existingPeers?.find(p => p.userId === peerId);
          await consumeRemoteTrack(producerId, peerId, peerInfo?.name, peerInfo?.role);
        }
      }

      // Load initial chat
      loadChatHistory(sessionId);
      setRoomConnected(true);
    });

    // Listeners
    socket.on('new-producer', handleNewProducer);
    socket.on('consumer-closed', handleConsumerClosed);
    socket.on('user-joined', handleUserJoined);
    socket.on('user-left', handleUserLeft);
    socket.on('message', handleReceiveMessage);

    // Remote camera on/off state (reliable socket signal)
    socket.on('remote-video-state', ({ userId, enabled }) => {
      setRemotePeers(prev => ({
        ...prev,
        [userId]: { ...(prev[userId] || {}), videoOff: !enabled }
      }));
      if (!enabled) {
        // Clear frozen frame from that peer's video element
        const videoEl = peerVideoRefs.current[userId];
        if (videoEl) videoEl.srcObject = null;
      }
    });

    // Reconnection syncing
    socket.on('connect', handleSocketReconnect);
  };

  const handleSocketReconnect = () => {
    const { sessionId } = stateRef.current;
    if (!sessionId) return;
    console.log('Signaling socket reconnected. Syncing state...');
    socket.emit('join-room', {
      sessionId,
      userId: user.id,
      role: user.role,
      name: user.name
    }, (response) => {
      console.log('Room resynced on socket reconnection.');
    });
  };

  // 3. WebRTC Mediasoup Setup
  const setupMediasoupDevice = async (routerRtpCapabilities) => {
    try {
      const device = new Device();
      await device.load({ routerRtpCapabilities });
      stateRef.current.device = device;
      console.log('mediasoup client Device loaded successfully.');
    } catch (err) {
      console.error('Failed to load mediasoup Device:', err);
      addToast('WebRTC Media Device capability mismatch', 'danger');
    }
  };

  const startCameraStream = async () => {
    // Progressive constraint fallback for mobile compatibility
    const constraintSets = [
      // Best quality
      { audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: 30 } } },
      // Simpler constraints (some Android browsers need this)
      { audio: true, video: true },
      // Audio only (if camera is in use or blocked)
      { audio: true, video: false },
    ];

    let stream = null;
    let lastError = null;

    for (const constraints of constraintSets) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        break; // success
      } catch (err) {
        lastError = err;
        console.warn('getUserMedia failed with constraints:', constraints, err.name);
      }
    }

    if (!stream) {
      // Give specific guidance based on the error type
      if (lastError?.name === 'NotAllowedError' || lastError?.name === 'PermissionDeniedError') {
        addToast(
          '📷 Camera blocked — tap the camera icon in your browser address bar and select "Allow", then refresh.',
          'danger'
        );
      } else if (lastError?.name === 'NotFoundError') {
        addToast('No camera/microphone found on this device.', 'danger');
      } else if (lastError?.name === 'NotReadableError') {
        addToast('Camera is in use by another app. Close it and refresh.', 'danger');
      } else {
        addToast('Could not access camera/microphone: ' + (lastError?.message || 'unknown error'), 'danger');
      }
      // Still set up transports so the user can at least receive video/audio
      await createSendTransport();
      await createRecvTransport();
      return;
    }

    stateRef.current.localStream = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }

    // Construct Send & Recv Transports
    await createSendTransport();
    await createRecvTransport();
  };


  const createSendTransport = async () => {
    const { sessionId, device } = stateRef.current;
    if (!device) return;

    socket.emit('create-transport', { sessionId, userId: user.id, direction: 'send' }, async (params) => {
      if (params.error) {
        addToast('Failed to create send transport: ' + params.error, 'danger');
        return;
      }

      // Create transport with TURN/STUN servers for cross-network support
      const sendTransport = device.createSendTransport({
        ...params,
        iceServers: params.iceServers || [],
      });
      stateRef.current.sendTransport = sendTransport;

      sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        socket.emit('connect-transport', {
          sessionId,
          userId: user.id,
          transportId: sendTransport.id,
          dtlsParameters
        }, (response) => {
          if (response.error) errback(response.error);
          else callback();
        });
      });

      sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        socket.emit('produce', {
          sessionId,
          userId: user.id,
          transportId: sendTransport.id,
          kind,
          rtpParameters,
          appData
        }, (response) => {
          if (response.error) errback(response.error);
          else callback({ id: response.id });
        });
      });

      // Produce Audio Track (only if camera/mic was granted)
      const localStream = stateRef.current.localStream;
      if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.enabled = stateRef.current.audioEnabled;
          const audioProducer = await sendTransport.produce({ track: audioTrack });
          stateRef.current.audioProducer = audioProducer;
          if (!stateRef.current.audioEnabled) await audioProducer.pause();
        }

        // Produce Video Track
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.enabled = stateRef.current.videoEnabled;
          const videoProducer = await sendTransport.produce({ track: videoTrack });
          stateRef.current.videoProducer = videoProducer;
          if (!stateRef.current.videoEnabled) await videoProducer.pause();
        }
      }

      console.log('Sending transport connected, tracks published.');
    });
  };

  const createRecvTransport = async () => {
    const { sessionId, device } = stateRef.current;
    if (!device) return;

    socket.emit('create-transport', { sessionId, userId: user.id, direction: 'recv' }, async (params) => {
      if (params.error) {
        addToast('Failed to create receive transport: ' + params.error, 'danger');
        return;
      }

      // Create transport with TURN/STUN servers for cross-network support
      const recvTransport = device.createRecvTransport({
        ...params,
        iceServers: params.iceServers || [],
      });
      stateRef.current.recvTransport = recvTransport;

      recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        socket.emit('connect-transport', {
          sessionId,
          userId: user.id,
          transportId: recvTransport.id,
          dtlsParameters
        }, (response) => {
          if (response.error) errback(response.error);
          else callback();
        });
      });

      console.log('Receiving transport configured.');
    });
  };

  // 4. Consume Remote Producers
  const consumeRemoteTrack = async (producerId, peerId, peerName = 'Guest', peerRole = 'customer', retries = 0) => {
    const { recvTransport, device } = stateRef.current;
    if (!recvTransport || !device) {
      // Retry up to 10 times if transport not ready yet (race condition on join)
      if (retries < 10) {
        setTimeout(() => consumeRemoteTrack(producerId, peerId, peerName, peerRole, retries + 1), 500);
      }
      return;
    }

    socket.emit('consume', {
      sessionId: stateRef.current.sessionId,
      userId: user.id,
      transportId: recvTransport.id,
      producerId,
      rtpCapabilities: device.rtpCapabilities
    }, async (params) => {
      if (params.error) {
        console.warn('Could not consume track:', params.error);
        return;
      }

      const consumer = await recvTransport.consume(params);
      stateRef.current.consumers.set(consumer.id, consumer);

      // Track which peer this consumer belongs to
      if (peerId) {
        stateRef.current.consumerPeerMap.set(consumer.id, peerId);
        if (!stateRef.current.peerConsumers.has(peerId)) {
          stateRef.current.peerConsumers.set(peerId, new Set());
        }
        stateRef.current.peerConsumers.get(peerId).add(consumer.id);
      }

      socket.emit('resume-consumer', {
        sessionId: stateRef.current.sessionId,
        userId: user.id,
        consumerId: consumer.id
      }, () => {
        console.log(`Consumer resumed: ${consumer.id} for peer ${peerId}`);
        const { track } = consumer;

        if (peerId) {
          // Get or create a MediaStream for this peer
          let stream = peerStreams.current[peerId];
          if (!stream) {
            stream = new MediaStream();
            peerStreams.current[peerId] = stream;
          }
          stream.addTrack(track);

          // Attach stream to the peer's video element if it exists already
          const videoEl = peerVideoRefs.current[peerId];
          if (videoEl) {
            videoEl.srcObject = stream;
            videoEl.play().catch(() => {});
          }

          // Add or update peer in state — mark as connected (track arrived)
          setRemotePeers(prev => ({
            ...prev,
            [peerId]: {
              name: prev[peerId]?.name ?? peerName,
              role: prev[peerId]?.role ?? peerRole,
              videoOff: prev[peerId]?.videoOff ?? false,
              audioOff: prev[peerId]?.audioOff ?? false,
              connecting: false,
              connected: true,
            }
          }));
        }
      });
    });
  };

  // Handle new producer from a remote peer
  const handleNewProducer = async ({ producerId, peerId, peerName = 'Guest', peerRole = 'customer' }) => {
    console.log(`New producer discovered: ${producerId} from peer ${peerId} (${peerName})`);
    await consumeRemoteTrack(producerId, peerId, peerName, peerRole);
  };

  const handleConsumerClosed = ({ consumerId }) => {
    console.log(`Consumer closed: ${consumerId}`);
    const consumer = stateRef.current.consumers.get(consumerId);
    if (consumer) {
      const peerId = stateRef.current.consumerPeerMap.get(consumerId);
      consumer.close();
      stateRef.current.consumers.delete(consumerId);
      stateRef.current.consumerPeerMap.delete(consumerId);
      if (peerId) {
        stateRef.current.peerConsumers.get(peerId)?.delete(consumerId);
      }
    }
  };

  // Presence Events
  const handleUserJoined = ({ userId, name, role }) => {
    addToast(`${name} joined the call`, 'success');
    setRemotePeers(prev => ({
      ...prev,
      [userId]: { name, role, videoOff: false, audioOff: false, connecting: true }
    }));
  };

  const handleUserLeft = ({ userId, name, role }) => {
    addToast(`${name || 'Someone'} left the call`, 'warning');
    // Close and clean up all consumers for this peer
    const peerConsumerSet = stateRef.current.peerConsumers.get(userId);
    if (peerConsumerSet) {
      for (const cid of peerConsumerSet) {
        const c = stateRef.current.consumers.get(cid);
        if (c) { c.close(); stateRef.current.consumers.delete(cid); }
        stateRef.current.consumerPeerMap.delete(cid);
      }
      stateRef.current.peerConsumers.delete(userId);
    }
    // Stop tracks in peer's stream
    const stream = peerStreams.current[userId];
    if (stream) stream.getTracks().forEach(t => t.stop());
    delete peerStreams.current[userId];
    delete peerVideoRefs.current[userId];
    // Remove from UI state
    setRemotePeers(prev => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  };

  // 5. Media Controls (Camera, Mic, Screen Share)
  const handleToggleAudio = () => {
    const { localStream, audioProducer } = stateRef.current;
    // Use ref value to avoid stale closure on rapid clicks
    const nextState = !stateRef.current.audioEnabled;
    stateRef.current.audioEnabled = nextState;
    setAudioEnabled(nextState);

    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      if (track) track.enabled = nextState;
    }

    if (audioProducer) {
      if (nextState) audioProducer.resume();
      else audioProducer.pause();
    }

    addToast(nextState ? 'Microphone unmuted' : 'Microphone muted', nextState ? 'success' : 'info');
  };

  const handleToggleVideo = async () => {
    const { localStream, videoProducer } = stateRef.current;
    // Use ref value to avoid stale closure on rapid clicks
    const nextState = !stateRef.current.videoEnabled;
    stateRef.current.videoEnabled = nextState;
    setVideoEnabled(nextState);

    // Broadcast camera state to remote peer immediately via socket (reliable)
    if (socket && stateRef.current.sessionId) {
      socket.emit('video-state-changed', {
        sessionId: stateRef.current.sessionId,
        userId: user.id,
        enabled: nextState
      });
    }

    if (!nextState) {
      // Disable camera & stop hardware feed (privacy offlight compliance)
      if (localStream) {
        const track = localStream.getVideoTracks()[0];
        if (track) {
          track.enabled = false;
          track.stop();
        }
      }
      // Clear the srcObject so the frozen last-frame is removed
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      if (videoProducer) {
        videoProducer.pause();
      }
      addToast('Camera feed disabled', 'info');
    } else {
      // Camera Re-enable: request new video track from OS
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { max: 30 }
          }
        });
        const newTrack = tempStream.getVideoTracks()[0];

        if (localStream) {
          const oldTrack = localStream.getVideoTracks()[0];
          if (oldTrack) localStream.removeTrack(oldTrack);
          localStream.addTrack(newTrack);
        }

        // Restore the srcObject with the live stream
        if (!screenSharing && localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }

        if (videoProducer) {
          await videoProducer.replaceTrack({ track: newTrack });
          videoProducer.resume();
        }
        addToast('Camera feed enabled', 'success');
      } catch (err) {
        console.error('Failed to start camera hardware:', err);
        addToast('Failed to access camera device', 'danger');
        // Revert ref state on failure
        stateRef.current.videoEnabled = true;
        setVideoEnabled(true);
      }
    }
  };

  const handleToggleScreenShare = async () => {
    const { localStream, videoProducer } = stateRef.current;
    if (!videoProducer) return;

    if (!screenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        stateRef.current.screenStream = screenStream;
        const track = screenStream.getVideoTracks()[0];

        await videoProducer.replaceTrack({ track });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        setScreenSharing(true);
        addToast('Screen sharing started', 'success');

        track.onended = () => {
          stopScreenSharing();
        };
      } catch (err) {
        console.warn('Screen share canceled:', err);
        addToast('Screen sharing failed or cancelled', 'warning');
      }
    } else {
      stopScreenSharing();
    }
  };

  const stopScreenSharing = async () => {
    const { localStream, screenStream, videoProducer } = stateRef.current;
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      stateRef.current.screenStream = null;
    }

    const cameraTrack = localStream.getVideoTracks()[0];
    if (cameraTrack && videoProducer) {
      await videoProducer.replaceTrack({ track: cameraTrack });
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
    setScreenSharing(false);
    addToast('Screen sharing stopped', 'info');
  };

  // 6. Audio/Video Session Recording (Agent Only)
  const handleToggleRecording = () => {
    if (user.role !== 'agent') return;
    if (!isRecording) {
      startRecordingFlow();
    } else {
      stopRecordingFlow();
    }
  };

  const startRecordingFlow = () => {
    stateRef.current.recordedChunks = [];
    const streamToRecord = new MediaStream();

    // Attach remote stream tracks
    if (remoteVideoRef.current && remoteVideoRef.current.srcObject) {
      const rStream = remoteVideoRef.current.srcObject;
      rStream.getVideoTracks().forEach((t) => streamToRecord.addTrack(t));
      rStream.getAudioTracks().forEach((t) => streamToRecord.addTrack(t));
    }

    // Attach local agent audio
    const { localStream } = stateRef.current;
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => streamToRecord.addTrack(t));
    }

    if (streamToRecord.getTracks().length === 0) {
      addToast('No media tracks available to record', 'warning');
      return;
    }

    try {
      const mediaRecorder = new MediaRecorder(streamToRecord, { mimeType: 'video/webm' });
      stateRef.current.mediaRecorder = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          stateRef.current.recordedChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const { sessionId, recordedChunks } = stateRef.current;
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const file = new File([blob], `recording-${sessionId}.webm`, { type: 'video/webm' });

        const formData = new FormData();
        formData.append('file', file);
        formData.append('sessionId', sessionId);

        addToast('Uploading session recording...', 'info');
        try {
          const res = await fetch('/api/upload', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: formData
          });

          const data = await res.json();
          if (res.ok) {
            addToast('Recording processed and shared in chat!', 'success');
            socket.emit('send-message', {
              sessionId,
              senderId: user.id,
              senderName: 'System',
              senderRole: 'system',
              content: `Support session recording is ready. Download here.`,
              type: 'file',
              fileUrl: data.url
            });
          } else {
            addToast('Failed to save recording: ' + data.error, 'danger');
          }
        } catch (err) {
          console.error('Upload recording error:', err);
          addToast('Error uploading recording to server', 'danger');
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingPulse(true);
      addToast('Call recording started', 'success');
    } catch (err) {
      console.error('Failed to start MediaRecorder:', err);
      addToast('Recording format VP8/WebM not supported on this browser', 'danger');
    }
  };

  const stopRecordingFlow = () => {
    const { mediaRecorder } = stateRef.current;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    setIsRecording(false);
    setRecordingPulse(false);
    addToast('Recording stopped, processing file...', 'info');
  };

  // 7. In-Call Chat Messages
  const loadChatHistory = async (sessId) => {
    try {
      const list = await apiFetch(`/api/sessions/${sessId}/messages`);
      setMessages(list);
    } catch (err) {
      console.warn('Could not load chat history:', err);
    }
  };

  const handleReceiveMessage = (msg) => {
    setMessages((prev) => [...prev, msg]);
  };

  const handleSendChatMessage = (e) => {
    e.preventDefault();
    const content = chatInput.trim();
    if (!content || !socket) return;

    socket.emit('send-message', {
      sessionId: stateRef.current.sessionId,
      senderId: user.id,
      senderName: user.name,
      senderRole: user.role,
      content,
      type: 'text'
    });

    setChatInput('');
  };

  // Upload attachment
  const triggerFileUpload = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const { sessionId } = stateRef.current;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('sessionId', sessionId);

    addToast(`Uploading ${file.name}...`, 'info');

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      const data = await response.json();
      if (response.ok) {
        addToast('File uploaded successfully!', 'success');
        socket.emit('send-message', {
          sessionId,
          senderId: user.id,
          senderName: user.name,
          senderRole: user.role,
          content: `Shared file: ${data.filename}`,
          type: 'file',
          fileUrl: data.url
        });
      } else {
        addToast('Upload failed: ' + data.error, 'danger');
      }
    } catch (err) {
      addToast('Failed to upload file', 'danger');
    }

    e.target.value = '';
  };

  // 8. Hangup / Disconnect Actions
  const handleHangUp = async () => {
    const { sessionId } = stateRef.current;

    if (user.role === 'agent') {
      const confirmEnd = window.confirm('Are you sure you want to end this support session for all participants?');
      if (!confirmEnd) return;

      try {
        await apiFetch(`/api/sessions/${sessionId}/end`, { method: 'POST' });
        addToast('Support session ended.', 'info');
      } catch (err) {
        console.warn('Failed to end session:', err);
      }
    }

    cleanupCall();
    navigate('/dashboard');
  };

  const cleanupCall = () => {
    const { sessionId, localStream, screenStream, sendTransport, recvTransport } = stateRef.current;

    if (socket) {
      socket.emit('leave-room', {
        sessionId,
        userId: user.id,
        role: user.role,
        name: user.name
      });
      // Remove listeners so they don't fire after component unmounts
      socket.off('new-producer');
      socket.off('consumer-closed');
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('message');
      socket.off('remote-video-state');
    }

    // Stop streams
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
    }

    // Stop all peer streams
    for (const stream of Object.values(peerStreams.current)) {
      stream.getTracks().forEach(t => t.stop());
    }
    peerStreams.current = {};
    peerVideoRefs.current = {};

    // Close transports
    if (sendTransport) sendTransport.close();
    if (recvTransport) recvTransport.close();

    setRoomConnected(false);
    setRemotePeers({});
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Navbar header */}
      <nav className="navbar" style={{ padding: '0.75rem 2rem' }}>
        <div className="nav-brand">
          <i className="fa-solid fa-video"></i> AtomQuest Call
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          {recordingPulse && (
            <div className="recording-pulse" id="recording-indicator">
              <span className="recording-dot"></span>
              <span>Recording</span>
            </div>
          )}
          <span className="badge badge-active" style={{ background: roomConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)' }}>
            {roomConnected ? 'Connected' : 'Connecting...'}
          </span>
          <div style={{ fontFamily: 'monospace', fontWeight: 600, color: 'white', fontSize: '1.1rem' }}>
            Time: <span id="timer-display">{formatDuration(callDuration)}</span>
          </div>
          <button className="btn btn-secondary" style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }} onClick={handleHangUp}>
            Exit Call
          </button>
        </div>
      </nav>

      {/* Main room view layout */}
      <div className="call-container">
        <div className="main-call-area">
          <div className="video-grid">
            {/* Local Pip self preview */}
            <div className="local-video-pip">
              <video
                ref={localVideoRef}
                id="local-video"
                autoPlay
                playsInline
                muted
                style={{ display: videoEnabled ? 'block' : 'none' }}
              />
              {/* Camera-off placeholder shown instead of frozen last frame */}
              {!videoEnabled && (
                <div style={{
                  width: '100%',
                  height: '100%',
                  background: 'rgba(10, 10, 20, 0.95)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  borderRadius: 'inherit'
                }}>
                  <i className="fa-solid fa-video-slash" style={{ fontSize: '1.6rem', color: 'rgba(255,255,255,0.35)' }}></i>
                  <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>Camera off</span>
                </div>
              )}
              <div className="video-overlay-info">
                <i className="fa-solid fa-circle-user"></i> You ({user.name.split(' ')[0]})
              </div>
            </div>

            {/* Remote Participants Grid */}
            {(() => {
              const peerEntries = Object.entries(remotePeers);
              const count = peerEntries.length;
              const gridCols = count === 0 ? '1fr'
                : count === 1 ? '1fr'
                : count <= 4 ? '1fr 1fr'
                : '1fr 1fr 1fr';

              return (
                <div style={{
                  flex: 1,
                  display: 'grid',
                  gridTemplateColumns: gridCols,
                  gap: '8px',
                  overflow: 'hidden',
                  position: 'relative',
                  minHeight: 0,
                }}>
                  {count === 0 && (
                    <div className="video-placeholder" id="remote-video-placeholder">
                      <i className="fa-solid fa-spinner fa-spin"></i>
                      <h3 style={{ color: 'var(--text-muted)' }}>Waiting for participants...</h3>
                      <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', maxWidth: '280px' }}>
                        Share the invite link to start the session.
                      </p>
                    </div>
                  )}

                  {peerEntries.map(([peerId, peer]) => (
                    <div
                      key={peerId}
                      onClick={() => {
                        // Click-to-play fallback when autoplay is blocked
                        const videoEl = peerVideoRefs.current[peerId];
                        if (videoEl && videoEl.paused) {
                          videoEl.play().catch(() => {});
                        }
                      }}
                      style={{
                        position: 'relative',
                        background: '#0a0814',
                        borderRadius: '12px',
                        overflow: 'hidden',
                        border: '1px solid rgba(255,255,255,0.07)',
                        minHeight: '180px',
                        cursor: 'pointer',
                      }}
                    >
                      {/* Live video */}
                      <video
                        ref={(el) => {
                          if (el) {
                            peerVideoRefs.current[peerId] = el;
                            const stream = peerStreams.current[peerId];
                            if (stream && el.srcObject !== stream) {
                              el.srcObject = stream;
                            }
                          }
                        }}
                        autoPlay
                        playsInline
                        onLoadedMetadata={(e) => {
                          // Trigger play when metadata is ready (handles delayed stream attach)
                          e.target.play().catch(() => {});
                        }}
                        onCanPlay={(e) => {
                          e.target.play().catch(() => {});
                        }}
                        style={{
                          display: peer.videoOff ? 'none' : 'block',
                          width: '100%', height: '100%',
                          objectFit: 'cover',
                          position: 'absolute', inset: 0,
                          background: '#000',
                        }}
                      />

                      {/* Connecting overlay — shown while ICE is negotiating */}
                      {peer.connecting && !peer.videoOff && (
                        <div style={{
                          position: 'absolute', inset: 0,
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center',
                          background: 'rgba(10, 8, 20, 0.92)', gap: '0.75rem',
                          zIndex: 2,
                        }}>
                          <div style={{
                            width: '72px', height: '72px', borderRadius: '50%',
                            background: 'linear-gradient(135deg, #4338ca, #7c3aed)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '1.8rem', fontWeight: 700, color: 'white',
                            boxShadow: '0 0 24px rgba(124,58,237,0.5)',
                            animation: 'pulse 2s infinite',
                          }}>
                            {(peer.name || 'G').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <p style={{ color: 'white', fontWeight: 600, fontSize: '1rem', margin: 0 }}>{peer.name}</p>
                            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.72rem', marginTop: '0.3rem' }}>
                              <i className="fa-solid fa-circle-notch fa-spin" style={{ marginRight: '0.35rem' }}></i>
                              Connecting video...
                            </p>
                            <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.65rem', marginTop: '0.3rem', maxWidth: '180px' }}>
                              If this takes too long, both devices should use the same WiFi
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Camera-off avatar */}
                      {peer.videoOff && (
                        <div style={{
                          position: 'absolute', inset: 0,
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center',
                          background: 'rgba(10, 8, 20, 0.97)', gap: '0.75rem',
                        }}>
                          <div style={{
                            width: '72px', height: '72px', borderRadius: '50%',
                            background: 'linear-gradient(135deg, var(--accent), #a855f7)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '1.8rem', fontWeight: 700, color: 'white',
                            boxShadow: '0 0 24px rgba(124,58,237,0.4)',
                          }}>
                            {(peer.name || 'G').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <p style={{ color: 'white', fontWeight: 600, fontSize: '1rem', margin: 0 }}>{peer.name}</p>
                            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                              <i className="fa-solid fa-video-slash" style={{ marginRight: '0.3rem' }}></i>Camera off
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Name tag — only when video is live */}
                      {!peer.videoOff && !peer.connecting && (
                        <div className="video-overlay-info">
                          <i className="fa-solid fa-circle-user"></i> {peer.name}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Bottom Toolbar Controls */}
          <div className="call-toolbar">
            <button
              className={`tool-btn ${audioEnabled ? 'active' : ''}`}
              onClick={handleToggleAudio}
              title={audioEnabled ? 'Mute Mic' : 'Unmute Mic'}
            >
              <i className={`fa-solid ${audioEnabled ? 'fa-microphone' : 'fa-microphone-slash'}`}></i>
            </button>
            <button
              className={`tool-btn ${videoEnabled ? 'active' : ''}`}
              onClick={handleToggleVideo}
              title={videoEnabled ? 'Disable Camera' : 'Enable Camera'}
            >
              <i className={`fa-solid ${videoEnabled ? 'fa-video' : 'fa-video-slash'}`}></i>
            </button>
            <button
              className={`tool-btn ${screenSharing ? 'active' : ''}`}
              onClick={handleToggleScreenShare}
              title="Share Screen"
            >
              <i className="fa-solid fa-desktop"></i>
            </button>
            
            {user.role === 'agent' && (
              <button
                className={`tool-btn ${isRecording ? 'active' : ''}`}
                onClick={handleToggleRecording}
                title="Record Session"
                style={{ background: isRecording ? 'var(--danger)' : '' }}
              >
                <i className="fa-solid fa-circle"></i>
              </button>
            )}

            <button
              className="tool-btn"
              onClick={() => setChatOpen(!chatOpen)}
              title="Toggle Chat"
            >
              <i className="fa-solid fa-comments"></i>
            </button>
            <button
              className="tool-btn danger"
              onClick={handleHangUp}
              title="Hang Up"
            >
              <i className="fa-solid fa-phone-slash"></i>
            </button>
          </div>
        </div>

        {/* Collapsible Chat sidebar */}
        {chatOpen && (
          <div className="chat-panel" id="chat-sidebar">
            <div className="chat-header">
              <span style={{ color: 'white' }}>Live Session Chat</span>
              <button
                className="tool-btn"
                style={{ width: '32px', height: '32px', fontSize: '0.85rem' }}
                onClick={() => setChatOpen(false)}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="chat-messages" id="chat-messages-container">
              {messages.map((msg, index) => {
                const isSent = msg.sender_id === user.id;
                let formattedTime = 'Just now';
                if (msg.created_at) {
                  const d = new Date(msg.created_at);
                  formattedTime = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }

                return (
                  <div key={msg.id || index} className={`message-bubble ${isSent ? 'sent' : 'received'}`}>
                    <div
                      className="message-sender"
                      style={{ color: isSent ? '#e9d5ff' : 'var(--text-muted)' }}
                    >
                      {msg.sender_name} ({msg.sender_role})
                    </div>
                    {msg.type === 'file' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <i className="fa-solid fa-file-arrow-down" style={{ fontSize: '1.5rem' }}></i>
                        <div>
                          <a
                            href={msg.file_url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}
                          >
                            {msg.content}
                          </a>
                        </div>
                      </div>
                    ) : (
                      <p>{msg.content}</p>
                    )}
                    <div className="message-time">{formattedTime}</div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            <div className="chat-input-area">
              <form className="chat-form" onSubmit={handleSendChatMessage}>
                <button
                  type="button"
                  className="file-share-btn"
                  onClick={triggerFileUpload}
                  title="Upload file"
                >
                  <i className="fa-solid fa-paperclip"></i>
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
                <input
                  type="text"
                  className="chat-input"
                  placeholder="Type a message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" style={{ padding: '0.5rem 1rem' }}>
                  <i className="fa-solid fa-paper-plane"></i>
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
