const express = require('express');
const router = express.Router();
const {
  getAllUsers,
  getUserById,
  updateUserRole,
  deleteUser,
  countAdmins
} = require('../database');
const { getMetrics } = require('../scrapers');
const { requireAuth, requireAdmin } = require('../auth');
const { toPositiveInt } = require('../security');

// All routes require admin
router.use(requireAuth, requireAdmin);

// GET /api/admin/dashboard - Admin dashboard stats
router.get('/dashboard', (req, res) => {
  const users = getAllUsers();
  const metrics = getMetrics();

  res.json({
    totalUsers: users.length,
    users: users.slice(0, 10),
    metrics
  });
});

// GET /api/admin/users - Get all users
router.get('/users', (req, res) => {
  const users = getAllUsers();
  res.json({ users, total: users.length });
});

// PUT /api/admin/users/:id/role - Update user role
router.put('/users/:id/role', (req, res) => {
  const id = toPositiveInt(req.params.id);
  const role = req.body?.role;

  if (!id) {
    return res.status(400).json({ error: 'User ID không hợp lệ' });
  }

  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role không hợp lệ' });
  }

  const target = getUserById(id);
  if (!target) {
    return res.status(404).json({ error: 'User không tồn tại' });
  }

  if (id === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'Bạn không thể tự bỏ quyền admin' });
  }

  if (target.role === 'admin' && role !== 'admin' && countAdmins() <= 1) {
    return res.status(400).json({ error: 'Không thể bỏ quyền admin cuối cùng' });
  }

  try {
    const user = updateUserRole(id, role);
    res.json({ user, message: 'Cập nhật role thành công' });
  } catch (error) {
    console.error('[ADMIN] Update role error:', error.message);
    res.status(500).json({ error: 'Cập nhật thất bại' });
  }
});

// DELETE /api/admin/users/:id - Delete user
router.delete('/users/:id', (req, res) => {
  const id = toPositiveInt(req.params.id);

  if (!id) {
    return res.status(400).json({ error: 'User ID không hợp lệ' });
  }

  if (id === req.user.id) {
    return res.status(400).json({ error: 'Bạn không thể xóa chính mình' });
  }

  const target = getUserById(id);
  if (!target) {
    return res.status(404).json({ error: 'User không tồn tại' });
  }

  if (target.role === 'admin' && countAdmins() <= 1) {
    return res.status(400).json({ error: 'Không thể xóa admin cuối cùng' });
  }

  try {
    deleteUser(id);
    res.json({ message: 'Xóa user thành công' });
  } catch (error) {
    console.error('[ADMIN] Delete user error:', error.message);
    res.status(500).json({ error: 'Xóa thất bại' });
  }
});

module.exports = router;
