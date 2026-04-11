// ═══════════════════════════════════════════
//  GYAN AI — APK Builder via GitHub Actions
//  File: apk.js
// ═══════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');
const { supabase, turso, getApp } = require('./database');
require('dotenv').config();

const BUILDER_REPO = 'gyan-ai-builder'; // Our GitHub repo for building APKs
const GITHUB_TOKEN = process.env.GITHUB_BUILDER_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;

// ── REQUEST APK BUILD ──
router.post('/build', verifyToken, async (req, res) => {
  try {
    const { appId } = req.body;
    const userId = req.user.id;

    // Check premium plan
    const { data: user } = await supabase
      .from('users')
      .select('plan, plan_expires_at')
      .eq('id', userId)
      .single();

    if (user.plan === 'free') {
      return res.status(403).json({
        error: 'APK generation requires Premium plan',
        upgrade: true
      });
    }

    // Check APK limit for this month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const { count: apkCount } = await supabase
      .from('apk_builds')
      .select('id', { count: 'exact' })
      .eq('user_id', userId)
      .gte('created_at', monthStart.toISOString());

    const limit = user.plan === 'premium_light' ? 15 : 40;
    if (apkCount >= limit) {
      return res.status(403).json({
        error: `Monthly APK limit reached (${limit}). Resets on the 1st.`,
        limit,
        used: apkCount
      });
    }

    // Get app code
    const app = await getApp(appId);
    if (!app || app.user_id !== userId) {
      return res.status(404).json({ error: 'App not found' });
    }

    // Create APK build record
    const buildId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    await supabase.from('apk_builds').insert({
      id: buildId,
      app_id: appId,
      user_id: userId,
      status: 'queued',
      created_at: new Date().toISOString()
    });

    // Trigger GitHub Actions workflow
    const workflowResult = await triggerWorkflow(buildId, app.html_code, app.name);

    if (!workflowResult.success) {
      await supabase
        .from('apk_builds')
        .update({ status: 'failed' })
        .eq('id', buildId);

      return res.status(500).json({ error: 'Failed to start APK build' });
    }

    res.json({
      success: true,
      buildId,
      status: 'queued',
      message: 'APK build started! Check status in a few minutes.',
      estimatedTime: '5-10 minutes'
    });

  } catch (err) {
    console.error('[APK]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── TRIGGER GITHUB ACTIONS ──
async function triggerWorkflow(buildId, htmlCode, appName) {
  try {
    // Encode HTML to base64 for safe transfer
    const htmlBase64 = Buffer.from(htmlCode).toString('base64');
    const safeAppName = appName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();

    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${BUILDER_REPO}/actions/workflows/build-apk.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            build_id: buildId,
            app_name: safeAppName,
            html_content: htmlBase64
          }
        })
      }
    );

    if (response.status === 204) {
      return { success: true };
    }

    const error = await response.json();
    console.error('[GitHub Actions]', error);
    return { success: false, error };

  } catch (err) {
    console.error('[GitHub Actions]', err.message);
    return { success: false };
  }
}

// ── CHECK BUILD STATUS ──
router.get('/status/:buildId', verifyToken, async (req, res) => {
  try {
    const { buildId } = req.params;

    const { data: build } = await supabase
      .from('apk_builds')
      .select('*')
      .eq('id', buildId)
      .eq('user_id', req.user.id)
      .single();

    if (!build) return res.status(404).json({ error: 'Build not found' });

    res.json({
      buildId: build.id,
      status: build.status,
      downloadUrl: build.download_url,
      createdAt: build.created_at,
      completedAt: build.completed_at
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WEBHOOK: GitHub Actions calls this when done ──
router.post('/webhook/complete', async (req, res) => {
  try {
    const { buildId, status, downloadUrl } = req.body;
    const secret = req.headers['x-webhook-secret'];

    if (secret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await supabase
      .from('apk_builds')
      .update({
        status: status || 'completed',
        download_url: downloadUrl || null,
        completed_at: new Date().toISOString()
      })
      .eq('id', buildId);

    console.log(`[APK] Build ${buildId} ${status}`);
    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET USER'S APK BUILDS ──
router.get('/my-builds', verifyToken, async (req, res) => {
  try {
    const { data: builds } = await supabase
      .from('apk_builds')
      .select('id, app_id, status, download_url, created_at, completed_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    res.json({ builds: builds || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
      
