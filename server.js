// ═══════════════════════════════════════════════════════════════
// JOSJIS98 BACKEND SERVER
// Express + Dual-mode Database (JSON local / PostgreSQL production)
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve static files
const staticDir = path.join(__dirname, '..', 'JOSJIS98');
app.use(express.static(staticDir));

// ═══════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// ── INIT ──
app.get('/api/init', async (req, res) => {
  try { res.json(await db.readAll()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SYNC USERS ──
app.post('/api/sync/users', async (req, res) => {
  try { await db.syncUsers(req.body); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SYNC DEPOSITS ──
app.post('/api/sync/deposits', async (req, res) => {
  try { await db.saveDeposits(req.body); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SYNC WITHDRAWS ──
app.post('/api/sync/withdraws', async (req, res) => {
  try { await db.saveWithdraws(req.body); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SYNC CODES ──
app.post('/api/sync/codes', async (req, res) => {
  try { await db.saveCodes(req.body); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN LOGIN ──
app.post('/api/admin/login', async (req, res) => {
  try {
    const pwd = await db.getAdminPassword();
    if (req.body.password === pwd) res.json({ success: true });
    else res.status(401).json({ success: false, error: 'Password salah!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: users ──
app.get('/api/admin/users', async (req, res) => {
  try { res.json({ users: await db.getAllUsers() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/balance', async (req, res) => {
  try {
    const { username, amount, action } = req.body;
    await db.adjustUserBalance(username, amount, action, action === 'add' ? 'Admin add via server' : 'Admin remove via server');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/delete', async (req, res) => {
  try { await db.deleteUser(req.body.username); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: deposits ──
app.post('/api/admin/deposits/approve', async (req, res) => {
  try { await db.approveDeposit(req.body.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/deposits/reject', async (req, res) => {
  try { await db.rejectDeposit(req.body.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: withdraws ──
app.post('/api/admin/withdraws/approve', async (req, res) => {
  try { await db.approveWithdraw(req.body.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/withdraws/reject', async (req, res) => {
  try { await db.rejectWithdraw(req.body.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: codes ──
app.post('/api/admin/codes/generate', async (req, res) => {
  try {
    const { code, amount } = req.body;
    if (!code || !amount) return res.status(400).json({ error: 'Code and amount required' });
    await db.generateCode(code, amount);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/codes/delete', async (req, res) => {
  try { await db.deleteCode(req.body.code); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: bank info ──
app.post('/api/admin/bank', async (req, res) => {
  try {
    await db.updateAdminBank(req.body.bank_name, req.body.bank_number);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: stats ──
app.get('/api/admin/stats', async (req, res) => {
  try { res.json(await db.getStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════

async function start() {
  await db.init();

  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║        JOSJIS98 BACKEND SERVER          ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  🌐 Server:  http://localhost:${PORT}        ║`);
    console.log(`║  🎮 Situs:   http://localhost:${PORT}/       ║`);
    console.log(`║  👑 Admin:   http://localhost:${PORT}/admin.html ║`);
    console.log(`║  📁 DB Mode: ${db.mode.toUpperCase()}${db.IS_ACTIVE_PG ? ' (Supabase)' : ' (JSON file)'}`);
    if (db.IS_ACTIVE_PG) {
      console.log('║  ☁️  Database terhubung ke Supabase!   ║');
    }
    console.log('╚══════════════════════════════════════════╝');
    console.log('');
    console.log('📢 Buka http://localhost:' + PORT + ' di browser!');
    console.log('');
  });
}

start().catch(e => {
  console.error('❌ Failed to start server:', e);
  process.exit(1);
});
