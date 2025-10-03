const { Router } = require('express');
const { prisma } = require('../adapters/prismaClient');

const router = Router();

// Create or update order
router.post('/', async (req, res) => {
  const data = req.body;

  try {
    if (data.id && data.id !== 0) {
      // update order
      const order = await prisma.order.update({
        where: { id: data.id },
        data: {
          description: data.description,
          status: data.status,
        },
      });
      res.json(order);
    } else {
      // create order
      const order = await prisma.order.create({
        data: {
          description: data.description,
          status: data.status,
          orderTime: Math.floor(Date.now() / 1000),
          customerId: data.customerId,
          username: 'testuser', // برای تست
          orderItems: {
            create: data.orderItems.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              description: item.description,
              orderItemProductOptions: {
                create: item.orderItemProductOptions.map((opt) => ({
                  productOptionId: opt.productOptionId,
                  selection: opt.selection,
                })),
              },
            })),
          },
        },
        include: { orderItems: { include: { orderItemProductOptions: true } } },
      });
      res.json(order);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
});

// Get all orders
router.get('/', async (req, res) => {
  const orders = await prisma.order.findMany({
    include: { orderItems: true },
  });
  res.json(orders);
});

// Get single order
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const order = await prisma.order.findUnique({
    where: { id },
    include: { orderItems: { include: { orderItemProductOptions: true } } },
  });
  res.json(order);
});

module.exports = router;
