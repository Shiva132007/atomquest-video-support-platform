const express = require('express');
const db = require('./db');
const { authMiddleware, requireRole } = require('./auth');
const media = require('./media');

const router = express.Router();

// Enforce admin-only for all routes in this file
router.use(authMiddleware, requireRole('admin'));

// Route: Get Live Sessions
router.get('/live-sessions', (req, res) => {
  try {
    const live = db.sessions.getLiveSessions();
    return res.json(live);
  } catch (err) {
    console.error('Get live sessions error:', err);
    return res.status(500).json({ error: 'Failed to retrieve live sessions' });
  }
});

// Route: Get Session History
router.get('/session-history', (req, res) => {
  try {
    const all = db.sessions.listAll();
    return res.json(all);
  } catch (err) {
    console.error('Get session history error:', err);
    return res.status(500).json({ error: 'Failed to retrieve session history' });
  }
});

// Route: Force End Active Session
router.post('/sessions/:id/end', (req, res) => {
  try {
    const { id } = req.params;
    const session = db.sessions.getById(id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    db.sessions.updateStatus(id, 'ended');
    db.events.log(id, 'session_ended_by_admin', req.user.id, { admin_name: req.user.name });

    // Clean up mediasoup structures
    media.closeRoom(id);

    return res.json({ message: 'Session terminated by administrator' });
  } catch (err) {
    console.error('Force end session error:', err);
    return res.status(500).json({ error: 'Failed to force-end session' });
  }
});

// Route: Get Metrics (Observability)
router.get('/metrics', (req, res) => {
  try {
    const activeSessionsCount = db.db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active' OR status = 'waiting'").get().count;
    const totalSessionsCount = db.db.prepare("SELECT COUNT(*) as count FROM sessions").get().count;
    const totalUsersCount = db.db.prepare("SELECT COUNT(*) as count FROM users").get().count;
    const activeParticipantsCount = db.db.prepare("SELECT COUNT(*) as count FROM session_participants WHERE left_at IS NULL").get().count;

    // Retrieve memory & process stats for dashboard observability
    const memoryUsage = process.memoryUsage();
    
    return res.json({
      activeSessions: activeSessionsCount,
      totalSessions: totalSessionsCount,
      totalUsers: totalUsersCount,
      activeParticipants: activeParticipantsCount,
      system: {
        uptime: Math.round(process.uptime()),
        memoryUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        cpuCores: require('os').cpus().length,
        platform: process.platform,
        nodeVersion: process.version
      }
    });
  } catch (err) {
    console.error('Get metrics error:', err);
    return res.status(500).json({ error: 'Failed to retrieve metrics' });
  }
});

module.exports = router;
