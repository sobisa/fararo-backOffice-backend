const express = require('express');
const router = express.Router();
const prisma = require('../adapters/prismaClient.js');

// GET all customers
router.get('/', async (req, res) => {
  try {
    const customers = await prisma.customer.findMany();
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// GET customer by id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: parseInt(id) },
    });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

// POST new customer
router.post('/', async (req, res) => {
  const { name, phone } = req.body;
  try {
    const customer = await prisma.customer.create({
      data: { name, phone },
    });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// PUT update customer
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone } = req.body;
  try {
    const customer = await prisma.customer.update({
      where: { id: parseInt(id) },
      data: { name, phone },
    });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

module.exports = router;
