// ═══════════════════════════════════════════
//  GYAN AI — Payment System (UPI Deep Link)
//  File: payment.js
// ═══════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');
const { supabase } = require('./database');
require('dotenv').config();

const UPI_ID = process.env.UPI_ID; // e.g. gyanai@phonepe
const MERCHANT_NAME = 'Gyan AI';

const PLANS = {
  premium_light: {
    name: 'Premium Light',
    amount: 99,
    days: 15,
    apps: 50,
    apks: 15,
    deploys: 10
  },
  premium: {
    name: 'Premium',
    amount: 199,
    days: 30,
    apps: -1, // unlimited
    apks: 40,
    deploys: -1 // unlimited
  },
  developer: {
    name: 'Developer',
    amount: 299,
    days: 30,
    apps: -1,
    apks: 60,
    deploys: -1
  }
};

// ── GET UPI DEEP LINKS ──
router.post('/upi-link', verifyToken, async (req, res) => {
  try {
    const { planId } = req.body;
    const plan = PLANS[planId];

    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    const txnNote = `GyanAI ${plan.name} - ${req.user.id.slice(0, 8)}`;
    const encodedNote = encodeURIComponent(txnNote);
    const encodedMerchant = encodeURIComponent(MERCHANT_NAME);

    const baseParams = `pa=${UPI_ID}&pn=${encodedMerchant}&am=${plan.amount}&tn=${encodedNote}&cu=INR`;

    res.json({
      plan,
      upiId: UPI_ID,
      amount: plan.amount,
      links: {
        generic: `upi://pay?${baseParams}`,
        gpay: `tez://upi/pay?${baseParams}`,
        phonepe: `phonepe://pay?${baseParams}`,
        paytm: `paytmmp://pay?${baseParams}`,
        bhim: `bhim://pay?${baseParams}`
      },
      qrData: `upi://pay?${baseParams}`
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── VERIFY UTR & ACTIVATE PLAN ──
router.post('/verify-utr', verifyToken, async (req, res) => {
  try {
    const { utr, planId } = req.body;
    const userId = req.user.id;

    if (!utr || utr.length < 8) {
      return res.status(400).json({ error: 'Please enter a valid UTR number (min 8 chars)' });
    }

    const plan = PLANS[planId];
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    // Check if UTR already used
    const { data: existing } = await supabase
      .from('payments')
      .select('id')
      .eq('utr', utr)
      .single();

    if (existing) {
      return res.status(400).json({ error: 'This UTR has already been used' });
    }

    // Save payment record (pending verification)
    const { data: payment } = await supabase
      .from('payments')
      .insert({
        user_id: userId,
        utr,
        plan_id: planId,
        amount: plan.amount,
        status: 'pending',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    // Auto-activate (manual verification model)
    // In production, you'd verify via PhonePe business API
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + plan.days);

    await supabase
      .from('users')
      .update({
        plan: planId,
        plan_expires_at: expiresAt.toISOString()
      })
      .eq('id', userId);

    await supabase
      .from('payments')
      .update({ status: 'activated' })
      .eq('id', payment.id);

    console.log(`[Payment] ✅ User ${userId} activated ${planId} via UTR ${utr}`);

    res.json({
      success: true,
      plan: plan.name,
      expiresAt: expiresAt.toISOString(),
      message: `🎉 ${plan.name} activated! Valid for ${plan.days} days.`
    });

  } catch (err) {
    console.error('[Payment]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: Verify payments manually ──
router.get('/admin/pending', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data: pending } = await supabase
      .from('payments')
      .select('*, users(name, email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    res.json({ payments: pending || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET PAYMENT HISTORY ──
router.get('/history', verifyToken, async (req, res) => {
  try {
    const { data: payments } = await supabase
      .from('payments')
      .select('id, plan_id, amount, status, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(10);

    res.json({ payments: payments || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
