const express = require('express');
const router = express.Router();
const { getAllUsers, updateUserRole, deleteUser } = require('../database');
const { getMetrics } = require('../scrapers');
const { requireAuth, requireAdmin } = require('../auth');

// All routes require admin
router.use(requireAuth, requireAdmin);

// GET /api/admin/dashboard - Admin dashboard stats
router.get('/dashboard', (req, res) => {
  const users = getAllUsers();
  const metrics = getMetrics();
  
  res.json({
    totalUsers: users.length,
    users: users.slice(0, 10), // First 10 users
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
  const { id } = req.params;
  const { role } = req.body;
  
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role không hợp lệ' });
  }
  
  try {
    const user = updateUserRole(parseInt(id), role);
    res.json({ user, message: 'Cập nhật role thành công' });
  } catch (error) {
    res.status(500).json({ error: 'Cập nhật thất bại' });
  }
});

// DELETE /api/admin/users/:id - Delete user
router.delete('/users/:id', (req, res) => {
  const { id } = req.params;
  
  try {
    deleteUser(parseInt(id));
    res.json({ message: 'Xóa user thành công' });
  } catch (error) {
    res.status(500).json({ error: 'Xóa thất bại' });
  }
});

module.exports = router;
