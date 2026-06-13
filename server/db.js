const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.resolve(__dirname, process.env.DB_PATH || '../data.db');
const db = new DatabaseSync(dbPath);

// Initialize database schema
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL, -- 'agent', 'admin', 'customer'
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL, -- 'waiting', 'active', 'ended'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      FOREIGN KEY(agent_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS session_participants (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      left_at DATETIME,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      content TEXT,
      type TEXT NOT NULL, -- 'text', 'file'
      file_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS session_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL, -- 'join', 'leave', 'mute', 'camera_toggle', 'record_start', 'record_stop'
      user_id TEXT NOT NULL,
      metadata TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT NOT NULL, -- 'processing', 'ready'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
  `);

  // Seed default users if users table is empty
  const rowCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (rowCount.count === 0) {
    console.log('Seeding database with default users...');
    const seedUsers = [
      {
        email: 'agent@demo.com',
        password: 'agent123',
        role: 'agent',
        name: 'Support Agent Jane'
      },
      {
        email: 'admin@demo.com',
        password: 'admin123',
        role: 'admin',
        name: 'System Administrator'
      },
      {
        email: 'customer@demo.com',
        password: 'customer123',
        role: 'customer',
        name: 'Customer John Doe'
      }
    ];

    const insertUser = db.prepare(`
      INSERT INTO users (id, email, password_hash, role, name)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const user of seedUsers) {
      const hash = bcrypt.hashSync(user.password, 10);
      insertUser.run(uuidv4(), user.email, hash, user.role, user.name);
    }
    console.log('Database seeded successfully.');
  }
}

// User helper methods
const users = {
  getById: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
  getByEmail: (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email),
  create: (email, password, role, name) => {
    const id = uuidv4();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)')
      .run(id, email, hash, role, name);
    return { id, email, role, name };
  }
};

// Session helper methods
const sessions = {
  create: (agentId) => {
    const id = uuidv4();
    const token = uuidv4().substring(0, 8); // short shareable invite code
    db.prepare('INSERT INTO sessions (id, token, agent_id, status) VALUES (?, ?, ?, ?)')
      .run(id, token, agentId, 'waiting');
    return { id, token, agent_id: agentId, status: 'waiting' };
  },
  getById: (id) => db.prepare('SELECT * FROM sessions WHERE id = ?').get(id),
  getByToken: (token) => db.prepare('SELECT * FROM sessions WHERE token = ?').get(token),
  listByAgent: (agentId) => db.prepare(`
    SELECT s.*, 
           (SELECT COUNT(DISTINCT user_id) FROM session_participants WHERE session_id = s.id) as participant_count
    FROM sessions s 
    WHERE s.agent_id = ? 
    ORDER BY s.created_at DESC
  `).all(agentId),
  listAll: () => db.prepare(`
    SELECT s.*, u.name as agent_name,
           (SELECT COUNT(DISTINCT user_id) FROM session_participants WHERE session_id = s.id) as participant_count
    FROM sessions s
    LEFT JOIN users u ON s.agent_id = u.id
    ORDER BY s.created_at DESC
  `).all(),
  updateStatus: (id, status) => {
    const endedAt = status === 'ended' ? new Date().toISOString() : null;
    if (endedAt) {
      db.prepare('UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?').run(status, endedAt, id);
    } else {
      db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, id);
    }
  },
  getLiveSessions: () => db.prepare(`
    SELECT s.*, u.name as agent_name,
           (SELECT group_concat(name || ' (' || role || ')') FROM session_participants WHERE session_id = s.id AND left_at IS NULL) as current_participants
    FROM sessions s
    LEFT JOIN users u ON s.agent_id = u.id
    WHERE s.status = 'active' OR s.status = 'waiting'
    ORDER BY s.created_at DESC
  `).all()
};

// Participant helper methods
const participants = {
  add: (sessionId, userId, role, name) => {
    const id = uuidv4();
    // Mark any active previous participant entry for this user as left just in case
    db.prepare('UPDATE session_participants SET left_at = CURRENT_TIMESTAMP WHERE session_id = ? AND user_id = ? AND left_at IS NULL')
      .run(sessionId, userId);

    db.prepare('INSERT INTO session_participants (id, session_id, user_id, role, name) VALUES (?, ?, ?, ?, ?)')
      .run(id, sessionId, userId, role, name);
    return id;
  },
  markLeft: (sessionId, userId) => {
    db.prepare('UPDATE session_participants SET left_at = CURRENT_TIMESTAMP WHERE session_id = ? AND user_id = ? AND left_at IS NULL')
      .run(sessionId, userId);
  },
  getActiveInSession: (sessionId) => db.prepare('SELECT * FROM session_participants WHERE session_id = ? AND left_at IS NULL').all(sessionId)
};

// Message helper methods
const messages = {
  create: (sessionId, senderId, senderName, senderRole, content, type = 'text', fileUrl = null) => {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO messages (id, session_id, sender_id, sender_name, sender_role, content, type, file_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, senderId, senderName, senderRole, content, type, fileUrl);
    return { id, session_id: sessionId, sender_id: senderId, sender_name: senderName, sender_role: senderRole, content, type, file_url: fileUrl, created_at: new Date().toISOString() };
  },
  getBySession: (sessionId) => db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId)
};

// Event log helper methods
const events = {
  log: (sessionId, eventType, userId, metadata = null) => {
    db.prepare('INSERT INTO session_events (session_id, event_type, user_id, metadata) VALUES (?, ?, ?, ?)')
      .run(sessionId, eventType, userId, metadata ? JSON.stringify(metadata) : null);
  },
  getBySession: (sessionId) => db.prepare('SELECT * FROM session_events WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId)
};

// Recording helper methods
const recordings = {
  create: (sessionId, filePath) => {
    const id = uuidv4();
    db.prepare('INSERT INTO recordings (id, session_id, file_path, status) VALUES (?, ?, ?, ?)')
      .run(id, sessionId, filePath, 'ready');
    return id;
  },
  getBySession: (sessionId) => db.prepare('SELECT * FROM recordings WHERE session_id = ?').all(sessionId)
};

// Initialize DB on script load
initDb();

module.exports = {
  db,
  users,
  sessions,
  participants,
  messages,
  events,
  recordings
};
