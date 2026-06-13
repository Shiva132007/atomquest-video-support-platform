const express = require('express');
const db = require('./db');
const { authMiddleware, requireRole } = require('./auth');

const router = express.Router();

// Route: Create Session (Agent only)
router.post('/', authMiddleware, requireRole('agent'), (req, res) => {
  try {
    const session = db.sessions.create(req.user.id);
    db.events.log(session.id, 'session_created', req.user.id, { agent_name: req.user.name });
    return res.status(201).json(session);
  } catch (err) {
    console.error('Create session error:', err);
    return res.status(500).json({ error: 'Failed to create session' });
  }
});

// Route: List Sessions (Agents and Admins)
router.get('/', authMiddleware, requireRole('agent', 'admin'), (req, res) => {
  try {
    let list;
    if (req.user.role === 'admin') {
      list = db.sessions.listAll();
    } else {
      list = db.sessions.listByAgent(req.user.id);
    }
    return res.json(list);
  } catch (err) {
    console.error('List sessions error:', err);
    return res.status(500).json({ error: 'Failed to retrieve sessions' });
  }
});

// Route: Get Session details by ID
router.get('/:id', authMiddleware, (req, res) => {
  try {
    const session = db.sessions.getById(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    return res.json(session);
  } catch (err) {
    console.error('Get session error:', err);
    return res.status(500).json({ error: 'Failed to retrieve session details' });
  }
});

// Route: Get Session details by Invite Token (no authentication header required, used by customers when joining via link)
router.get('/by-token/:token', (req, res) => {
  try {
    const session = db.sessions.getByToken(req.params.token);
    if (!session) {
      return res.status(404).json({ error: 'Invalid invite link or session not found' });
    }
    if (session.status === 'ended') {
      return res.status(400).json({ error: 'This session has already ended' });
    }
    return res.json(session);
  } catch (err) {
    console.error('Get session by token error:', err);
    return res.status(500).json({ error: 'Failed to retrieve session details' });
  }
});

// Route: End Session (Agent or Admin)
router.post('/:id/end', authMiddleware, requireRole('agent', 'admin'), (req, res) => {
  try {
    const { id } = req.params;
    const session = db.sessions.getById(id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status === 'ended') {
      return res.status(400).json({ error: 'Session already ended' });
    }

    db.sessions.updateStatus(id, 'ended');
    db.events.log(id, 'session_ended', req.user.id, { ended_by: req.user.name, role: req.user.role });
    
    // Close the mediasoup router for this session (media.js should hook into this, or we let signaling handle it when connections close)
    // We will clean up any active room in media.js directly from signaling/rooms.

    return res.json({ message: 'Session ended successfully' });
  } catch (err) {
    console.error('End session error:', err);
    return res.status(500).json({ error: 'Failed to end session' });
  }
});

// Route: Get Chat History
router.get('/:id/messages', authMiddleware, (req, res) => {
  try {
    const history = db.messages.getBySession(req.params.id);
    return res.json(history);
  } catch (err) {
    console.error('Get messages error:', err);
    return res.status(500).json({ error: 'Failed to retrieve messages' });
  }
});

// Route: Get Event Logs
router.get('/:id/events', authMiddleware, requireRole('agent', 'admin'), (req, res) => {
  try {
    const logs = db.events.getBySession(req.params.id);
    return res.json(logs);
  } catch (err) {
    console.error('Get events error:', err);
    return res.status(500).json({ error: 'Failed to retrieve event logs' });
  }
});

module.exports = router;
