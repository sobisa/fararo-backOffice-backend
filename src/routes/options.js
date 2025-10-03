const express = require('express');
const router = express.Router();
const prisma = require('../adapters/prismaClient.js');

// GET all options
router.get('/', async (req, res) => {
  try {
    const options = await prisma.option.findMany();
    res.json(options);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch options' });
  }
});

// GET option by id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const option = await prisma.option.findUnique({
      where: { id: parseInt(id) },
    });
    res.json(option);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch option' });
  }
});

// POST new option
router.post('/', async (req, res) => {
  const { title, model, states } = req.body;
  try {
    const option = await prisma.option.create({
      data: {
        title,
        model,
        states: states ? JSON.stringify(states) : null,
      },
    });
    res.json(option);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create option' });
  }
});

// PUT update option
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { title, model, states } = req.body;
  try {
    const option = await prisma.option.update({
      where: { id: parseInt(id) },
      data: {
        title,
        model,
        states: states ? JSON.stringify(states) : null,
      },
    });
    res.json(option);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update option' });
  }
});

module.exports = router;
