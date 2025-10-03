const express = require('express');
const router = express.Router();
const prisma = require('../adapters/prismaClient.js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

router.use(cors());
router.use(express.json());

// ثبت کاربر جدید
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: { username, password: hashed },
    });
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: 'Username already exists' });
  }
});

// لاگین
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(401).json({ result: false });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ result: false });

    const token = jwt.sign({ id: user.id }, 'secretkey', { expiresIn: '1h' });

    res.json({
      result: true,
      user: { id: user.id, username: user.username },
      token,
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// نمونه مسیر محافظت‌شده
router.get('/profile', async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.sendStatus(401);

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, 'secretkey');
    res.json({ message: 'ok', userId: decoded.id });
  } catch {
    res.sendStatus(403);
  }
});

module.exports = router;
