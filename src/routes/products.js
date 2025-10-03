const express = require('express');
const router = express.Router();
const prisma = require('../adapters/prismaClient.js');

// GET all products
router.get('/', async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      include: { productOptions: true },
    });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET product by id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const product = await prisma.product.findUnique({
      where: { id: parseInt(id) },
      include: { productOptions: true },
    });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// POST new product
router.post('/', async (req, res) => {
  const { name, description } = req.body;
  try {
    const product = await prisma.product.create({
      data: { name, description },
    });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT update product
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  try {
    const product = await prisma.product.update({
      where: { id: parseInt(id) },
      data: { name, description },
    });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update product' });
  }
});

module.exports = router;
