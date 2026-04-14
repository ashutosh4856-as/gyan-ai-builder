// ═══════════════════════════════════════════
//  GYAN AI — Authentication System
//  File: auth.js
// ═══════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── MIDDLEWARE ──
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ── HASH PASSWORD ──
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + process.env.JWT_SECRET).digest('hex');
}

// ── EMAIL SIGNUP ──
router.post('/email/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be 6+ characters' });

    // Check existing
    const { data: existing } = await supabase
      .from('users').select('id').eq('email', email).single();
    if (existing) return res.status(400).json({ error: 'Email already registered. Please sign in.' });

    // Create user
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        name: name || email.split('@')[0],
        email,
        password_hash: hashPassword(password),
        plan: 'free',
        credits: 5,
        login_method: 'email',
        created_at: new Date().toISOString(),
        last_login: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, plan: newUser.plan },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      user: { id: newUser.id, name: newUser.name, email: newUser.email, plan: newUser.plan, credits: newUser.credits }
    });
  } catch (err) {
    console.error('[Signup]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── EMAIL LOGIN ──
router.post('/email/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { data: user } = await supabase
      .from('users').select('*').eq('email', email).single();

    if (!user) return res.status(400).json({ error: 'Email not found. Please sign up first.' });
    if (user.password_hash !== hashPassword(password)) {
      return res.status(400).json({ error: 'Wrong password' });
    }

    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

    const token = jwt.sign(
      { id: user.id, email: user.email, plan: user.plan },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, plan: user.plan, credits: user.credits }
    });
  } catch (err) {
    console.error('[Login]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GITHUB LOGIN ──
router.get('/github', (req, res) => {
  const url = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&scope=user:email&redirect_uri=${process.env.APP_URL}/api/auth/github/callback`;
  res.redirect(url);
});

router.get('/github/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.redirect(`${process.env.FRONTEND_URL}/auth.html?error=no_code`);

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code
      })
    });
    const tokenData = await tokenRes.json();

    const userRes = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `token ${tokenData.access_token}` }
    });
    const gh = await userRes.json();

    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: { 'Authorization': `token ${tokenData.access_token}` }
    });
    const emails = await emailRes.json();
    const email = emails.find(e => e.primary)?.email || gh.email;

    const user = await upsertUser({
      github_id: gh.id.toString(),
      name: gh.name || gh.login,
      email,
      avatar: gh.avatar_url,
      github_token: tokenData.access_token,
      login_method: 'github'
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, plan: user.plan },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    const userStr = encodeURIComponent(JSON.stringify({ name: user.name, email: user.email, plan: user.plan, credits: user.credits }));
    res.redirect(`${process.env.FRONTEND_URL}/auth.html?token=${token}&user=${userStr}`);
  } catch (err) {
    console.error('[GitHub]', err.message);
    res.redirect(`${process.env.FRONTEND_URL}/auth.html?error=github_failed`);
  }
});

// ── OTP (Email) ──
router.post('/email/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);
    await supabase.from('otps').upsert({ email, otp, expires_at: expiry.toISOString(), type: 'email' });
    console.log(`[OTP] ${email}: ${otp}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/email/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const { data: record } = await supabase.from('otps').select('*').eq('email', email).eq('otp', otp).single();
    if (!record) return res.status(400).json({ error: 'Invalid OTP' });
    if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'OTP expired' });

    const user = await upsertUser({ email, login_method: 'email', name: email.split('@')[0] });
    const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, process.env.JWT_SECRET, { expiresIn: '30d' });
    await supabase.from('otps').delete().eq('email', email);
    res.json({ success: true, token, user: { name: user.name, email: user.email, plan: user.plan, credits: user.credits } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET ME ──
router.get('/me', verifyToken, async (req, res) => {
  try {
    const { data: user } = await supabase.from('users').select('id,name,email,plan,credits,avatar').eq('id', req.user.id).single();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HELPER ──
async function upsertUser(data) {
  const field = data.github_id ? 'github_id' : data.phone ? 'phone' : 'email';
  const val = data[field];
  const { data: existing } = await supabase.from('users').select('*').eq(field, val).single();
  if (existing) {
    const { data: updated } = await supabase.from('users').update({ ...data, last_login: new Date().toISOString() }).eq('id', existing.id).select().single();
    return updated || existing;
  }
  const { data: newUser } = await supabase.from('users').insert({ ...data, plan: 'free', credits: 5, created_at: new Date().toISOString(), last_login: new Date().toISOString() }).select().single();
  return newUser;
}

module.exports = { router, verifyToken };
      
