require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { scrapeAll, scrapeJobDetail, closeBrowser, getMetrics } = require('./scrapers');
const { extractUser } = require('./auth');
const { initDb, saveJobs, cleanupExpiredJobs, closeDb } = require('./database');

// Import routes
const authRoutes = require('./routes/auth');
const savedJobsRoutes = require('./routes/savedJobs');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== SECURITY MIDDLEWARE ====================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      mediaSrc: ["'self'", "https://d8j0ntlcm91z4.cloudfront.net"],
      connectSrc: ["'self'"],
    }
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS - restrict in production
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Extract user from token (optional - for all requests)
app.use(extractUser);

// ==================== RATE LIMITING ====================
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute

function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!rateLimit.has(ip)) {
    rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return next();
  }
  
  const limit = rateLimit.get(ip);
  if (now > limit.resetAt) {
    limit.count = 1;
    limit.resetAt = now + RATE_LIMIT_WINDOW;
    return next();
  }
  
  if (limit.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((limit.resetAt - now) / 1000);
    res.set('Retry-After', retryAfter);
    return res.status(429).json({ 
      error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
      retryAfter 
    });
  }
  
  limit.count++;
  next();
}

// Cleanup rate limit map periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, limit] of rateLimit.entries()) {
    if (now > limit.resetAt) rateLimit.delete(ip);
  }
}, 60000);

// ==================== ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Metrics
app.get('/api/metrics', (req, res) => {
  res.json(getMetrics());
});

// Search API
app.get('/api/search', rateLimiter, async (req, res) => {
  const { q } = req.query;

  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: 'Vui lòng nhập từ khóa tìm kiếm' });
  }

  if (q.trim().length < 2) {
    return res.status(400).json({ error: 'Từ khóa phải có ít nhất 2 ký tự' });
  }

  console.log(`[SEARCH] Query: "${q}" from ${req.ip}`);

  try {
    const startTime = Date.now();
    const jobs = await scrapeAll(q.trim());
    const duration = Date.now() - startTime;
    
    // Save jobs to database for future searches
    try {
      saveJobs(jobs);
    } catch (e) {
      console.error('[SEARCH] Failed to save jobs to DB:', e.message);
    }
    
    // Save search history if user is logged in
    if (req.user) {
      try {
        const { saveSearchHistory } = require('./database');
        saveSearchHistory(req.user.id, q.trim(), jobs.length);
      } catch (e) {
        console.error('[SEARCH] Failed to save search history:', e.message);
      }
    }
    
    console.log(`[SEARCH] Found ${jobs.length} jobs in ${duration}ms`);
    res.json({ 
      jobs, 
      total: jobs.length,
      duration,
      cached: false
    });
  } catch (error) {
    console.error('[ERROR]', error.message);
    res.status(500).json({ error: 'Có lỗi xảy ra khi tìm kiếm. Vui lòng thử lại.' });
  }
});

// Job Detail API
app.get('/api/job-detail', rateLimiter, async (req, res) => {
  const { url, platform } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log(`[DETAIL] URL: "${url}" Platform: "${platform}"`);

  try {
    const detail = await scrapeJobDetail(url, platform);
    res.json({ detail });
  } catch (error) {
    console.error('[DETAIL ERROR]', error.message);
    res.status(500).json({ error: 'Failed to fetch job details' });
  }
});

// ==================== AUTH & USER ROUTES ====================
app.use('/api/auth', authRoutes);
app.use('/api/saved-jobs', savedJobsRoutes);
app.use('/api/admin', adminRoutes);

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  console.error('[UNHANDLED ERROR]', err);
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
  app.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════════════╗
    ║   FindJob Server v1.0                        ║
    ║   Port: ${PORT}                                 ║
    ║   URL: http://localhost:${PORT}                  ║
    ║   Cache: 30 min TTL                          ║
    ║   Rate Limit: ${RATE_LIMIT_MAX} req/min              ║
    ╚══════════════════════════════════════════════╝
    `);
  });
}

start().catch(err => {
  console.error('[FATAL] Failed to start:', err);
  process.exit(1);
});
