const PLATFORM_HOSTS = {
  vietnamworks: ['vietnamworks.com'],
  careerviet: ['careerviet.vn'],
  itviec: ['itviec.com'],
  glints: ['glints.com'],
  topcv: ['topcv.vn'],
  chotot: ['chotot.com'],
  topdev: ['topdev.vn']
};

const ALLOWED_HOSTS = Object.values(PLATFORM_HOSTS).flat();

function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function parseHttpUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isAllowedJobUrl(raw) {
  const url = parseHttpUrl(raw);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOSTS.some((domain) => hostMatches(host, domain));
}

function isUrlForPlatform(raw, platform) {
  const url = parseHttpUrl(raw);
  if (!url || !platform) return false;
  const domains = PLATFORM_HOSTS[String(platform).toLowerCase()];
  if (!domains) return false;
  const host = url.hostname.toLowerCase();
  return domains.some((domain) => hostMatches(host, domain));
}

function sanitizeText(value, maxLength = 500) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
}

function normalizeEmail(email) {
  return sanitizeText(email, 254).toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Simple in-memory fixed-window rate limiter.
 * Suitable for a single-instance deployment; for multi-instance use a shared store.
 */
function createRateLimiter(options = {}) {
  const {
    windowMs = 60 * 1000,
    max = 10,
    keyGenerator = (req) => req.ip,
    message = 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
    skipSuccessfulRequests = false
  } = options;

  const hits = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, Math.max(windowMs, 60 * 1000));
  if (typeof cleanup.unref === 'function') cleanup.unref();

  return function rateLimiter(req, res, next) {
    const key = keyGenerator(req);
    const now = Date.now();
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    if (entry.count >= max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message, retryAfter });
    }

    entry.count += 1;

    if (skipSuccessfulRequests) {
      res.on('finish', () => {
        const current = hits.get(key);
        if (!current) return;
        if (res.statusCode < 400) current.count = Math.max(0, current.count - 1);
      });
    }

    next();
  };
}

module.exports = {
  PLATFORM_HOSTS,
  ALLOWED_HOSTS,
  isAllowedJobUrl,
  isUrlForPlatform,
  parseHttpUrl,
  sanitizeText,
  normalizeEmail,
  isValidEmail,
  isValidPassword,
  toPositiveInt,
  createRateLimiter
};
