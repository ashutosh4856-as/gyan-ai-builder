// ═══════════════════════════════════════════
//  GYAN AI — Admin Routes
//  File: admin.js
// ═══════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { supabase, turso } = require('./database');
require('dotenv').config();

// ── ADMIN AUTH MIDDLEWARE ──
const adminAuth = (req, res, next) => {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ── STATS ──
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const { count: totalUsers } = await supabase
      .from('users').select('id', { count: 'exact' });

    const { count: premiumUsers } = await supabase
      .from('users').select('id', { count: 'exact' }).neq('plan', 'free');

    const { count: pendingPayments } = await supabase
      .from('payments').select('id', { count: 'exact' }).eq('status', 'pending');

    const { data: todayPayments } = await supabase
      .from('payments').select('amount')
      .eq('status', 'activated')
      .gte('created_at', today);

    const revenueToday = todayPayments?.reduce((sum, p) => sum + p.amount, 0) || 0;

    res.json({
      stats: {
        totalUsers: totalUsers || 0,
        premiumUsers: premiumUsers || 0,
        pendingPayments: pendingPayments || 0,
        appsToday: 0,
        revenueToday
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ALL USERS ──
router.get('/users', adminAuth, async (req, res) => {
  try {
    const { data: users } = await supabase
      .from('users')
      .select('id, name, email, phone, plan, credits, plan_expires_at, created_at, login_method')
      .order('created_at', { ascending: false })
      .limit(100);

    res.json({ users: users || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ACTIVATE PLAN ──
router.post('/activate', adminAuth, async (req, res) => {
  try {
    const { userId, plan } = req.body;

    const plans = {
      premium_light: 15,
      premium: 30,
      developer: 30
    };

    const days = plans[plan];
    if (!days) return res.status(400).json({ error: 'Invalid plan' });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    await supabase
      .from('users')
      .update({
        plan,
        plan_expires_at: expiresAt.toISOString()
      })
      .eq('id', userId);

    // Mark pending payments as activated
    await supabase
      .from('payments')
      .update({ status: 'activated', activated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('status', 'pending');

    console.log(`[Admin] ✅ Activated ${plan} for user ${userId}`);
    res.json({ success: true, message: `${plan} activated for user` });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SUBMIT PAYMENT (with screenshot) ──
router.post('/payment/submit', async (req, res) => {
  try {
    const { utr, planId, amount, userId, userEmail, screenshotBase64 } = req.body;

    if (!utr || !planId || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check duplicate UTR
    const { data: existing } = await supabase
      .from('payments')
      .select('id')
      .eq('utr', utr)
      .single();

    if (existing) {
      return res.status(400).json({ error: 'UTR already submitted' });
    }

    // Save payment
    await supabase.from('payments').insert({
      user_id: userId,
      utr,
      plan_id: planId,
      amount,
      status: 'pending',
      screenshot_base64: screenshotBase64 ? screenshotBase64.substring(0, 100) + '...' : null,
      has_screenshot: !!screenshotBase64,
      created_at: new Date().toISOString()
    });

    console.log(`[Payment] New payment from ${userEmail} - ₹${amount} - UTR: ${utr}`);

    res.json({
      success: true,
      message: 'Payment submitted! Will be verified within 1-2 hours.'
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
