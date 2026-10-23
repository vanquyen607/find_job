require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { scrapeAll, scrapeJobDetail, closeBrowser, getMetrics } = require('./scrapers');
const { extractUser, requireAuth, requireAdmin } = require('./auth');
const { initDb, saveJobs, saveSearchHistory, cleanupExpiredJobs, closeDb } = require('./database');
const {
  createRateLimiter,
  isAllowedJobUrl,
  isUrlForPlatform,
  sanitizeText
} = require('./security');

// Import routes
const authRoutes = require('./routes/auth');
const savedJobsRoutes = require('./routes/savedJobs');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
// Only trust the proxy when explicitly enabled; otherwise clients could spoof
// X-Forwarded-For and bypass IP-based rate limits.
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);

function withTimeout(promise, ms, name) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ==================== SECURITY MIDDLEWARE ====================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      mediaSrc: ["'self'", 'https://d8j0ntlcm91z4.cloudfront.net'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// CORS is disabled by default (same-origin frontend). Set CORS_ORIGIN to enable.
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({
  origin: corsOrigin || false,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Extract user from token (optional - for all requests)
app.use(extractUser);

// ==================== RATE LIMITING ====================
const searchLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.'
});

const detailLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.'
});

// ==================== ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Metrics (admin only)
app.get('/api/metrics', requireAuth, requireAdmin, (req, res) => {
  res.json(getMetrics());
});

// Search API
app.get('/api/search', searchLimiter, async (req, res) => {
  const q = typeof req.query.q === 'string' ? sanitizeText(req.query.q, 100) : '';

  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Vui lòng nhập từ khóa tìm kiếm (ít nhất 2 ký tự)' });
  }

  console.log(`[SEARCH] Query: "${q}" from ${req.ip}`);

  try {
    const startTime = Date.now();
    const jobs = await withTimeout(scrapeAll(q), 90000, 'Search API');
    const duration = Date.now() - startTime;

    try {
      saveJobs(jobs);
    } catch (e) {
      console.error('[SEARCH] Failed to save jobs to DB:', e.message);
    }

    if (req.user) {
      try {
        saveSearchHistory(req.user.id, q, jobs.length);
      } catch (e) {
        console.error('[SEARCH] Failed to save search history:', e.message);
      }
    }

    console.log(`[SEARCH] Found ${jobs.length} jobs in ${duration}ms`);
    res.json({ jobs, total: jobs.length, duration, cached: false });
  } catch (error) {
    console.error('[ERROR]', error.message);
    res.status(500).json({ error: 'Có lỗi xảy ra khi tìm kiếm. Vui lòng thử lại.' });
  }
});

// Job Detail API
app.get('/api/job-detail', detailLimiter, async (req, res) => {
  const url = typeof req.query.url === 'string' ? sanitizeText(req.query.url, 2048) : '';
  const platform = typeof req.query.platform === 'string'
    ? sanitizeText(req.query.platform, 40).toLowerCase()
    : '';

  if (!isAllowedJobUrl(url)) {
    return res.status(400).json({ error: 'Đường dẫn việc làm không hợp lệ' });
  }

  if (platform && !isUrlForPlatform(url, platform)) {
    return res.status(400).json({ error: 'Nền tảng không khớp với đường dẫn' });
  }

  console.log(`[DETAIL] URL: "${url}" Platform: "${platform}"`);

  try {
    const detail = await withTimeout(scrapeJobDetail(url, platform), 30000, 'Job detail');
    res.json({ detail });
  } catch (error) {
    console.error('[DETAIL ERROR]', error.message);
    res.status(500).json({ error: 'Không thể tải chi tiết việc làm' });
  }
});

// ==================== AUTH & USER ROUTES ====================
app.use('/api/auth', authRoutes);
app.use('/api/saved-jobs', savedJobsRoutes);
app.use('/api/admin', adminRoutes);

// Unknown API routes should return JSON, not the SPA shell
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint không tồn tại' });
});

// Serve frontend for page routes; missing static assets should be a real 404.
app.get('*', (req, res) => {
  if (path.extname(req.path)) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Dữ liệu JSON không hợp lệ' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn' });
  }
  console.error('[UNHANDLED ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ==================== GRACEFUL SHUTDOWN ====================
const shutdown = async (signal) => {
  console.log(`\n[SHUTDOWN] Received ${signal}. Starting graceful shutdown...`);
  await closeBrowser();
  closeDb();
  console.log('[SHUTDOWN] Browser and database closed. Exiting.');
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT]', err);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

// ==================== START SERVER ====================
async function start() {
  await initDb();

  try {
    const removed = cleanupExpiredJobs();
    console.log(`[DB] Expired jobs cleanup done (${removed} removed)`);
  } catch (e) {
    console.error('[DB] Cleanup failed:', e.message);
  }

  const cleanupTimer = setInterval(() => {
    try {
      cleanupExpiredJobs();
    } catch (e) {
      console.error('[DB] Scheduled cleanup failed:', e.message);
    }
  }, 60 * 60 * 1000);
  cleanupTimer.unref();

  app.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════════════╗
    ║   FindJob Server v1.0                        ║
    ║   Port: ${PORT}                                 ║
    ║   URL: http://localhost:${PORT}                  ║
    ║   Cache: 30 min TTL                          ║
    ║   Search limit: 10 req/min                   ║
    ╚══════════════════════════════════════════════╝
    `);
  });
}

start().catch(err => {
  console.error('[FATAL] Failed to start:', err);
  process.exit(1);
});
