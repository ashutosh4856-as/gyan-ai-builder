// ═══════════════════════════════════════════
//  GYAN AI — Main Backend Server
//  File: server.js
// ═══════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const aiRoutes = require('./routes/ai');
const authRoutes = require('./routes/auth');
const deployRoutes = require('./routes/deploy');
const creditsRoutes = require('./routes/credits');
const apkRoutes = require('./routes/apk');
const paymentRoutes = require('./routes/payment');

const app = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY ──
app.use(helmet());
app.use(cors({
  origin: [
    'https://gyan-ai.tech',
    'https://www.gyan-ai.tech',
    'http://localhost:3000',
    /\.gyan-ai\.tech$/
  ],
  credentials: true
}));

// ── RATE LIMITING ──
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests. Please wait.' }
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'AI rate limit reached. Wait 1 minute.' }
});

app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── ROUTES ──
app.use('/api/ai', aiLimiter, aiRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/deploy', deployRoutes);
app.use('/api/credits', creditsRoutes);
app.use('/api/apk', apkRoutes);
app.use('/api/payment', paymentRoutes);

// ── HEALTH CHECK ──
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Gyan AI Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ── ROOT ──
app.get('/', (req, res) => {
  res.json({ message: 'Gyan AI API is running 🧠' });
});

// ── ERROR HANDLER ──
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// ── 404 ──
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── START ──
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════╗
  ║   🧠 GYAN AI Server Running   ║
  ║   Port: ${PORT}                   ║
  ║   Mode: ${process.env.NODE_ENV || 'development'}            ║
  ╚════════════════════════════════╝
  `);
});

module.exports = app;
