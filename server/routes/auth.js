const express = require('express');
const router = express.Router();
const { createUser, getUserByEmail, verifyPassword, getUserById } = require('../database');
const { generateToken, requireAuth } = require('../auth');

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { email, password, name } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email và password là bắt buộc' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password phải có ít nhất 6 ký tự' });
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Email không hợp lệ' });
  }
  
  const existing = getUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'Email đã được sử dụng' });
  }
  
  try {
    const user = createUser(email, password, name || email.split('@')[0]);
    const token = generateToken(user);
    
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (error) {
    console.error('[AUTH] Register error:', error);
    res.status(500).json({ error: 'Đăng ký thất bại' });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email và password là bắt buộc' });
  }
  
  const user = getUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'Email hoặc password không đúng' });
  }
  
  if (!verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email hoặc password không đúng' });
  }
  
  const token = generateToken(user);
  
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name }
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// PUT /api/auth/profile
router.put('/profile', requireAuth, (req, res) => {
  const { updateUser: update } = require('../database');
  const { name } = req.body;
  
  try {
    const updated = update(req.user.id, { name });
    res.json({ user: updated });
  } catch (error) {
    console.error('[AUTH] Profile update error:', error);
    res.status(500).json({ error: 'Cập nhật thất bại' });
  }
});

module.exports = router;
