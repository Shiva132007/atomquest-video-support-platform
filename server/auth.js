const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('./config');

const router = express.Router();

// JWT helper
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    config.jwtSecret,
    { expiresIn: '24h' }
  );
}

// Middleware: Verify JWT
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required or invalid format' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Middleware: Role Enforcer
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden: Requires one of [${roles.join(', ')}] role` });
    }
    next();
  };
}

// Route: User Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = db.users.getByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const passwordMatch = bcrypt.compareSync(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user);
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Route: User Registration
router.post('/register', (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: 'Email, password, name, and role are required' });
  }

  if (!['agent', 'customer', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const existingUser = db.users.getByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const newUser = db.users.create(email, password, role, name);
    const token = generateToken(newUser);

    return res.status(201).json({
      token,
      user: newUser
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Route: Guest Join via Invite Token (no account required)
// Validates the session token and issues a temporary JWT for the customer
router.post('/guest-join', (req, res) => {
  const { sessionToken, guestName } = req.body;

  if (!sessionToken || !guestName || !guestName.trim()) {
    return res.status(400).json({ error: 'Session token and your name are required' });
  }

  try {
    const { sessions } = require('./db');
    const session = sessions.getByToken(sessionToken);

    if (!session) {
      return res.status(404).json({ error: 'Invalid or expired invite link' });
    }
    if (session.status === 'ended') {
      return res.status(400).json({ error: 'This support session has already ended' });
    }

    // Issue a temporary guest JWT (no DB user, ephemeral id)
    const guestUser = {
      id: `guest_${Date.now()}`,
      email: `guest@atomquest.local`,
      role: 'customer',
      name: guestName.trim(),
      isGuest: true
    };

    const jwtToken = jwt.sign(guestUser, config.jwtSecret, { expiresIn: '4h' });

    return res.json({ token: jwtToken, user: guestUser });
  } catch (err) {
    console.error('Guest join error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = {
  router,
  authMiddleware,
  requireRole
};
