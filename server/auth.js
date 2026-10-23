const jwt = require('jsonwebtoken');
const { getUserById } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET;
const WEAK_SECRETS = new Set([
  'your-super-secret-key-change-this',
  'secret',
  'changeme',
  'jwt-secret'
]);

if (!JWT_SECRET || JWT_SECRET.length < 32 || WEAK_SECRETS.has(JWT_SECRET)) {
  console.error(
    'FATAL: JWT_SECRET must be set to a random string of at least 32 characters.\n' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
  );
  process.exit(1);
}
const JWT_EXPIRES_IN = '7d';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Middleware: Extract user from token (optional auth)
function extractUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = getUserById(decoded.id);
    }
  }
  next();
}

// Middleware: Require authentication
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Vui lòng đăng nhập' });
  }
  
  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
  }
  
  const user = getUserById(decoded.id);
  if (!user) {
    return res.status(401).json({ error: 'User không tồn tại' });
  }
  
  req.user = user;
  next();
}

// Middleware: Require admin role
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Vui lòng đăng nhập' });
  }
  
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Không có quyền truy cập' });
  }
  
  next();
}

module.exports = {
  generateToken,
  verifyToken,
  extractUser,
  requireAuth,
  requireAdmin,
  JWT_SECRET
};
