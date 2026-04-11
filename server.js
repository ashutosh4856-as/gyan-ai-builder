// ═══════════════════════════════════════════
//  GYAN AI — Main Backend Server
//  File: server.js
// ═══════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const aiRoutes = require('./ai');
const { router: authRoutes } = require('./auth');
const deployRoutes = require('./deploy');
const creditsRoutes = require('./credits');
const apkRoutes = require('./apk');
const paymentRoutes = require('./payment');
const adminRoutes = require('./admin-routes');

const app = express();
const PORT = process.env.PORT || 3000;

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

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Please wait.' }
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
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
app.use('/api/admin', adminRoutes);

// ── HEALTH CHECK ──
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Gyan AI Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({ message: 'Gyan AI API is running 🧠' });
});

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`🧠 Gyan AI Server running on port ${PORT}`);
});

module.exports = app;
