// ═══════════════════════════════════════════
//  GYAN AI — Deploy System (Cloudflare)
//  File: deploy.js
// ═══════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');
const db = require('./database');
require('dotenv').config();

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ZONE_ID = process.env.CF_ZONE_ID;
const BASE_DOMAIN = 'gyan-ai.tech';

// ── CLOUDFLARE HELPER ──
async function cfRequest(method, path, body = null) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : null
  });
  return res.json();
}

// ── CHECK SUBDOMAIN ──
router.get('/check/:subdomain', async (req, res) => {
  try {
    const { subdomain } = req.params;

    if (!subdomain || subdomain.length < 2) {
      return res.status(400).json({ error: 'Subdomain too short' });
    }

    if (!/^[a-z0-9-]+$/.test(subdomain)) {
      return res.status(400).json({ error: 'Only letters, numbers, and hyphens allowed' });
    }

    const reserved = ['www', 'api', 'admin', 'mail', 'app', 'gyan', 'dashboard'];
    if (reserved.includes(subdomain)) {
      return res.json({ available: false, reason: 'Reserved subdomain' });
    }

    const available = await db.checkSubdomainAvailable(subdomain);
    res.json({ available, subdomain: `${subdomain}.${BASE_DOMAIN}` });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DEPLOY WEB APP ──
router.post('/webapp', verifyToken, async (req, res) => {
  try {
    const { appId, subdomain } = req.body;
    const userId = req.user.id;

    if (!appId || !subdomain) {
      return res.status(400).json({ error: 'appId and subdomain required' });
    }

    // Check user plan for deploy
    const user = await db.getUser(userId);
    if (user.plan === 'free') {
      const userApps = await db.getUserApps(userId);
      const liveApps = userApps.filter(a => a.status === 'live');
      if (liveApps.length >= 2) {
        return res.status(403).json({
          error: 'Free plan allows 2 deployments. Upgrade to Premium for more!',
          upgrade: true
        });
      }
    }

    // Check subdomain availability
    const available = await db.checkSubdomainAvailable(subdomain);
    if (!available) {
      return res.status(409).json({ error: 'Subdomain already taken. Choose another.' });
    }

    // Get app code
    const app = await db.getApp(appId);
    if (!app) return res.status(404).json({ error: 'App not found' });
    if (app.user_id !== userId) return res.status(403).json({ error: 'Not authorized' });

    // Create DNS record on Cloudflare
    const dnsResult = await cfRequest('POST', `/zones/${CF_ZONE_ID}/dns_records`, {
      type: 'CNAME',
      name: `${subdomain}.${BASE_DOMAIN}`,
      content: `${CF_ACCOUNT_ID}.workers.dev`,
      ttl: 1,
      proxied: true
    });

    if (!dnsResult.success) {
      console.error('[Deploy] DNS error:', dnsResult.errors);
    }

    // Save to Cloudflare KV (for serving the HTML)
    await saveToKV(subdomain, app.html_code);

    // Update database
    await db.publishApp(appId, subdomain);

    const liveUrl = `https://${subdomain}.${BASE_DOMAIN}`;
    console.log(`[Deploy] ✅ ${liveUrl}`);

    res.json({
      success: true,
      url: liveUrl,
      subdomain,
      message: `Your app is live at ${liveUrl}!`
    });

  } catch (err) {
    console.error('[Deploy]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DEPLOY GITHUB REPO ──
router.post('/github', verifyToken, async (req, res) => {
  try {
    const { repoName, subdomain, branch = 'main' } = req.body;
    const userId = req.user.id;

    if (!repoName || !subdomain) {
      return res.status(400).json({ error: 'repoName and subdomain required' });
    }

    // Check user plan
    const user = await db.getUser(userId);
    if (user.plan === 'free') {
      return res.status(403).json({
        error: 'GitHub deployment requires Premium plan. Upgrade now!',
        upgrade: true
      });
    }

    // Get user's GitHub token
    const { data: userData } = await db.supabase
      .from('users')
      .select('github_token, github_username')
      .eq('id', userId)
      .single();

    if (!userData?.github_token) {
      return res.status(400).json({ error: 'Please connect your GitHub account first' });
    }

    // Fetch repo files from GitHub
    const filesRes = await fetch(
      `https://api.github.com/repos/${userData.github_username}/${repoName}/contents?ref=${branch}`,
      { headers: { 'Authorization': `token ${userData.github_token}` } }
    );
    const files = await filesRes.json();

    if (!Array.isArray(files)) {
      return res.status(404).json({ error: 'Repository not found or no files' });
    }

    // Find index.html
    const indexFile = files.find(f => f.name === 'index.html');
    if (!indexFile) {
      return res.status(400).json({ error: 'No index.html found in repository root' });
    }

    const htmlRes = await fetch(indexFile.download_url);
    const htmlContent = await htmlRes.text();

    // Check subdomain
    const available = await db.checkSubdomainAvailable(subdomain);
    if (!available) {
      return res.status(409).json({ error: 'Subdomain taken. Try another.' });
    }

    // Deploy to Cloudflare
    await saveToKV(subdomain, htmlContent);

    await cfRequest('POST', `/zones/${CF_ZONE_ID}/dns_records`, {
      type: 'CNAME',
      name: `${subdomain}.${BASE_DOMAIN}`,
      content: `${CF_ACCOUNT_ID}.workers.dev`,
      ttl: 1,
      proxied: true
    });

    const liveUrl = `https://${subdomain}.${BASE_DOMAIN}`;

    res.json({
      success: true,
      url: liveUrl,
      repo: repoName,
      message: `${repoName} is live at ${liveUrl}!`
    });

  } catch (err) {
    console.error('[GitHub Deploy]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SAVE TO CLOUDFLARE KV ──
async function saveToKV(subdomain, htmlContent) {
  const result = await cfRequest(
    'PUT',
    `/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_KV_NAMESPACE_ID}/values/${subdomain}`,
    { value: htmlContent }
  );
  return result;
}

// ── DELETE DEPLOYMENT ──
router.delete('/:subdomain', verifyToken, async (req, res) => {
  try {
    const { subdomain } = req.params;
    const userId = req.user.id;

    const app = await db.getAppBySubdomain(subdomain);
    if (!app || app.user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Delete DNS record
    const records = await cfRequest('GET', `/zones/${CF_ZONE_ID}/dns_records?name=${subdomain}.${BASE_DOMAIN}`);
    if (records.result?.length > 0) {
      await cfRequest('DELETE', `/zones/${CF_ZONE_ID}/dns_records/${records.result[0].id}`);
    }

    // Delete from KV
    await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_KV_NAMESPACE_ID}/values/${subdomain}`);

    // Update DB
    await db.turso.execute({
      sql: "UPDATE apps SET status = 'draft', subdomain = NULL WHERE subdomain = ?",
      args: [subdomain]
    });

    res.json({ success: true, message: 'Deployment removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
      
