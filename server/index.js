require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { scrapeAll, scrapeJobDetail, closeBrowser } = require('./scrapers');
const { handleCvUpload } = require('./cv');
const {
  createRateLimiter,
  isAllowedJobUrl,
  isUrlForPlatform,
  sanitizeText
} = require('./security');

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
  methods: ['GET'],
  allowedHeaders: ['Content-Type']
}));

// CV upload route: the JSON body carries a base64 file (up to ~7MB), so it
// has its own parser and is registered before the global 256kb parser.
// The file is processed in memory only and never stored.
const cvLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.'
});
app.post('/api/cv-match', express.json({ limit: '8mb' }), cvLimiter, async (req, res) => {
  const { filename, data } = req.body || {};
  if (typeof data !== 'string' || !data) {
    return res.status(400).json({ error: 'Thiếu nội dung file CV' });
  }
  console.log(`[CV] Upload: ${sanitizeText(String(filename || ''), 120)} from ${req.ip}`);
  try {
    const result = await withTimeout(
      handleCvUpload({ filename, dataBase64: data }),
      120000,
      'CV match'
    );
    console.log(`[CV] Queries: ${result.queries.join(' | ')} -> ${result.jobs.length} matched jobs`);
    res.json({ ...result, total: result.jobs.length });
  } catch (err) {
    console.error('[CV] Error:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Không xử lý được CV. Vui lòng thử lại.' });
  }
});

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '../public')));

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
// No accounts, no database: the site is open-access and stateless.
// Saved jobs live in each visitor's browser (localStorage).

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/api/search', searchLimiter, async (req, res) => {
  const q = typeof req.query.q === 'string' ? sanitizeText(req.query.q, 100) : '';
  const location = typeof req.query.location === 'string' ? sanitizeText(req.query.location, 40) : '';

  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Vui lòng nhập từ khóa tìm kiếm (ít nhất 2 ký tự)' });
  }

  console.log(`[SEARCH] Query: "${q}"${location ? ` @ ${location}` : ''} from ${req.ip}`);

  try {
    const startTime = Date.now();
    const jobs = await withTimeout(scrapeAll(q, location), 90000, 'Search API');
    const duration = Date.now() - startTime;

    console.log(`[SEARCH] Found ${jobs.length} jobs in ${duration}ms`);
    res.json({ jobs, total: jobs.length, duration, cached: false, location: location || null });
  } catch (error) {
    console.error('[ERROR]', error.message);
    res.status(500).json({ error: 'Có lỗi xảy ra khi tìm kiếm. Vui lòng thử lại.' });
  }
});

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
  console.log('[SHUTDOWN] Browser closed. Exiting.');
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
app.listen(PORT, () => {
  console.log(`
    ╔══════════════════════════════════════════════╗
    ║   FindJob Server v2.0 (open, stateless)      ║
    ║   Port: ${PORT}                                 ║
    ║   URL: http://localhost:${PORT}                  ║
    ║   Cache: 30 min TTL                          ║
    ║   Search limit: 10 req/min                   ║
    ╚══════════════════════════════════════════════╝
    `);
});
