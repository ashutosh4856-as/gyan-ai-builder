// ═══════════════════════════════════════════
//  GYAN AI — Authentication System
//  File: auth.js
// ═══════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── MIDDLEWARE — Verify JWT Token ──
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// ── GITHUB LOGIN ──
router.get('/github', (req, res) => {
  const githubUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&scope=user:email,repo&redirect_uri=${process.env.APP_URL}/api/auth/github/callback`;
  res.redirect(githubUrl);
});

router.get('/github/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.redirect(`${process.env.FRONTEND_URL}?error=no_code`);

    // Exchange code for token
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

    // Get user info
    const userRes = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `token ${tokenData.access_token}` }
    });
    const githubUser = await userRes.json();

    // Get email
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: { 'Authorization': `token ${tokenData.access_token}` }
    });
    const emails = await emailRes.json();
    const primaryEmail = emails.find(e => e.primary)?.email || githubUser.email;

    // Upsert user in database
    const user = await upsertUser({
      github_id: githubUser.id.toString(),
      name: githubUser.name || githubUser.login,
      email: primaryEmail,
      avatar: githubUser.avatar_url,
      github_token: tokenData.access_token,
      login_method: 'github'
    });

    // Create JWT
    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, plan: user.plan },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?token=${jwtToken}&user=${encodeURIComponent(JSON.stringify({ name: user.name, avatar: user.avatar, plan: user.plan }))}`);

  } catch (err) {
    console.error('[Auth GitHub]', err.message);
    res.redirect(`${process.env.FRONTEND_URL}?error=github_failed`);
  }
});

// ── GOOGLE LOGIN ──
router.get('/google', (req, res) => {
  const googleUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${process.env.APP_URL}/api/auth/google/callback&response_type=code&scope=profile email`;
  res.redirect(googleUrl);
});

router.get('/google/callback', async (req, res) => {
  try {
    const { code } = req.query;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${process.env.APP_URL}/api/auth/google/callback`
      })
    });
    const tokenData = await tokenRes.json();

    const userRes = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo?access_token=${tokenData.access_token}`);
    const googleUser = await userRes.json();

    const user = await upsertUser({
      google_id: googleUser.id,
      name: googleUser.name,
      email: googleUser.email,
      avatar: googleUser.picture,
      login_method: 'google'
    });

    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, plan: user.plan },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?token=${jwtToken}&user=${encodeURIComponent(JSON.stringify({ name: user.name, avatar: user.avatar, plan: user.plan }))}`);

  } catch (err) {
    console.error('[Auth Google]', err.message);
    res.redirect(`${process.env.FRONTEND_URL}?error=google_failed`);
  }
});

// ── EMAIL LOGIN ──
router.post('/email/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await supabase.from('otps').upsert({
      email,
      otp,
      expires_at: expiry.toISOString(),
      type: 'email'
    });

    // Send email (using Supabase's built-in or custom SMTP)
    // For now, just log it
    console.log(`[OTP] ${email}: ${otp}`);

    res.json({ success: true, message: 'OTP sent to email' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/email/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    const { data: otpRecord } = await supabase
      .from('otps')
      .select('*')
      .eq('email', email)
      .eq('otp', otp)
      .eq('type', 'email')
      .single();

    if (!otpRecord) return res.status(400).json({ error: 'Invalid OTP' });
    if (new Date(otpRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP expired. Request a new one.' });
    }

    const user = await upsertUser({ email, login_method: 'email', name: email.split('@')[0] });

    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, plan: user.plan },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    await supabase.from('otps').delete().eq('email', email);

    res.json({ success: true, token: jwtToken, user: { name: user.name, plan: user.plan } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PHONE LOGIN ──
router.post('/phone/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || phone.length < 10) {
      return res.status(400).json({ error: 'Valid phone number required' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    await supabase.from('otps').upsert({
      phone,
      otp,
      expires_at: expiry.toISOString(),
      type: 'phone'
    });

    // TODO: Integrate MSG91 or Fast2SMS for SMS
    console.log(`[OTP Phone] ${phone}: ${otp}`);

    res.json({ success: true, message: 'OTP sent to phone' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/phone/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;

    const { data: otpRecord } = await supabase
      .from('otps')
      .select('*')
      .eq('phone', phone)
      .eq('otp', otp)
      .eq('type', 'phone')
      .single();

    if (!otpRecord) return res.status(400).json({ error: 'Invalid OTP' });
    if (new Date(otpRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP expired' });
    }

    const user = await upsertUser({ phone, login_method: 'phone', name: `User${phone.slice(-4)}` });

    const jwtToken = jwt.sign(
      { id: user.id, plan: user.plan },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    await supabase.from('otps').delete().eq('phone', phone);

    res.json({ success: true, token: jwtToken, user: { name: user.name, plan: user.plan } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET CURRENT USER ──
router.get('/me', verifyToken, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, name, email, avatar, plan, credits, created_at')
      .eq('id', req.user.id)
      .single();

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HELPER: Upsert User ──
async function upsertUser(data) {
  const lookupField = data.github_id ? 'github_id' :
                      data.google_id ? 'google_id' :
                      data.phone ? 'phone' : 'email';
  const lookupValue = data[lookupField];

  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq(lookupField, lookupValue)
    .single();

  if (existing) {
    const { data: updated } = await supabase
      .from('users')
      .update({ ...data, last_login: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();
    return updated || existing;
  }

  const { data: newUser } = await supabase
    .from('users')
    .insert({
      ...data,
      plan: 'free',
      credits: 5,
      created_at: new Date().toISOString(),
      last_login: new Date().toISOString()
    })
    .select()
    .single();

  return newUser;
}

module.exports = { router, verifyToken };
