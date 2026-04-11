// ═══════════════════════════════════════════
//  GYAN AI — Credits System
//  File: credits.js
// ═══════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');
const { supabase } = require('./database');
require('dotenv').config();

// ── GET CREDITS ──
router.get('/', verifyToken, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('credits, plan, plan_expires_at, last_credit_date')
      .eq('id', req.user.id)
      .single();

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      credits: user.credits,
      plan: user.plan,
      planExpiresAt: user.plan_expires_at,
      nextCreditAt: getNextCreditTime(user.last_credit_date)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DAILY CREDIT (called by cron job) ──
router.post('/daily', async (req, res) => {
  try {
    // Security: only internal calls
    const secret = req.headers['x-cron-secret'];
    if (secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const today = new Date().toISOString().split('T')[0];

    // Get all free users who haven't received credit today
    const { data: users } = await supabase
      .from('users')
      .select('id, credits, last_credit_date')
      .eq('plan', 'free')
      .neq('last_credit_date', today);

    if (!users || users.length === 0) {
      return res.json({ message: 'No users to update', count: 0 });
    }

    // Add 1 credit to each
    let updated = 0;
    for (const user of users) {
      const newCredits = Math.min(user.credits + 1, 30); // Max 30 credits
      await supabase
        .from('users')
        .update({
          credits: newCredits,
          last_credit_date: today
        })
        .eq('id', user.id);
      updated++;
    }

    console.log(`[Credits] Daily credits given to ${updated} users`);
    res.json({ success: true, updated });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MONTHLY RESET (1st of every month) ──
router.post('/monthly-reset', async (req, res) => {
  try {
    const secret = req.headers['x-cron-secret'];
    if (secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const today = new Date();
    if (today.getDate() !== 1) {
      return res.json({ message: 'Not the 1st of month, skipping' });
    }

    // Reset all free users to 5 credits on 1st
    const { data, error } = await supabase
      .from('users')
      .update({ credits: 5 })
      .eq('plan', 'free');

    // Check and expire premium plans
    const { data: expiredUsers } = await supabase
      .from('users')
      .select('id')
      .neq('plan', 'free')
      .lt('plan_expires_at', today.toISOString());

    if (expiredUsers?.length > 0) {
      for (const u of expiredUsers) {
        await supabase
          .from('users')
          .update({ plan: 'free', credits: 5 })
          .eq('id', u.id);
      }
      console.log(`[Credits] Expired ${expiredUsers.length} premium plans`);
    }

    console.log('[Credits] Monthly reset done');
    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DEDUCT CREDITS ──
router.post('/deduct', verifyToken, async (req, res) => {
  try {
    const { amount = 5 } = req.body;
    const userId = req.user.id;

    const { data: user } = await supabase
      .from('users')
      .select('credits, plan')
      .eq('id', userId)
      .single();

    if (user.plan !== 'free') {
      return res.json({ success: true, message: 'Premium user, no deduction' });
    }

    if (user.credits < amount) {
      return res.status(403).json({
        error: `Not enough credits. You have ${user.credits}, need ${amount}`,
        credits: user.credits,
        needed: amount
      });
    }

    await supabase
      .from('users')
      .update({ credits: user.credits - amount })
      .eq('id', userId);

    res.json({
      success: true,
      creditsUsed: amount,
      creditsRemaining: user.credits - amount
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HELPER ──
function getNextCreditTime(lastCreditDate) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

module.exports = router;
