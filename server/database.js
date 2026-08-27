const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'findjob.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT DEFAULT 'user',
      avatar_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
    );

    CREATE TABLE IF NOT EXISTS saved_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      job_id INTEGER NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      UNIQUE(user_id, job_id)
    );

    CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      keyword TEXT NOT NULL,
      results_count INTEGER,
      searched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_platform ON jobs(platform);
    CREATE INDEX IF NOT EXISTS idx_jobs_scraped ON jobs(scraped_at);
    CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_search_user ON search_history(user_id);
  `);
  
  // Create default admin account
  createDefaultAdmin();
}

// ==================== USER OPERATIONS ====================
function createUser(email, password, name) {
  const db = getDb();
  const passwordHash = bcrypt.hashSync(password, 10);
  
  const stmt = db.prepare(`
    INSERT INTO users (email, password_hash, name)
    VALUES (?, ?, ?)
  `);
  
  const result = stmt.run(email, passwordHash, name);
  return { id: result.lastInsertRowid, email, name };
}

function getUserByEmail(email) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserById(id) {
  const db = getDb();
  return db.prepare('SELECT id, email, name, role, avatar_url, created_at FROM users WHERE id = ?').get(id);
}

function getAllUsers() {
  const db = getDb();
  return db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC').all();
}

function updateUserRole(id, role) {
  const db = getDb();
  db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(role, id);
  return getUserById(id);
}

function deleteUser(id) {
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

// Create default admin account
function createDefaultAdmin() {
  const adminEmail = 'admin@findjob.vn';
  const adminPassword = 'admin123';
  
  const existing = getUserByEmail(adminEmail);
  if (!existing) {
    const passwordHash = bcrypt.hashSync(adminPassword, 10);
    db.prepare(`
      INSERT INTO users (email, password_hash, name, role)
      VALUES (?, ?, ?, ?)
    `).run(adminEmail, passwordHash, 'Admin', 'admin');
    console.log(`[DB] Created default admin: ${adminEmail} / ${adminPassword}`);
  }
}

function updateUser(id, updates) {
  const db = getDb();
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
  
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getUserById(id);
}

function verifyPassword(plainPassword, hash) {
  return bcrypt.compareSync(plainPassword, hash);
}

// ==================== JOB OPERATIONS ====================
function saveJobs(jobs) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO jobs (title, company, location, salary, experience, description, requirements, url, platform, skills, scraped_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, datetime('now', '+6 hours'))
  `);
  
  const insertMany = db.transaction((jobs) => {
    let saved = 0;
    for (const job of jobs) {
      try {
        stmt.run(
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
        );
        saved++;
      } catch (e) {
        // Skip duplicates
      }
    }
    return saved;
  });
  
  return insertMany(jobs);
}

function searchJobs(keyword, platform = null) {
  const db = getDb();
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
  
  return db.prepare(query).all(...params);
}

function getJobByUrl(url) {
  const db = getDb();
  return db.prepare('SELECT * FROM jobs WHERE url = ?').get(url);
}

// ==================== SAVED JOBS OPERATIONS ====================
function saveJobForUser(userId, jobId, notes = null) {
  const db = getDb();
  try {
    const result = db.prepare(`
      INSERT INTO saved_jobs (user_id, job_id, notes)
      VALUES (?, ?, ?)
    `).run(userId, jobId, notes);
    return { id: result.lastInsertRowid };
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return null; // Already saved
    }
    throw e;
  }
}

function removeSavedJob(userId, jobId) {
  const db = getDb();
  return db.prepare('DELETE FROM saved_jobs WHERE user_id = ? AND job_id = ?').run(userId, jobId);
}

function getSavedJobs(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT j.*, sj.notes, sj.created_at as saved_at
    FROM saved_jobs sj
    JOIN jobs j ON j.id = sj.job_id
    WHERE sj.user_id = ?
    ORDER BY sj.created_at DESC
  `).all(userId);
}

function isJobSaved(userId, jobId) {
  const db = getDb();
  return !!db.prepare('SELECT 1 FROM saved_jobs WHERE user_id = ? AND job_id = ?').get(userId, jobId);
}

// ==================== SEARCH HISTORY ====================
function saveSearchHistory(userId, keyword, resultsCount) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO search_history (user_id, keyword, results_count)
    VALUES (?, ?, ?)
  `).run(userId, keyword, resultsCount);
}

function getSearchHistory(userId, limit = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM search_history
    WHERE user_id = ?
    ORDER BY searched_at DESC
    LIMIT ?
  `).all(userId, limit);
}

// ==================== CLEANUP ====================
function cleanupExpiredJobs() {
  const db = getDb();
  return db.prepare("DELETE FROM jobs WHERE expires_at < datetime('now')").run();
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
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
