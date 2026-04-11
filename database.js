// ═══════════════════════════════════════════
//  GYAN AI — Database Setup & Queries
//  File: database.js
// ═══════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { createClient: tursoClient } = require('@libsql/client');
require('dotenv').config();

// ── SUPABASE (Users, Auth, Plans) ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── TURSO (App Code, Files) ──
const turso = tursoClient({
  url: process.env.TURSO_DB_URL,
  authToken: process.env.TURSO_DB_TOKEN
});

// ── SETUP TABLES ──
async function setupDatabase() {
  console.log('[DB] Setting up Turso tables...');

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT DEFAULT 'Untitled App',
      subdomain TEXT UNIQUE,
      prompt TEXT,
      html_code TEXT,
      css_code TEXT,
      js_code TEXT,
      status TEXT DEFAULT 'draft',
      plan_type TEXT DEFAULT 'free',
      views INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      published_at TEXT
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      app_id TEXT,
      user_id TEXT,
      subdomain TEXT,
      type TEXT DEFAULT 'webapp',
      status TEXT DEFAULT 'pending',
      url TEXT,
      created_at TEXT
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS apk_builds (
      id TEXT PRIMARY KEY,
      app_id TEXT,
      user_id TEXT,
      status TEXT DEFAULT 'queued',
      download_url TEXT,
      created_at TEXT,
      completed_at TEXT
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS secrets (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      app_id TEXT,
      key_name TEXT,
      key_value TEXT,
      created_at TEXT
    )
  `);

  console.log('[DB] Turso tables ready ✅');
}

// ── APP QUERIES ──

async function saveApp(appData) {
  const id = generateId();
  await turso.execute({
    sql: `INSERT OR REPLACE INTO apps (id, user_id, name, prompt, html_code, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      appData.userId,
      appData.name || 'Untitled App',
      appData.prompt,
      appData.code,
      'draft',
      new Date().toISOString(),
      new Date().toISOString()
    ]
  });
  return id;
}

async function getApp(appId) {
  const result = await turso.execute({
    sql: 'SELECT * FROM apps WHERE id = ?',
    args: [appId]
  });
  return result.rows[0] || null;
}

async function getUserApps(userId) {
  const result = await turso.execute({
    sql: 'SELECT id, name, subdomain, status, views, created_at, published_at FROM apps WHERE user_id = ? ORDER BY created_at DESC',
    args: [userId]
  });
  return result.rows;
}

async function updateAppCode(appId, code) {
  await turso.execute({
    sql: 'UPDATE apps SET html_code = ?, updated_at = ? WHERE id = ?',
    args: [code, new Date().toISOString(), appId]
  });
}

async function publishApp(appId, subdomain) {
  await turso.execute({
    sql: 'UPDATE apps SET status = ?, subdomain = ?, published_at = ? WHERE id = ?',
    args: ['live', subdomain, new Date().toISOString(), appId]
  });
}

async function getAppBySubdomain(subdomain) {
  const result = await turso.execute({
    sql: 'SELECT * FROM apps WHERE subdomain = ? AND status = ?',
    args: [subdomain, 'live']
  });
  return result.rows[0] || null;
}

async function checkSubdomainAvailable(subdomain) {
  const result = await turso.execute({
    sql: 'SELECT id FROM apps WHERE subdomain = ?',
    args: [subdomain]
  });
  return result.rows.length === 0;
}

async function incrementViews(appId) {
  await turso.execute({
    sql: 'UPDATE apps SET views = views + 1 WHERE id = ?',
    args: [appId]
  });
}

// ── USER QUERIES (Supabase) ──

async function getUser(userId) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  return data;
}

async function updateUserPlan(userId, plan, expiresAt) {
  await supabase
    .from('users')
    .update({ plan, plan_expires_at: expiresAt })
    .eq('id', userId);
}

async function getUserCredits(userId) {
  const { data } = await supabase
    .from('users')
    .select('credits')
    .eq('id', userId)
    .single();
  return data?.credits || 0;
}

// ── SECRETS ──

async function saveSecret(userId, appId, keyName, keyValue) {
  const id = generateId();
  // Encrypt before saving (basic base64 — use proper encryption in production)
  const encrypted = Buffer.from(keyValue).toString('base64');
  await turso.execute({
    sql: 'INSERT OR REPLACE INTO secrets (id, user_id, app_id, key_name, key_value, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [id, userId, appId, keyName, encrypted, new Date().toISOString()]
  });
}

async function getSecrets(userId, appId) {
  const result = await turso.execute({
    sql: 'SELECT key_name, key_value FROM secrets WHERE user_id = ? AND app_id = ?',
    args: [userId, appId]
  });
  return result.rows.map(r => ({
    name: r.key_name,
    value: Buffer.from(r.key_value, 'base64').toString()
  }));
}

// ── HELPERS ──

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

module.exports = {
  supabase,
  turso,
  setupDatabase,
  saveApp,
  getApp,
  getUserApps,
  updateAppCode,
  publishApp,
  getAppBySubdomain,
  checkSubdomainAvailable,
  incrementViews,
  getUser,
  updateUserPlan,
  getUserCredits,
  saveSecret,
  getSecrets
};
