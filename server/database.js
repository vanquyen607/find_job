const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, 'findjob.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = null;
let dbReady = null;

async function initDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  initSchema();
  saveDb();
  console.log('[DB] SQLite (sql.js) initialized');
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function getDb() {
  return db;
}

function ensureReady() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
}

function initSchema() {
  ensureReady();
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT DEFAULT 'user',
      avatar_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      company TEXT,
      location TEXT,
      salary TEXT,
      experience TEXT,
      description TEXT,
      requirements TEXT,
      url TEXT UNIQUE,
      platform TEXT NOT NULL,
      skills TEXT,
      scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS saved_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      job_id INTEGER NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      UNIQUE(user_id, job_id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      keyword TEXT NOT NULL,
      results_count INTEGER,
      searched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  try { db.run('CREATE INDEX IF NOT EXISTS idx_jobs_platform ON jobs(platform)'); } catch(e) {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_jobs_scraped ON jobs(scraped_at)'); } catch(e) {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_jobs(user_id)'); } catch(e) {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_search_user ON search_history(user_id)'); } catch(e) {}

  createDefaultAdmin();
}

function queryAll(sql, params = []) {
  ensureReady();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  ensureReady();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

function runSql(sql, params = []) {
  ensureReady();
  db.run(sql, params);
  const lastId = db.exec('SELECT last_insert_rowid() as id');
  return {
    changes: db.getRowsModified(),
    lastInsertRowid: lastId.length > 0 ? lastId[0].values[0][0] : 0
  };
}

// ==================== USER OPERATIONS ====================
function createUser(email, password, name) {
  const passwordHash = bcrypt.hashSync(password, 10);
  const result = runSql(
    'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
    [email, passwordHash, name]
  );
  saveDb();
  return { id: result.lastInsertRowid, email, name };
}

function getUserByEmail(email) {
  return queryOne('SELECT * FROM users WHERE email = ?', [email]);
}

function getUserById(id) {
  return queryOne('SELECT id, email, name, role, avatar_url, created_at FROM users WHERE id = ?', [id]);
}

function getAllUsers() {
  return queryAll('SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC');
}

function updateUserRole(id, role) {
  runSql('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [role, id]);
  saveDb();
  return getUserById(id);
}

function deleteUser(id) {
  runSql('DELETE FROM users WHERE id = ?', [id]);
  saveDb();
}

function createDefaultAdmin() {
  const adminEmail = 'admin@findjob.vn';
  const adminPassword = 'admin123';
  const existing = getUserByEmail(adminEmail);
  if (!existing) {
    const passwordHash = bcrypt.hashSync(adminPassword, 10);
    runSql(
      'INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)',
      [adminEmail, passwordHash, 'Admin', 'admin']
    );
    saveDb();
    console.log(`[DB] Created default admin: ${adminEmail} / ${adminPassword}`);
  }
}

function updateUser(id, updates) {
  const fields = [];
  const values = [];
  if (updates.name) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.avatar_url) {
    fields.push('avatar_url = ?');
    values.push(updates.avatar_url);
  }
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  runSql(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
  saveDb();
  return getUserById(id);
}

function verifyPassword(plainPassword, hash) {
  return bcrypt.compareSync(plainPassword, hash);
}

// ==================== JOB OPERATIONS ====================
function saveJobs(jobs) {
  ensureReady();
  let saved = 0;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO jobs (title, company, location, salary, experience, description, requirements, url, platform, skills, scraped_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, datetime('now', '+6 hours'))
  `);
  for (const job of jobs) {
    try {
      stmt.run([
        job.title,
        job.company || '',
        job.location || '',
        job.salary || '',
        job.experience || '',
        job.description || '',
        job.requirements || '',
        job.url || '',
        job.platform,
        job.skills || ''
      ]);
      saved++;
    } catch (e) {
      // Skip duplicates
    }
  }
  stmt.free();
  saveDb();
  return saved;
}

function searchJobs(keyword, platform = null) {
  const searchPattern = `%${keyword}%`;
  let query = `
    SELECT * FROM jobs
    WHERE (title LIKE ? OR company LIKE ? OR description LIKE ? OR skills LIKE ?)
    AND (expires_at IS NULL OR expires_at > datetime('now'))
  `;
  const params = [searchPattern, searchPattern, searchPattern, searchPattern];
  if (platform) {
    query += ' AND platform = ?';
    params.push(platform);
  }
  query += ' ORDER BY scraped_at DESC LIMIT 100';
  return queryAll(query, params);
}

function getJobByUrl(url) {
  return queryOne('SELECT * FROM jobs WHERE url = ?', [url]);
}

// ==================== SAVED JOBS OPERATIONS ====================
function saveJobForUser(userId, jobId, notes = null) {
  try {
    const result = runSql(
      'INSERT INTO saved_jobs (user_id, job_id, notes) VALUES (?, ?, ?)',
      [userId, jobId, notes]
    );
    saveDb();
    return { id: result.lastInsertRowid };
  } catch (e) {
    if (String(e).includes('UNIQUE') || String(e).includes('constraint')) {
      return null;
    }
    throw e;
  }
}

function removeSavedJob(userId, jobId) {
  runSql('DELETE FROM saved_jobs WHERE user_id = ? AND job_id = ?', [userId, jobId]);
  saveDb();
}

function getSavedJobs(userId) {
  return queryAll(`
    SELECT j.*, sj.notes, sj.created_at as saved_at
    FROM saved_jobs sj
    JOIN jobs j ON j.id = sj.job_id
    WHERE sj.user_id = ?
    ORDER BY sj.created_at DESC
  `, [userId]);
}

function isJobSaved(userId, jobId) {
  const result = queryOne('SELECT 1 FROM saved_jobs WHERE user_id = ? AND job_id = ?', [userId, jobId]);
  return !!result;
}

// ==================== SEARCH HISTORY ====================
function saveSearchHistory(userId, keyword, resultsCount) {
  runSql(
    'INSERT INTO search_history (user_id, keyword, results_count) VALUES (?, ?, ?)',
    [userId, keyword, resultsCount]
  );
  saveDb();
}

function getSearchHistory(userId, limit = 20) {
  return queryAll(
    'SELECT * FROM search_history WHERE user_id = ? ORDER BY searched_at DESC LIMIT ?',
    [userId, limit]
  );
}

// ==================== CLEANUP ====================
function cleanupExpiredJobs() {
  runSql("DELETE FROM jobs WHERE expires_at < datetime('now')");
  saveDb();
}

function closeDb() {
  if (db) {
    saveDb();
    db.close();
    db = null;
  }
}

module.exports = {
  initDb,
  getDb,
  createUser,
  getUserByEmail,
  getUserById,
  updateUser,
  verifyPassword,
  saveJobs,
  searchJobs,
  getJobByUrl,
  saveJobForUser,
  removeSavedJob,
  getSavedJobs,
  isJobSaved,
  saveSearchHistory,
  getSearchHistory,
  cleanupExpiredJobs,
  closeDb,
  getAllUsers,
  updateUserRole,
  deleteUser
};
