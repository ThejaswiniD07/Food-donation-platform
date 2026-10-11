import jwt from 'jsonwebtoken';

export function authenticate(jwtSecret) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' }, serverNow: req.serverNow });
    }

    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, jwtSecret);
      req.user = decoded;
      next();
    } catch {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Token expired or invalid' }, serverNow: req.serverNow });
    }
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }, serverNow: req.serverNow });
    }
    next();
  };
}
