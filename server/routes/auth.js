const express = require('express');
const router = express.Router();
const { createUser, getUserByEmail, verifyPassword } = require('../database');
const { generateToken, requireAuth } = require('../auth');
const {
  createRateLimiter,
  normalizeEmail,
  isValidEmail,
  isValidPassword,
  sanitizeText
} = require('../security');

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  keyGenerator: (req) => `${req.ip}:${normalizeEmail(req.body?.email)}`,
  message: 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.',
  skipSuccessfulRequests: true
});

const loginIpLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.'
});

const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Bạn đã tạo quá nhiều tài khoản. Vui lòng thử lại sau.'
});

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role || 'user' };
}

// POST /api/auth/register
router.post('/register', registerLimiter, (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;
  const name = sanitizeText(req.body?.name, 80) || email.split('@')[0];

  if (!email || !password) {
    return res.status(400).json({ error: 'Email và mật khẩu là bắt buộc' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Email không hợp lệ' });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Mật khẩu phải có từ 8 đến 128 ký tự' });
  }

  const existing = getUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'Email đã được sử dụng' });
  }

  try {
    const user = createUser(email, password, name);
    const token = generateToken(user);

    res.status(201).json({ token, user: publicUser(user) });
  } catch (error) {
    console.error('[AUTH] Register error:', error.message);
    res.status(500).json({ error: 'Đăng ký thất bại' });
  }
});

// POST /api/auth/login
router.post('/login', loginIpLimiter, loginLimiter, (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email và mật khẩu là bắt buộc' });
  }

  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
  }

  const token = generateToken(user);
  res.json({ token, user: publicUser(user) });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// PUT /api/auth/profile
router.put('/profile', requireAuth, (req, res) => {
  const { updateUser: update } = require('../database');
  const name = sanitizeText(req.body?.name, 80);

  if (!name) {
    return res.status(400).json({ error: 'Tên không hợp lệ' });
  }

  try {
    const updated = update(req.user.id, { name });
    res.json({ user: publicUser(updated) });
  } catch (error) {
    console.error('[AUTH] Profile update error:', error.message);
    res.status(500).json({ error: 'Cập nhật thất bại' });
  }
});

module.exports = router;
