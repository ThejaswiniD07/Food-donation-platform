import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticate } from '../middleware/auth.js';

export function createAuthRouter({ db, clock, jwtSecret }) {
  const router = Router();

  // POST /api/auth/login
  router.post('/login', (req, res) => {
    const { phone, password } = req.body || {};
    if (!phone || !password) {
      return res.status(400).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Phone and password are required' }, serverNow: req.serverNow });
    }

    const cleanPhone = String(phone).trim();
    // Allow lookup with or without country code
    const user = db.prepare(`
      SELECT * FROM users
      WHERE phone = ? OR phone = ? OR phone = ?
    `).get(cleanPhone, `+91${cleanPhone}`, cleanPhone.replace(/^\+91/, ''));

    if (!user) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid phone or password' }, serverNow: req.serverNow });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid phone or password' }, serverNow: req.serverNow });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name, phone: user.phone },
      jwtSecret,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        role: user.role,
        name: user.name,
        phone: user.phone
      },
      serverNow: req.serverNow
    });
  });

  // GET /api/auth/me
  router.get('/me', authenticate(jwtSecret), (req, res) => {
    res.json({
      user: req.user,
      serverNow: req.serverNow
    });
  });

  return router;
}
