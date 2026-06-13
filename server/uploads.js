const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('./auth');
const db = require('./db');

const router = express.Router();
const uploadDir = path.resolve(__dirname, '../uploads');

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB file limit
});

// Route: Upload file (Authenticted)
router.post('/', authMiddleware, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const sessionId = req.body.sessionId;
    if (!sessionId) {
      // Clean up uploaded file if sessionId is missing
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Session ID is required' });
    }

    // Build the accessible URL path
    const fileUrl = `/uploads/${req.file.filename}`;
    
    // Log the file upload event
    db.events.log(sessionId, 'file_uploaded', req.user.id, { 
      filename: req.file.originalname, 
      url: fileUrl 
    });

    return res.json({
      url: fileUrl,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });
  } catch (err) {
    console.error('File upload error:', err);
    return res.status(500).json({ error: 'Failed to upload file' });
  }
});

module.exports = router;
