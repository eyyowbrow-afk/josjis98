// ═══════════════════════════════════════════════════════════════
// JOSJIS98 DATABASE MODULE
// Dual-mode: JSON file (local) or PostgreSQL (production/Supabase)
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

// ── PILIH MODE ──
const DATABASE_URL = process.env.DATABASE_URL;
const USE_POSTGRES = !!DATABASE_URL;

// ── DEFAULT DATA (sama untuk kedua mode) ──
const DEFAULT_DATA = {
  users: {},
  deposit_requests: [],
  withdraw_requests: [],
  custom_codes: {
    'ZEUS10': 10000,
    'OLYMPUS': 50000,
    'THUNDER': 100000,
    'GOLD99': 25000,
    'WELCOME': 50000,
    'MEGA': 100000
  },
  admin: {
    password: 'josjis98admin',
    bank_name: 'Bank Jago',
    bank_number: '1017 3748 1259'
  }
};

// ═══════════════════════════════════════════════════════════════
// MODE 1: JSON FILE DATABASE (local development)
// ═══════════════════════════════════════════════════════════════

const DB_PATH = path.join(__dirname, 'database.json');

let jsonDbLock = false;
const jsonLockQueue = [];

function acquireJsonLock() {
  return new Promise((resolve) => {
    if (!jsonDbLock) {
      jsonDbLock = true;
      resolve();
    } else {
      jsonLockQueue.push(resolve);
    }
  });
}

function releaseJsonLock() {
  if (jsonLockQueue.length > 0) {
    const next = jsonLockQueue.shift();
    next();
  } else {
    jsonDbLock = false;
  }
}

function readJsonDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('[DB] Error reading JSON database:', e.message);
  }
  const fresh = JSON.parse(JSON.stringify(DEFAULT_DATA));
  writeJsonDB(fresh);
  return fresh;
}

function writeJsonDB(data) {
  try {
    if (fs.existsSync(DB_PATH)) {
      fs.copyFileSync(DB_PATH, DB_PATH + '.backup');
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[DB] Error writing JSON database:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// MODE 2: POSTGRESQL DATABASE (production via Supabase)
// ═══════════════════════════════════════════════════════════════

let pgPool = null;
let pgInitialized = false;

async function initPostgres() {
  if (pgInitialized) return;
  try {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });

    // Test connection
    const client = await pgPool.connect();
    console.log('[DB] ✅ PostgreSQL connected to Supabase');

    // Run migration
    await runMigration(client);
    client.release();

    pgInitialized = true;
    console.log('[DB] ✅ PostgreSQL initialized successfully');
  } catch (e) {
    console.error('[DB] ❌ PostgreSQL initialization failed:', e.message);
    console.error('[DB] Falling back to JSON file database');
    pgPool = null;
    USE_POSTGRES = false;
  }
}

async function runMigration(client) {
  const schema = `
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT DEFAULT '',
      balance BIGINT DEFAULT 0,
      daily TEXT DEFAULT '',
      history TEXT DEFAULT '[]'::text,
      txns TEXT DEFAULT '[]'::text,
      rps_wins INTEGER DEFAULT 0,
      rps_losses INTEGER DEFAULT 0,
      rps_draws INTEGER DEFAULT 0,
      games TEXT DEFAULT '{}'::text,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Deposit requests
    CREATE TABLE IF NOT EXISTS deposit_requests (
      id BIGINT PRIMARY KEY,
      username TEXT NOT NULL,
      amount BIGINT DEFAULT 0,
      koin BIGINT DEFAULT 0,
      sender TEXT DEFAULT '',
      kode TEXT DEFAULT '',
      time TEXT DEFAULT '',
      status TEXT DEFAULT 'pending'
    );

    -- Withdraw requests
    CREATE TABLE IF NOT EXISTS withdraw_requests (
      id BIGINT PRIMARY KEY,
      username TEXT NOT NULL,
      amount BIGINT DEFAULT 0,
      method TEXT DEFAULT '',
      account TEXT DEFAULT '',
      account_name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      bank TEXT DEFAULT '',
      time TEXT DEFAULT '',
      status TEXT DEFAULT 'pending'
    );

    -- Custom codes
    CREATE TABLE IF NOT EXISTS custom_codes (
      code TEXT PRIMARY KEY,
      amount BIGINT DEFAULT 0
    );

    -- Admin settings
    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `;

  await client.query(schema);

  // Seed default codes
  const codes = DEFAULT_DATA.custom_codes;
  for (const [code, amount] of Object.entries(codes)) {
    await client.query(
      `INSERT INTO custom_codes (code, amount) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
      [code, amount]
    );
  }

  // Seed admin password
  await client.query(
    `INSERT INTO admin_settings (key, value) VALUES ('password', $1) ON CONFLICT (key) DO NOTHING`,
    [DEFAULT_DATA.admin.password]
  );
  await client.query(
    `INSERT INTO admin_settings (key, value) VALUES ('bank_name', $1) ON CONFLICT (key) DO NOTHING`,
    [DEFAULT_DATA.admin.bank_name]
  );
  await client.query(
    `INSERT INTO admin_settings (key, value) VALUES ('bank_number', $1) ON CONFLICT (key) DO NOTHING`,
    [DEFAULT_DATA.admin.bank_number]
  );

  console.log('[DB] ✅ Migration completed');
}

// ── PostgreSQL helpers ──

async function pgGetAll(table) {
  const { rows } = await pgPool.query(`SELECT * FROM ${table}`);
  return rows;
}

async function pgGetById(table, idField, id) {
  const { rows } = await pgPool.query(`SELECT * FROM ${table} WHERE ${idField} = $1`, [id]);
  return rows[0];
}

async function pgSet(table, data, conflictField, conflictValue) {
  // Simple upsert by deleting and inserting
  if (conflictField && conflictValue) {
    await pgPool.query(`DELETE FROM ${table} WHERE ${conflictField} = $1`, [conflictValue]);
  }
  const fields = Object.keys(data);
  const values = Object.values(data);
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  await pgPool.query(
    `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`,
    values
  );
}

async function pgDelete(table, field, value) {
  await pgPool.query(`DELETE FROM ${table} WHERE ${field} = $1`, [value]);
}

// ═══════════════════════════════════════════════════════════════
// EXPORTED INTERFACE (sama untuk kedua mode)
// ═══════════════════════════════════════════════════════════════

const db = {
  mode: USE_POSTGRES ? 'postgresql' : 'json',

  async init() {
    if (USE_POSTGRES) {
      await initPostgres();
    } else {
      // Ensure JSON database exists
      if (!fs.existsSync(DB_PATH)) {
        writeJsonDB(JSON.parse(JSON.stringify(DEFAULT_DATA)));
        console.log('[DB] ✅ JSON database created at:', DB_PATH);
      }
      console.log('[DB] ✅ JSON database mode (local development)');
    }
  },

  // ── USERS ──
  async getAllUsers() {
    if (pgPool) {
      const rows = await pgGetAll('users');
      const users = {};
      for (const row of rows) {
        users[row.username] = {
          username: row.username,
          password: row.password,
          balance: row.balance,
          daily: row.daily,
          history: safeJsonParse(row.history, []),
          txns: safeJsonParse(row.txns, []),
          rpsWins: row.rps_wins,
          rpsLosses: row.rps_losses,
          rpsDraws: row.rps_draws,
          games: safeJsonParse(row.games, {})
        };
      }
      return users;
    }
    return readJsonDB().users;
  },

  async saveAllUsers(users) {
    if (pgPool) {
      for (const [username, data] of Object.entries(users)) {
        await pgPool.query(`
          INSERT INTO users (username, password, balance, daily, history, txns, rps_wins, rps_losses, rps_draws, games)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (username) DO UPDATE SET
            password = EXCLUDED.password,
            balance = EXCLUDED.balance,
            daily = EXCLUDED.daily,
            history = EXCLUDED.history,
            txns = EXCLUDED.txns,
            rps_wins = EXCLUDED.rps_wins,
            rps_losses = EXCLUDED.rps_losses,
            rps_draws = EXCLUDED.rps_draws,
            games = EXCLUDED.games
        `, [
          username,
          data.password || '',
          data.balance || 0,
          data.daily || '',
          JSON.stringify(data.history || []),
          JSON.stringify(data.txns || []),
          data.rpsWins || 0,
          data.rpsLosses || 0,
          data.rpsDraws || 0,
          JSON.stringify(data.games || {})
        ]);
      }
      return;
    }
    const dbData = readJsonDB();
    dbData.users = users;
    writeJsonDB(dbData);
  },

  // ── DEPOSITS ──
  async getDeposits() {
    if (pgPool) {
      return await pgGetAll('deposit_requests');
    }
    return safeJsonParse(localStorage.getItem('josjis98_deposits')) || readJsonDB().deposit_requests;
  },

  ... wait, I shouldn't use localStorage in the server. Let me fix that for the JSON mode.

  Let me restructure the getDeposits and other functions for JSON mode.
};

Whoops, I'm making mistakes. Let me rewrite this file properly.<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="write_file">
<｜｜DSML｜｜parameter name="content" string="true">// ═══════════════════════════════════════════════════════════════
// JOSJIS98 DATABASE MODULE
// Dual-mode: JSON file (local dev) or PostgreSQL (production/Supabase)
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const IS_PG_MODE = !!DATABASE_URL;

// ── DEFAULT DATA ──
const DEFAULT_DATA = {
  users: {},
  deposit_requests: [],
  withdraw_requests: [],
  custom_codes: {
    ZEUS10: 10000, OLYMPUS: 50000, THUNDER: 100000,
    GOLD99: 25000, WELCOME: 50000, MEGA: 100000
  },
  admin: {
    password: 'josjis98admin',
    bank_name: 'Bank Jago',
    bank_number: '1017 3748 1259'
  }
};

// ═══════════════════════════════════════════════════════════════
// JSON FILE MODE
// ═══════════════════════════════════════════════════════════════

const DB_PATH = path.join(__dirname, 'database.json');
let jsonLock = false;
const jsonQueue = [];

function lockJson() {
  return new Promise(r => {
    if (!jsonLock) { jsonLock = true; r(); }
    else jsonQueue.push(r);
  });
}
function unlockJson() {
  if (jsonQueue.length > 0) jsonQueue.shift()();
  else jsonLock = false;
}

function readJson() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) { console.error('[DB] Error reading:', e.message); }
  const d = JSON.parse(JSON.stringify(DEFAULT_DATA));
  writeJson(d);
  return d;
}
function writeJson(d) {
  try {
    if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, DB_PATH + '.backup');
    fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2), 'utf8');
  } catch (e) { console.error('[DB] Error writing:', e.message); }
}
async function updateJson(fn) {
  await lockJson();
  try { const d = readJson(); fn(d); writeJson(d); return d; }
  finally { unlockJson(); }
}

// ═══════════════════════════════════════════════════════════════
// POSTGRESQL MODE (Supabase)
// ═══════════════════════════════════════════════════════════════

let pgPool = null;
let pgReady = false;

async function initPg() {
  if (pgReady) return;
  try {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000
    });
    // Test + migrate
    const client = await pgPool.connect();
    await migratePg(client);
    client.release();
    pgReady = true;
    console.log('[DB] ✅ PostgreSQL connected (Supabase)');
  } catch (e) {
    console.error('[DB] ❌ PostgreSQL failed:', e.message);
    console.error('[DB] Falling back to JSON file database');
    pgPool = null;
    // Override global IS_PG_MODE for this process
    module.exports.IS_ACTIVE_PG = false;
  }
}

async function migratePg(client) {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT DEFAULT '',
      balance BIGINT DEFAULT 0,
      daily TEXT DEFAULT '',
      history TEXT DEFAULT '[]',
      txns TEXT DEFAULT '[]',
      rps_wins INTEGER DEFAULT 0,
      rps_losses INTEGER DEFAULT 0,
      rps_draws INTEGER DEFAULT 0,
      games TEXT DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS deposit_requests (
      id BIGINT PRIMARY KEY,
      username TEXT NOT NULL,
      amount BIGINT DEFAULT 0,
      koin BIGINT DEFAULT 0,
      sender TEXT DEFAULT '',
      kode TEXT DEFAULT '',
      time TEXT DEFAULT '',
      status TEXT DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS withdraw_requests (
      id BIGINT PRIMARY KEY,
      username TEXT NOT NULL,
      amount BIGINT DEFAULT 0,
      method TEXT DEFAULT '',
      account TEXT DEFAULT '',
      account_name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      bank TEXT DEFAULT '',
      time TEXT DEFAULT '',
      status TEXT DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS custom_codes (
      code TEXT PRIMARY KEY,
      amount BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `;
  await client.query(sql);

  // Seed default codes
  for (const [code, amt] of Object.entries(DEFAULT_DATA.custom_codes)) {
    await client.query(
      `INSERT INTO custom_codes (code, amount) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
      [code, amt]
    );
  }
  // Seed admin settings
  await client.query(
    `INSERT INTO admin_settings (key, value) VALUES ('password', $1) ON CONFLICT (key) DO NOTHING`,
    [DEFAULT_DATA.admin.password]
  );
  await client.query(
    `INSERT INTO admin_settings (key, value) VALUES ('bank_name', $1) ON CONFLICT (key) DO NOTHING`,
    [DEFAULT_DATA.admin.bank_name]
  );
  await client.query(
    `INSERT INTO admin_settings (key, value) VALUES ('bank_number', $1) ON CONFLICT (key) DO NOTHING`,
    [DEFAULT_DATA.admin.bank_number]
  );
  console.log('[DB] ✅ Migration complete');
}

// ═══════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════════

function safeJson(v, fallback) {
  try { return JSON.parse(v); } catch(e) { return fallback; }
}

function mergeTxns(a, b) {
  const seen = new Set();
  const m = [];
  [...(a||[]), ...(b||[])].forEach(t => {
    const k = (t.type||'') + '_' + (t.amount||0) + '_' + (t.time||'') + '_' + (t.note||'');
    if (!seen.has(k)) { seen.add(k); m.push(t); }
  });
  m.sort((x,y) => new Date(y.time) - new Date(x.time));
  return m.slice(0, 200);
}

// ═══════════════════════════════════════════════════════════════
// EXPORTED DATABASE API
// ═══════════════════════════════════════════════════════════════

const db = {
  mode: 'json',
  IS_ACTIVE_PG: false,

  async init() {
    if (IS_PG_MODE) {
      this.mode = 'postgresql';
      await initPg();
      this.IS_ACTIVE_PG = !!pgPool;
      if (!pgPool) this.mode = 'json';
    } else {
      // Ensure JSON DB exists
      if (!fs.existsSync(DB_PATH)) {
        writeJson(JSON.parse(JSON.stringify(DEFAULT_DATA)));
      }
      console.log('[DB] ✅ JSON database mode (local)');
    }
  },

  // ── READ ALL DATA (for /api/init) ──
  async readAll() {
    if (pgPool) {
      const [users, deposits, withdraws, codes, pwd, bankName, bankNum] = await Promise.all([
        pgPool.query('SELECT * FROM users'),
        pgPool.query('SELECT * FROM deposit_requests'),
        pgPool.query('SELECT * FROM withdraw_requests'),
        pgPool.query('SELECT * FROM custom_codes'),
        pgPool.query("SELECT value FROM admin_settings WHERE key='password'"),
        pgPool.query("SELECT value FROM admin_settings WHERE key='bank_name'"),
        pgPool.query("SELECT value FROM admin_settings WHERE key='bank_number'")
      ]);
      const usersObj = {};
      for (const r of users.rows) {
        usersObj[r.username] = {
          username: r.username, password: r.password, balance: r.balance,
          daily: r.daily, history: safeJson(r.history, []), txns: safeJson(r.txns, []),
          rpsWins: r.rps_wins, rpsLosses: r.rps_losses, rpsDraws: r.rps_draws,
          games: safeJson(r.games, {})
        };
      }
      const codesObj = {};
      for (const r of codes.rows) codesObj[r.code] = r.amount;
      return {
        users: usersObj,
        deposits: deposits.rows.map(r => ({ ...r })),
        withdraws: withdraws.rows.map(r => ({ ...r })),
        codes: codesObj,
        bank: {
          password: pwd.rows[0]?.value || DEFAULT_DATA.admin.password,
          bank_name: bankName.rows[0]?.value || DEFAULT_DATA.admin.bank_name,
          bank_number: bankNum.rows[0]?.value || DEFAULT_DATA.admin.bank_number
        }
      };
    }
    const d = readJson();
    return {
      users: d.users, deposits: d.deposit_requests,
      withdraws: d.withdraw_requests, codes: d.custom_codes,
      bank: d.admin
    };
  },

  // ── SYNC USERS ──
  async syncUsers(newUsers) {
    if (pgPool) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        for (const [uname, u] of Object.entries(newUsers)) {
          // Baca txns existing dari server, merge dengan client txns
          const existing = await client.query('SELECT txns FROM users WHERE username=$1', [uname]);
          const serverTxns = existing.rows[0] ? safeJson(existing.rows[0].txns, []) : [];
          const mergedTxns = mergeTxns(serverTxns, u.txns || []);

          await client.query(`
            INSERT INTO users (username, password, balance, daily, history, txns, rps_wins, rps_losses, rps_draws, games)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (username) DO UPDATE SET
              password=EXCLUDED.password, balance=EXCLUDED.balance,
              daily=EXCLUDED.daily, history=EXCLUDED.history,
              txns=$11, rps_wins=EXCLUDED.rps_wins,
              rps_losses=EXCLUDED.rps_losses, rps_draws=EXCLUDED.rps_draws,
              games=EXCLUDED.games
          `, [
            uname, u.password||'', u.balance||0, u.daily||'',
            JSON.stringify(u.history||[]), JSON.stringify(mergedTxns),
            u.rpsWins||0, u.rpsLosses||0, u.rpsDraws||0,
            JSON.stringify(u.games||{}),
            JSON.stringify(mergedTxns)
          ]);
        }
        await client.query('COMMIT');
      } catch(e) {
        await client.query('ROLLBACK');
        throw e;
      } finally { client.release(); }
      return;
    }
    await updateJson(d => {
      for (const [uname, u] of Object.entries(newUsers)) {
        if (d.users[uname]) {
          d.users[uname] = { ...d.users[uname], ...u, txns: mergeTxns(d.users[uname].txns||[], u.txns||[]) };
        } else {
          d.users[uname] = u;
        }
      }
    });
  },

  // ── DEPOSITS ──
  async getDeposits() {
    if (pgPool) { const r = await pgPool.query('SELECT * FROM deposit_requests ORDER BY id DESC'); return r.rows; }
    return readJson().deposit_requests;
  },
  async saveDeposits(deps) {
    if (pgPool) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM deposit_requests');
        for (const d of deps) {
          await client.query(
            `INSERT INTO deposit_requests (id, username, amount, koin, sender, kode, time, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [d.id, d.username, d.amount||0, d.koin||0, d.sender||'', d.kode||'', d.time||'', d.status||'pending']
          );
        }
        await client.query('COMMIT');
      } catch(e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
      return;
    }
    await updateJson(d => { d.deposit_requests = deps; });
  },

  // ── WITHDRAWS ──
  async getWithdraws() {
    if (pgPool) { const r = await pgPool.query('SELECT * FROM withdraw_requests ORDER BY id DESC'); return r.rows; }
    return readJson().withdraw_requests;
  },
  async saveWithdraws(wds) {
    if (pgPool) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM withdraw_requests');
        for (const w of wds) {
          await client.query(
            `INSERT INTO withdraw_requests (id, username, amount, method, account, account_name, phone, bank, time, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [w.id, w.username, w.amount||0, w.method||'', w.account||'', w.account_name||'', w.phone||'', w.bank||'', w.time||'', w.status||'pending']
          );
        }
        await client.query('COMMIT');
      } catch(e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
      return;
    }
    await updateJson(d => { d.withdraw_requests = wds; });
  },

  // ── CODES ──
  async getCodes() {
    if (pgPool) {
      const r = await pgPool.query('SELECT * FROM custom_codes');
      const o = {};
      for (const c of r.rows) o[c.code] = c.amount;
      return o;
    }
    return readJson().custom_codes;
  },
  async saveCodes(codes) {
    if (pgPool) {
      await pgPool.query('DELETE FROM custom_codes');
      for (const [code, amount] of Object.entries(codes)) {
        await pgPool.query('INSERT INTO custom_codes (code, amount) VALUES ($1, $2)', [code, amount]);
      }
      return;
    }
    await updateJson(d => { d.custom_codes = codes; });
  },

  // ── ADMIN ──
  async getAdminPassword() {
    if (pgPool) { const r = await pgPool.query("SELECT value FROM admin_settings WHERE key='password'"); return r.rows[0]?.value || DEFAULT_DATA.admin.password; }
    return readJson().admin.password;
  },
  async getAdminBank() {
    if (pgPool) {
      const [name, num] = await Promise.all([
        pgPool.query("SELECT value FROM admin_settings WHERE key='bank_name'"),
        pgPool.query("SELECT value FROM admin_settings WHERE key='bank_number'")
      ]);
      return { bank_name: name.rows[0]?.value || DEFAULT_DATA.admin.bank_name, bank_number: num.rows[0]?.value || DEFAULT_DATA.admin.bank_number };
    }
    const a = readJson().admin;
    return { bank_name: a.bank_name, bank_number: a.bank_number };
  },
  async updateAdminBank(bank_name, bank_number) {
    if (pgPool) {
      if (bank_name) await pgPool.query("INSERT INTO admin_settings (key, value) VALUES ('bank_name', $1) ON CONFLICT (key) DO UPDATE SET value=$1", [bank_name]);
      if (bank_number) await pgPool.query("INSERT INTO admin_settings (key, value) VALUES ('bank_number', $1) ON CONFLICT (key) DO UPDATE SET value=$1", [bank_number]);
      return;
    }
    await updateJson(d => { if (bank_name) d.admin.bank_name = bank_name; if (bank_number) d.admin.bank_number = bank_number; });
  },

  // ── ADMIN: adjust user balance ──
  async adjustUserBalance(username, amount, action, note) {
    if (pgPool) {
      if (action === 'add') {
        await pgPool.query('UPDATE users SET balance = balance + $1 WHERE username = $2', [amount, username]);
      } else {
        await pgPool.query('UPDATE users SET balance = GREATEST(0, balance - $1) WHERE username = $2', [amount, username]);
      }
      // Add transaction log
      const user = await pgPool.query('SELECT txns FROM users WHERE username = $1', [username]);
      if (user.rows[0]) {
        const txns = safeJson(user.rows[0].txns, []);
        txns.unshift({
          type: action === 'add' ? 'deposit' : 'withdraw',
          amount: action === 'add' ? amount : -amount,
          time: new Date().toISOString(),
          note: note || 'Admin via server'
        });
        await pgPool.query('UPDATE users SET txns = $1 WHERE username = $2', [JSON.stringify(txns.slice(0, 200)), username]);
      }
      return;
    }
    await updateJson(d => {
      if (!d.users[username]) return;
      const u = d.users[username];
      if (action === 'add') u.balance = (u.balance||0) + amount;
      else u.balance = Math.max(0, (u.balance||0) - amount);
      u.txns = u.txns || [];
      u.txns.unshift({
        type: action === 'add' ? 'deposit' : 'withdraw',
        amount: action === 'add' ? amount : -amount,
        time: new Date().toISOString(),
        note: note || 'Admin via server'
      });
    });
  },

  // ── ADMIN: approve deposit ──
  async approveDeposit(depositId) {
    if (pgPool) {
      const dep = (await pgPool.query("SELECT * FROM deposit_requests WHERE id=$1 AND status='pending'", [depositId])).rows[0];
      if (!dep) return;
      await pgPool.query("UPDATE deposit_requests SET status='approved' WHERE id=$1", [depositId]);
      await this.adjustUserBalance(dep.username, dep.koin, 'add', 'Admin approve deposit via server');
      return;
    }
    await updateJson(d => {
      const dep = d.deposit_requests.find(x => x.id === depositId && x.status === 'pending');
      if (!dep) return;
      dep.status = 'approved';
      if (d.users[dep.username]) {
        d.users[dep.username].balance = (d.users[dep.username].balance||0) + dep.koin;
        d.users[dep.username].txns = d.users[dep.username].txns || [];
        d.users[dep.username].txns.unshift({ type:'deposit', amount:dep.koin, time:new Date().toISOString(), note:'Admin approve' });
      }
    });
  },

  // ── ADMIN: reject deposit ──
  async rejectDeposit(depositId) {
    if (pgPool) {
      await pgPool.query("UPDATE deposit_requests SET status='rejected' WHERE id=$1 AND status='pending'", [depositId]);
      return;
    }
    await updateJson(d => {
      const dep = d.deposit_requests.find(x => x.id === depositId && x.status === 'pending');
      if (dep) dep.status = 'rejected';
    });
  },

  // ── ADMIN: approve withdraw ──
  async approveWithdraw(withdrawId) {
    if (pgPool) {
      await pgPool.query("UPDATE withdraw_requests SET status='approved' WHERE id=$1 AND status='pending'", [withdrawId]);
      return;
    }
    await updateJson(d => {
      const wd = d.withdraw_requests.find(x => x.id === withdrawId && x.status === 'pending');
      if (wd) wd.status = 'approved';
    });
  },

  // ── ADMIN: reject withdraw ──
  async rejectWithdraw(withdrawId) {
    if (pgPool) {
      const wd = (await pgPool.query("SELECT * FROM withdraw_requests WHERE id=$1 AND status='pending'", [withdrawId])).rows[0];
      if (!wd) return;
      await pgPool.query("UPDATE withdraw_requests SET status='rejected' WHERE id=$1", [withdrawId]);
      await this.adjustUserBalance(wd.username, wd.amount, 'add', 'Admin reject withdraw');
      return;
    }
    await updateJson(d => {
      const wd = d.withdraw_requests.find(x => x.id === withdrawId && x.status === 'pending');
      if (!wd) return;
      wd.status = 'rejected';
      if (d.users[wd.username]) {
        d.users[wd.username].balance = (d.users[wd.username].balance||0) + wd.amount;
      }
    });
  },

  // ── ADMIN: delete user ──
  async deleteUser(username) {
    if (pgPool) {
      await pgPool.query('DELETE FROM users WHERE username=$1', [username]);
      return;
    }
    await updateJson(d => { delete d.users[username]; });
  },

  // ── ADMIN: generate code ──
  async generateCode(code, amount) {
    if (pgPool) {
      await pgPool.query('INSERT INTO custom_codes (code, amount) VALUES ($1, $2) ON CONFLICT (code) DO UPDATE SET amount=$2', [code.toUpperCase(), amount]);
      return;
    }
    await updateJson(d => { d.custom_codes[code.toUpperCase()] = amount; });
  },

  // ── ADMIN: delete code ──
  async deleteCode(code) {
    if (pgPool) {
      await pgPool.query('DELETE FROM custom_codes WHERE code=$1', [code]);
      return;
    }
    await updateJson(d => { delete d.custom_codes[code]; });
  },

  // ── STATS ──
  async getStats() {
    if (pgPool) {
      const [u, dp, wd, cd] = await Promise.all([
        pgPool.query('SELECT COUNT(*) FROM users'),
        pgPool.query("SELECT COUNT(*) FROM deposit_requests WHERE status='pending'"),
        pgPool.query("SELECT COUNT(*) FROM withdraw_requests WHERE status='pending'"),
        pgPool.query('SELECT COUNT(*) FROM custom_codes')
      ]);
      return {
        totalUsers: parseInt(u.rows[0].count),
        pendingDeposits: parseInt(dp.rows[0].count),
        pendingWithdraws: parseInt(wd.rows[0].count),
        totalCodes: parseInt(cd.rows[0].count)
      };
    }
    const d = readJson();
    return {
      totalUsers: Object.keys(d.users).length,
      pendingDeposits: d.deposit_requests.filter(x => x.status === 'pending').length,
      pendingWithdraws: d.withdraw_requests.filter(w => w.status === 'pending').length,
      totalCodes: Object.keys(d.custom_codes).length
    };
  }
};

module.exports = db;
