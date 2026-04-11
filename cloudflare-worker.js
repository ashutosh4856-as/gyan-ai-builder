// ═══════════════════════════════════════════
//  GYAN AI — Cloudflare Worker
//  File: cloudflare-worker.js
//  Deploy this on Cloudflare Workers dashboard
// ═══════════════════════════════════════════

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const hostname = url.hostname;

  // Extract subdomain from hostname
  // e.g. rahul.gyan-ai.tech -> rahul
  const parts = hostname.split('.');
  const isSubdomain = parts.length === 3 && parts[1] === 'gyan-ai' && parts[2] === 'tech';

  // Main domain — serve the main site
  if (!isSubdomain) {
    return fetch(request);
  }

  const subdomain = parts[0];

  // Skip system subdomains
  const reserved = ['www', 'api', 'admin', 'mail', 'dashboard'];
  if (reserved.includes(subdomain)) {
    return fetch(request);
  }

  // Get app HTML from KV store
  try {
    const htmlContent = await GYAN_AI_APPS.get(subdomain);

    if (!htmlContent) {
      return new Response(notFoundPage(subdomain), {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // Inject Gyan AI footer badge
    const injected = injectBadge(htmlContent, subdomain);

    // Track view (fire and forget)
    trackView(subdomain);

    return new Response(injected, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Powered-By': 'Gyan AI',
        'Cache-Control': 'public, max-age=60'
      }
    });

  } catch (err) {
    return new Response(errorPage(err.message), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

// ── INJECT GYAN AI BADGE ──
function injectBadge(html, subdomain) {
  const badge = `
  <style>
    #gyan-badge {
      position: fixed;
      bottom: 14px;
      right: 14px;
      z-index: 99999;
      background: linear-gradient(135deg, #6366f1, #ec4899);
      color: #fff;
      padding: 6px 12px;
      border-radius: 99px;
      font-family: -apple-system, sans-serif;
      font-size: 11px;
      font-weight: 600;
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 5px;
      box-shadow: 0 4px 14px rgba(99,102,241,0.4);
      transition: opacity 0.2s;
    }
    #gyan-badge:hover { opacity: 0.85; }
  </style>
  <a id="gyan-badge" href="https://gyan-ai.tech" target="_blank">🧠 Built with Gyan AI</a>`;

  if (html.includes('</body>')) {
    return html.replace('</body>', badge + '</body>');
  }
  return html + badge;
}

// ── TRACK VIEW ──
async function trackView(subdomain) {
  try {
    await fetch('https://api.gyan-ai.tech/api/deploy/view/' + subdomain, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {}
}

// ── 404 PAGE ──
function notFoundPage(subdomain) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>App Not Found — Gyan AI</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#080810;color:#f8fafc;font-family:-apple-system,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px}
    .card{background:#12121f;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:40px 32px;max-width:400px}
    .icon{font-size:3rem;margin-bottom:16px}
    h1{font-size:1.3rem;font-weight:800;margin-bottom:8px}
    p{color:#94a3b8;font-size:.88rem;line-height:1.6;margin-bottom:24px}
    .sub{font-family:monospace;color:#6366f1;background:rgba(99,102,241,.1);padding:4px 10px;border-radius:6px;font-size:.82rem;display:inline-block;margin-bottom:16px}
    a{display:inline-block;padding:10px 22px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#ec4899);color:#fff;text-decoration:none;font-weight:600;font-size:.85rem}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🧠</div>
    <div class="sub">${subdomain}.gyan-ai.tech</div>
    <h1>App Not Found</h1>
    <p>This subdomain hasn't been published yet, or the app was removed.</p>
    <a href="https://gyan-ai.tech">Build your own app →</a>
  </div>
</body>
</html>`;
}

// ── ERROR PAGE ──
function errorPage(msg) {
  return `<!DOCTYPE html>
<html>
<head><title>Error — Gyan AI</title>
<style>body{background:#080810;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}</style>
</head>
<body>
<div>
  <h1>🧠 Something went wrong</h1>
  <p style="color:#94a3b8;margin-top:8px">Please try again or contact support@gyan-ai.tech</p>
</div>
</body>
</html>`;
}
