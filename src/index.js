const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());

// ========== MIDDLEWARE ==========

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'دسترسی غیرمجاز' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'توکن نامعتبر است' });
    }
    req.user = user;
    next();
  });
};

// Authorization middleware
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'شما دسترسی لازم را ندارید' });
    }
    next();
  };
};

// ========== HELPER FUNCTIONS ==========

// ✅ تابع ثبت تاریخچه سفارش (خارج از route ها)
async function createOrderHistory(
  orderId,
  action,
  changedBy,
  oldData,
  newData
) {
  try {
    console.log(`📝 Creating history for order ${orderId}, action: ${action}`);

    // محاسبه تغییرات دقیق
    const changes = {};

    if (oldData && newData) {
      // مقایسه status
      if (oldData.status !== newData.status) {
        changes.status = {
          from: oldData.status,
          to: newData.status,
        };
      }

      // مقایسه customerId
      if (oldData.customerId !== newData.customerId) {
        changes.customer = {
          from: oldData.customerId,
          to: newData.customerId,
        };
      }

      // مقایسه description
      if (oldData.description !== newData.description) {
        changes.description = {
          from: oldData.description || '',
          to: newData.description || '',
        };
      }

      // ✅ مقایسه دقیق orderItems
      const oldItemsCount = oldData.orderItems?.length || 0;
      const newItemsCount = newData.orderItems?.length || 0;

      if (oldItemsCount !== newItemsCount) {
        changes.itemsCount = {
          from: oldItemsCount,
          to: newItemsCount,
        };
      }

      // ✅ بررسی تغییرات در محتوای آیتم‌ها
      if (oldData.orderItems && newData.orderItems) {
        const oldItemIds = oldData.orderItems.map((i) => i.productId).sort();
        const newItemIds = newData.orderItems.map((i) => i.productId).sort();

        if (JSON.stringify(oldItemIds) !== JSON.stringify(newItemIds)) {
          changes.itemsChanged = true;
        }
      }
    }

    // ✅ ایجاد رکورد تاریخچه با تمام جزئیات
    const history = await prisma.orderHistory.create({
      data: {
        orderId: parseInt(orderId),
        action: action,
        changedBy: changedBy,
        changedAt: new Date(),
        oldData: oldData ? JSON.stringify(oldData) : null,
        newData: JSON.stringify(newData), // ✅ ذخیره کامل وضعیت سفارش
        changes:
          Object.keys(changes).length > 0 ? JSON.stringify(changes) : null,
      },
    });

    console.log(`✅ History record created: ID=${history.id}`);
    return history;
  } catch (error) {
    console.error('❌ Error creating order history:', error);
    throw error;
  }
}

// ========== AUTH ROUTES ==========

// Login
app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return res
        .status(401)
        .json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
    }

    if (user.enabled === 0) {
      return res.status(403).json({ error: 'حساب کاربری شما غیرفعال است' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res
        .status(401)
        .json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
      },
      result: true,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطا در ورود' });
  }
});

// Change Password
app.post(
  '/api/account/change-password',
  authenticateToken,
  async (req, res) => {
    try {
      const { password, newPassword } = req.body;

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
      });

      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        return res.status(401).json({ error: 'رمز عبور فعلی اشتباه است' });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await prisma.user.update({
        where: { id: req.user.id },
        data: { password: hashedPassword },
      });

      res.json({ message: 'رمز عبور با موفقیت تغییر کرد' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'خطا در تغییر رمز عبور' });
    }
  }
);

// ========== USER ROUTES ==========

// Get all users
app.get(
  '/api/users',
  authenticateToken,
  authorizeRoles('admin'),
  async (req, res) => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          username: true,
          name: true,
          role: true,
          enabled: true,
          createdAt: true,
        },
      });
      res.json(users);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'خطا در دریافت کاربران' });
    }
  }
);

// Create user
app.post(
  '/api/users',
  authenticateToken,
  authorizeRoles('admin'),
  async (req, res) => {
    try {
      const { username, password, name, role, enabled } = req.body;

      const existingUser = await prisma.user.findUnique({
        where: { username },
      });

      if (existingUser) {
        return res
          .status(400)
          .json({ error: 'نام کاربری قبلاً استفاده شده است' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: {
          username,
          password: hashedPassword,
          name,
          role: role || 'user',
          enabled: enabled !== undefined ? enabled : 1,
        },
      });

      res.status(200).json({
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        enabled: user.enabled,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'خطا در ایجاد کاربر' });
    }
  }
);

// Update user
app.put(
  '/api/users/:id',
  authenticateToken,
  authorizeRoles('admin'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, role, enabled, password } = req.body;

      const updateData = {
        name,
        role,
        enabled,
      };

      if (password) {
        updateData.password = await bcrypt.hash(password, 10);
      }

      const user = await prisma.user.update({
        where: { id: parseInt(id) },
        data: updateData,
      });

      res.json({
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        enabled: user.enabled,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'خطا در بروزرسانی کاربر' });
    }
  }
);

// Delete user
app.delete(
  '/api/users/:id',
  authenticateToken,
  authorizeRoles('admin'),
  async (req, res) => {
    try {
      const { id } = req.params;

      await prisma.user.delete({
        where: { id: parseInt(id) },
      });

      res.json({ message: 'کاربر با موفقیت حذف شد' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'خطا در حذف کاربر' });
    }
  }
);

// ========== COMPANY ROUTES ==========

// Get all companies
app.get('/api/companies', authenticateToken, async (req, res) => {
  try {
    const companies = await prisma.company.findMany({
      include: {
        customers: true,
      },
    });
    res.json(companies);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطا در دریافت شرکت‌ها' });
  }
});

// Get single company
app.get('/api/companies/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const company = await prisma.company.findUnique({
      where: { id: parseInt(id) },
      include: {
        customers: true,
      },
    });

    if (!company) {
      return res.status(404).json({ error: 'شرکت یافت نشد' });
    }

    res.json(company);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطا در دریافت شرکت' });
  }
});

// Create company
app.post(
  '/api/companies',
  authenticateToken,
  authorizeRoles('admin', 'manager'),
  async (req, res) => {
    try {
      const { name, serial, taxCode, phone, address, description } = req.body;

      const company = await prisma.company.create({
        data: {
          name,
          serial,
          taxCode,
          phone,
          address,
          description,
        },
      });

      res.status(200).json(company);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'خطا در ایجاد شرکت' });
    }
  }
);

// Update company
app.put(
  '/api/companies/:id',
  authenticateToken,
  authorizeRoles('admin', 'manager'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, serial, taxCode, phone, address, description } = req.body;

      const company = await prisma.company.update({
        where: { id: parseInt(id) },
        data: {
          name,
          serial,
          taxCode,
          phone,
          address,
          description,
        },
      });

      res.json(company);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'خطا در بروزرسانی شرکت' });
    }
  }
);

// Delete company
app.delete(
  '/api/companies/:id',
  authenticateToken,
  authorizeRoles('admin', 'manager'),
  async (req, res) => {
    try {
      const { id } = req.params;

      console.log('🗑️ DELETE /api/companies/' + id);

      // ✅ بررسی وجود شرکت
      const company = await prisma.company.findUnique({
        where: { id: parseInt(id) },
      });

      if (!company) {
        return res.status(404).json({ error: 'شرکت یافت نشد' });
      }

      await prisma.company.delete({
        where: { id: parseInt(id) },
      });

      console.log('✅ Company deleted:', id);
      res.json({ message: 'شرکت با موفقیت حذف شد' });
    } catch (error) {
      console.error('❌ Error deleting company:', error);
      res.status(500).json({ error: 'خطا در حذف شرکت' });
    }
  }
);

// ========== CUSTOMER ROUTES ==========

// Get all customers
app.get('/api/customers', authenticateToken, async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      include: {
        company: true,
        contacts: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(customers);
  } catch (error) {
    console.error('❌ Error fetching customers:', error);
    res.status(500).json({ error: 'خطا در دریافت مشتریان' });
  }
});

// Get single customer
app.get('/api/customers/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    console.log('📥 Fetching customer:', id);

    const customer = await prisma.customer.findUnique({
      where: { id: parseInt(id) },
      include: {
        company: true,
        contacts: true,
      },
    });

    if (!customer) {
      return res.status(404).json({ error: 'مشتری یافت نشد' });
    }

    res.json(customer);
  } catch (error) {
    console.error('❌ Error fetching customer:', error);
    res.status(500).json({ error: 'خطا در دریافت مشتری' });
  }
});

// Create customer
app.post(
  '/api/customers',
  authenticateToken,
  authorizeRoles('admin', 'manager', 'user'),
  async (req, res) => {
    try {
      const {
        name,
        phone,
        mobile,
        address,
        description,
        companyId,
        position,
        contacts,
      } = req.body;

      console.log('📥 Creating customer:', req.body);

      const customer = await prisma.customer.create({
        data: {
          name,
          mobile: mobile || phone || null,
          position: position || null,
          description: description || null,
          companyId: companyId ? parseInt(companyId) : null,
          contacts: contacts
            ? {
                create: contacts.map((c) => ({
                  title: c.title,
                  content: c.content,
                  type: c.type,
                  isNew: c.isNew !== undefined ? c.isNew : 1,
                })),
              }
            : undefined,
        },
        include: {
          company: true,
          contacts: true,
        },
      });

      res.status(200).json(customer);
    } catch (error) {
      console.error('❌ Error creating customer:', error);
      res.status(500).json({ error: 'خطا در ایجاد مشتری' });
    }
  }
);

// Update customer
app.put(
  '/api/customers/:id',
  authenticateToken,
  authorizeRoles('admin', 'manager', 'user'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        name,
        phone,
        mobile,
        address,
        description,
        companyId,
        position,
        contacts,
      } = req.body;

      console.log('📥 Updating customer:', { id, data: req.body });

      // حذف contacts قدیمی
      await prisma.contact.deleteMany({
        where: { customerId: parseInt(id) },
      });

      const customer = await prisma.customer.update({
        where: { id: parseInt(id) },
        data: {
          name,
          mobile: mobile || phone || null,
          position: position || null,
          description: description || null,
          companyId: companyId ? parseInt(companyId) : null,
          contacts: contacts
            ? {
                create: contacts.map((c) => ({
                  title: c.title,
                  content: c.content,
                  type: c.type,
                  isNew: c.isNew !== undefined ? c.isNew : 1,
                })),
              }
            : undefined,
        },
        include: {
          company: true,
          contacts: true,
        },
      });

      res.json(customer);
    } catch (error) {
      console.error('❌ Error updating customer:', error);
      res.status(500).json({ error: 'خطا در بروزرسانی مشتری' });
    }
  }
);

// Delete customer
app.delete(
  '/api/customers/:id',
  authenticateToken,
  authorizeRoles('admin', 'manager'),
  async (req, res) => {
    try {
      const { id } = req.params;

      console.log('🗑️ DELETE /api/customers/' + id);

      const customer = await prisma.customer.findUnique({
        where: { id: parseInt(id) },
      });

      if (!customer) {
        return res.status(404).json({ error: 'مشتری یافت نشد' });
      }

      await prisma.customer.delete({
        where: { id: parseInt(id) },
      });

      console.log('✅ Customer deleted:', id);
      res.json({ message: 'مشتری با موفقیت حذف شد' });
    } catch (error) {
      console.error('❌ Error deleting customer:', error);
      res.status(500).json({ error: 'خطا در حذف مشتری' });
    }
  }
);

// ========== CALL ROUTES ==========

// Get all calls
app.get('/api/calls', authenticateToken, async (req, res) => {
  try {
    console.log('📥 GET /api/calls');

    const calls = await prisma.call.findMany({
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            mobile: true,
            company: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log('✅ Calls fetched:', calls.length);
    res.json(calls);
  } catch (error) {
    console.error('❌ Error fetching calls:', error);
    res.status(500).json({ error: 'خطا در دریافت تماس‌ها' });
  }
});

// Get single call
app.get('/api/calls/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📥 GET /api/calls/' + id);

    const call = await prisma.call.findUnique({
      where: { id: parseInt(id) },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            mobile: true,
            company: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!call) {
      return res.status(404).json({ error: 'تماس یافت نشد' });
    }

    console.log('✅ Call fetched:', call.id);
    res.json(call);
  } catch (error) {
    console.error('❌ Error fetching call:', error);
    res.status(500).json({ error: 'خطا در دریافت تماس' });
  }
});

// Create call
app.post(
  '/api/calls',
  authenticateToken,
  authorizeRoles('admin', 'manager', 'user'),
  async (req, res) => {
    try {
      const { customerId, subject, referredTo, description } = req.body;

      console.log('📥 POST /api/calls');
      console.log('📦 Request body:', req.body);
      console.log('📦 Data:', { customerId, subject, referredTo, description });

      // ✅ Validation
      if (!customerId) {
        console.log('❌ Missing customerId');
        return res.status(400).json({ error: 'شناسه مشتری الزامی است' });
      }

      if (!subject) {
        console.log('❌ Missing subject');
        return res.status(400).json({ error: 'موضوع تماس الزامی است' });
      }

      // ✅ بررسی وجود مشتری
      const customerExists = await prisma.customer.findUnique({
        where: { id: parseInt(customerId) },
      });

      if (!customerExists) {
        console.log('❌ Customer not found:', customerId);
        return res.status(404).json({ error: 'مشتری یافت نشد' });
      }

      console.log('✅ Customer found:', customerExists.name);

      // ✅ ایجاد تماس
      const call = await prisma.call.create({
        data: {
          customerId: parseInt(customerId),
          subject,
          referredTo: referredTo || null,
          description: description || null,
          createdBy: req.user.username,
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              mobile: true,
              company: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      console.log('✅ Call created:', call.id);
      res.status(200).json(call);
    } catch (error) {
      console.error('❌ Error creating call:', error);
      console.error('❌ Error message:', error.message);
      console.error('❌ Error stack:', error.stack);

      res.status(500).json({
        error: 'خطا در ایجاد تماس',
        details: error.message,
      });
    }
  }
);

// Update call
app.put(
  '/api/calls/:id',
  authenticateToken,
  authorizeRoles('admin', 'manager', 'user'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { customerId, subject, referredTo, description } = req.body;

      console.log('📥 PUT /api/calls/' + id);
      console.log('📦 Data:', { customerId, subject, referredTo, description });

      // ✅ Validation
      if (!customerId) {
        return res.status(400).json({ error: 'شناسه مشتری الزامی است' });
      }

      if (!subject) {
        return res.status(400).json({ error: 'موضوع تماس الزامی است' });
      }

      // ✅ بروزرسانی تماس
      const call = await prisma.call.update({
        where: { id: parseInt(id) },
        data: {
          customerId: parseInt(customerId),
          subject,
          referredTo: referredTo || null,
          description: description || null,
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              mobile: true,
              company: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      console.log('✅ Call updated:', call.id);
      res.json(call);
    } catch (error) {
      console.error('❌ Error updating call:', error);
      res.status(500).json({
        error: 'خطا در بروزرسانی تماس',
        details: error.message,
      });
    }
  }
);

// Delete call
app.delete(
  '/api/calls/:id',
  authenticateToken,
  authorizeRoles('admin', 'manager'),
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log('📥 DELETE /api/calls/' + id);

      const call = await prisma.call.findUnique({
        where: { id: parseInt(id) },
      });

      if (!call) {
        return res.status(404).json({ error: 'تماس یافت نشد' });
      }

      await prisma.call.delete({
        where: { id: parseInt(id) },
      });

      console.log('✅ Call deleted:', id);
      res.json({ message: 'تماس با موفقیت حذف شد' });
    } catch (error) {
      console.error('❌ Error deleting call:', error);
      res.status(500).json({ error: 'خطا در حذف تماس' });
    }
  }
);

// Get customer calls
app.get('/api/customers/:id/calls', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📥 GET /api/customers/:id/calls');

    const calls = await prisma.call.findMany({
      where: {
        customerId: parseInt(id),
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            mobile: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log(`✅ Found ${calls.length} calls for customer ${id}`);
    res.json(calls);
  } catch (error) {
    console.error('❌ Error fetching customer calls:', error);
    res.status(500).json({ error: 'خطا در دریافت تماس‌های مشتری' });
  }
});

// ========== OPTION ROUTES ==========

// Get all options
app.get('/api/options', authenticateToken, async (req, res) => {
  try {
    console.log('📥 GET /api/options');

    const options = await prisma.option.findMany({
      orderBy: {
        id: 'desc',
      },
    });

    const parsedOptions = options.map((option) => ({
      ...option,
      states: option.states ? JSON.parse(option.states) : null,
    }));

    console.log('✅ Options fetched:', parsedOptions.length);
    res.json(parsedOptions);
  } catch (error) {
    console.error('❌ Error fetching options:', error);
    res.status(500).json({ error: 'خطا در دریافت آپشن‌ها' });
  }
});

// Get single option
app.get('/api/options/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📥 GET /api/options/' + id);

    const option = await prisma.option.findUnique({
      where: { id: parseInt(id) },
    });

    if (!option) {
      return res.status(404).json({ error: 'آپشن یافت نشد' });
    }

    const parsedOption = {
      ...option,
      states: option.states ? JSON.parse(option.states) : null,
    };

    console.log('✅ Option fetched:', parsedOption);
    res.json(parsedOption);
  } catch (error) {
    console.error('❌ Error fetching option:', error);
    res.status(500).json({ error: 'خطا در دریافت آپشن' });
  }
});

// Create option
app.post(
  '/api/options',
  authenticateToken,
  authorizeRoles('admin', 'manager'),
  async (req, res) => {
    try {
      const { title, model, states, description, isActive } = req.body;

      console.log('📥 POST /api/options');
      console.log('📦 Data:', { title, model, states, description, isActive });

      if (!title || !model) {
        return res.status(400).json({ error: 'عنوان و نوع آپشن الزامی است' });
      }

      if (model === 'multiState' || model === 'countableMultiState') {
        if (!states || !Array.isArray(states) || states.length === 0) {
          return res.status(400).json({
            error: 'برای آپشن‌های چند گزینه‌ای، حداقل یک گزینه الزامی است',
          });
        }

        const filteredStates = states.filter((s) => s && s.trim() !== '');

        if (filteredStates.length === 0) {
          return res.status(400).json({
            error: 'حداقل یک گزینه معتبر وارد کنید',
          });
        }
      }

      const statesToSave =
        model === 'multiState' || model === 'countableMultiState'
          ? JSON.stringify(states.filter((s) => s && s.trim() !== ''))
          : null;

      console.log('💾 States to save:', statesToSave);

      const option = await prisma.option.create({
        data: {
          title,
          model,
          states: statesToSave,
          description: description || null,
          isActive: isActive !== undefined ? isActive : 1,
        },
      });

      const response = {
        ...option,
        states: option.states ? JSON.parse(option.states) : null,
      };

      console.log('✅ Option created:', response);
      res.status(200).json(response);
    } catch (error) {
      console.error('❌ Error creating option:', error);
      res.status(500).json({
        error: 'خطا در ایجاد آپشن',
        details: error.message,
      });
    }
  }
);

// Update option
app.put(
  '/api/options/:id',
  authenticateToken,
  authorizeRoles('admin', 'manager'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { title, model, states, description, isActive } = req.body;

      console.log('📥 PUT /api/options/' + id);
      console.log('📦 Data:', { title, model, states, description, isActive });

      if (!title || !model) {
        return res.status(400).json({ error: 'عنوان و نوع آپشن الزامی است' });
      }

      if (model === 'multiState' || model === 'countableMultiState') {
        if (!states || !Array.isArray(states) || states.length === 0) {
          return res.status(400).json({
            error: 'برای آپشن‌های چند گزینه‌ای، حداقل یک گزینه الزامی است',
          });
        }

        const filteredStates = states.filter((s) => s && s.trim() !== '');

        if (filteredStates.length === 0) {
          return res.status(400).json({
            error: 'حداقل یک گزینه معتبر وارد کنید',
          });
        }
      }

      const statesToSave =
        model === 'multiState' || model === 'countableMultiState'
          ? JSON.stringify(states.filter((s) => s && s.trim() !== ''))
          : null;

      console.log('💾 States to save:', statesToSave);

      const option = await prisma.option.update({
        where: { id: parseInt(id) },
        data: {
          title,
          model,
          states: statesToSave,
          description: description || null,
          isActive,
        },
      });

      const response = {
        ...option,
        states: option.states ? JSON.parse(option.states) : null,
      };

      console.log('✅ Option updated:', response);
      res.json(response);
    } catch (error) {
      console.error('❌ Error updating option:', error);
      res.status(500).json({
        error: 'خطا در بروزرسانی آپشن',
        details: error.message,
      });
    }
  }
);

// Delete option
app.delete(
  '/api/options/:id',
  authenticateToken,
  authorizeRoles('admin', 'manager'),
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log('📥 DELETE /api/options/' + id);

      const option = await prisma.option.findUnique({
        where: { id: parseInt(id) },
      });

      if (!option) {
        return res.status(404).json({ error: 'آپشن یافت نشد' });
      }

      await prisma.option.delete({
        where: { id: parseInt(id) },
      });

      console.log('✅ Option deleted:', id);
      res.json({ message: 'آپشن با موفقیت حذف شد' });
    } catch (error) {
      console.error('❌ Error deleting option:', error);
      res.status(500).json({ error: 'خطا در حذف آپشن' });
    }
  }
);

// ========== PRODUCT ROUTES ==========

// Get all products
app.get('/api/products', authenticateToken, async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      include: {
        productOptions: {
          include: {
            option: true,
          },
        },
      },
    });

    res.json(products);
  } catch (error) {
    console.error('❌ Error fetching products:', error);
    res.status(500).json({ error: 'خطا در دریافت محصولات' });
  }
});

// Get single product
app.get('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    console.log('📥 Fetching product:', id);

    const product = await prisma.product.findUnique({
      where: { id: parseInt(id) },
      include: {
        productOptions: {
          include: {
            option: true,
          },
        },
      },
    });

    if (!product) {
      return res.status(404).json({ error: 'محصول یافت نشد' });
    }

    console.log('✅ Product found:', product);

    res.json(product);
  } catch (error) {
    console.error('❌ Error fetching product:', error);
    res.status(500).json({ error: 'خطا در دریافت محصول' });
  }
});

// Create product
app.post(
  '/api/products',
  authenticateToken,
  authorizeRoles('admin', 'manager'),
  async (req, res) => {
    try {
      const { name, description, productOptions } = req.body;

      console.log('📥 Creating product:', {
        name,
        description,
        productOptions,
      });

      if (!name) {
        return res.status(400).json({ error: 'نام محصول الزامی است' });
      }

      const product = await prisma.product.create({
        data: {
          name,
          description: description || null,
          productOptions: {
            create:
              productOptions?.map((po) => ({
                optionId: po.optionId,
                maxNo: po.maxNo,
              })) || [],
          },
        },
        include: {
          productOptions: {
            include: {
              option: true,
            },
          },
        },
      });

      console.log('✅ Product created:', product);

      res.status(200).json(product);
    } catch (error) {
      console.error('❌ Error creating product:', error);
      res.status(500).json({
        error: 'خطا در ایجاد محصول',
        details: error.message,
      });
    }
  }
);

// Update product
app.put(
  '/api/products/:id',
  authenticateToken,
  authorizeRoles('admin', 'manager'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, productOptions } = req.body;

      console.log('📥 Updating product:', id);
      console.log('📥 Data:', { name, description, productOptions });

      await prisma.productOption.deleteMany({
        where: { productId: parseInt(id) },
      });

      const product = await prisma.product.update({
        where: { id: parseInt(id) },
        data: {
          name,
          description: description || null,
          productOptions: {
            create:
              productOptions?.map((po) => ({
                optionId: po.optionId,
                maxNo: po.maxNo,
              })) || [],
          },
        },
        include: {
          productOptions: {
            include: {
              option: true,
            },
          },
        },
      });

      console.log('✅ Product updated:', product);

      res.json(product);
    } catch (error) {
      console.error('❌ Error updating product:', error);
      res.status(500).json({
        error: 'خطا در بروزرسانی محصول',
        details: error.message,
      });
    }
  }
);

// Delete product
app.delete(
  '/api/products/:id',
  authenticateToken,
  authorizeRoles('admin', 'manager'),
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log('📥 DELETE /api/products/' + id);

      // ✅ چک کردن که آیا این محصول در سفارشی استفاده شده؟
      const orderItemsCount = await prisma.orderItem.count({
        where: { productId: parseInt(id) },
      });

      if (orderItemsCount > 0) {
        return res.status(400).json({
          error: `این محصول در ${orderItemsCount} سفارش استفاده شده است و قابل حذف نیست`,
          usedInOrders: orderItemsCount,
        });
      }

      // ✅ حذف productOptions مرتبط
      await prisma.productOption.deleteMany({
        where: { productId: parseInt(id) },
      });

      // ✅ حذف محصول
      await prisma.product.delete({
        where: { id: parseInt(id) },
      });

      console.log('✅ Product deleted:', id);
      res.json({ message: 'محصول با موفقیت حذف شد' });
    } catch (error) {
      console.error('❌ Error deleting product:', error);
      res.status(500).json({
        error: 'خطا در حذف محصول',
        details: error.message,
      });
    }
  }
);

// ========== ORDER ROUTES ==========

// Get all orders
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    console.log('📥 GET /api/orders');

    const orders = await prisma.order.findMany({
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            mobile: true,
            company: {
              select: {
                name: true,
              },
            },
          },
        },
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
              },
            },
            orderItemProductOptions: {
              include: {
                option: {
                  select: {
                    id: true,
                    title: true,
                    model: true,
                    states: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });

    const formattedOrders = orders.map((order) => ({
      id: order.id,
      customerId: order.customerId,
      customerName: order.customer.name,
      username: order.createdBy,
      description: order.description,
      status: order.status,
      orderTime: order.orderTime,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      orderItems: order.orderItems.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity,
        description: item.description,
        orderItemProductOptions: item.orderItemProductOptions.map((opt) => ({
          id: opt.id,
          productOptionId: opt.optionId,
          selection: opt.selection,
          option: opt.option,
        })),
      })),
    }));

    console.log('✅ Orders fetched:', formattedOrders.length);
    res.json(formattedOrders);
  } catch (error) {
    console.error('❌ Error fetching orders:', error);
    res.status(500).json({ error: 'خطا در دریافت سفارش‌ها' });
  }
});

// Get single order
app.get('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📥 GET /api/orders/' + id);

    const order = await prisma.order.findUnique({
      where: { id: parseInt(id) },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            mobile: true,
            company: {
              select: {
                name: true,
              },
            },
          },
        },
        company: {
          select: {
            id: true,
            name: true,
          },
        },
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
              },
            },
            orderItemProductOptions: {
              include: {
                option: {
                  select: {
                    id: true,
                    title: true,
                    model: true,
                    states: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ error: 'سفارش یافت نشد' });
    }

    const formattedOrder = {
      id: order.id,
      customerId: order.customerId,
      companyId: order.companyId,
      customerName: order.customer.name,
      username: order.createdBy,
      description: order.description,
      status: order.status,
      orderTime: order.orderTime,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      orderItems: order.orderItems.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity,
        description: item.description,
        orderItemProductOptions: item.orderItemProductOptions.map((opt) => ({
          id: opt.id,
          productOptionId: opt.optionId,
          selection: opt.selection,
          option: opt.option,
        })),
      })),
    };

    console.log('✅ Order fetched:', formattedOrder.id);
    res.json(formattedOrder);
  } catch (error) {
    console.error('❌ Error fetching order:', error);
    res.status(500).json({ error: 'خطا در دریافت سفارش' });
  }
});

// Get order history
app.get(
  '/api/orders/:id/history',
  authenticateToken,
  authorizeRoles('admin', 'manager', 'user'),
  async (req, res) => {
    try {
      const { id } = req.params;

      console.log('📥 GET /api/orders/:id/history');
      console.log('📦 Order ID:', id);

      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ error: 'شناسه سفارش نامعتبر است' });
      }

      const history = await prisma.orderHistory.findMany({
        where: {
          orderId: parseInt(id),
        },
        orderBy: {
          changedAt: 'desc',
        },
      });

      console.log(`✅ Found ${history.length} history records`);

      const parsedHistory = history.map((h) => ({
        id: h.id,
        orderId: h.orderId,
        action: h.action,
        changedBy: h.changedBy,
        changedAt: h.changedAt,
        oldData: h.oldData ? JSON.parse(h.oldData) : null,
        newData: h.newData ? JSON.parse(h.newData) : null,
        changes: h.changes ? JSON.parse(h.changes) : null,
      }));

      res.status(200).json(parsedHistory);
    } catch (error) {
      console.error('❌ Error fetching history:', error);
      res.status(500).json({
        error: 'خطا در دریافت تاریخچه',
        details: error.message,
      });
    }
  }
);

// Create order
app.post(
  '/api/orders',
  authenticateToken,
  authorizeRoles('admin', 'manager', 'user'),
  async (req, res) => {
    try {
      const { companyId, customerId, description, status, orderItems } =
        req.body;
      console.log('📥 POST /api/orders');
      console.log('📦 Data:', {
        customerId,
        companyId,
        description,
        status,
        itemsCount: orderItems?.length,
      });

      if (!customerId) {
        return res.status(400).json({ error: 'شناسه مشتری الزامی است' });
      }

      if (!orderItems || orderItems.length === 0) {
        return res
          .status(400)
          .json({ error: 'حداقل یک محصول باید انتخاب شود' });
      }
      const order = await prisma.order.create({
        data: {
          customerId: parseInt(customerId),
          companyId: parseInt(companyId),
          description: description || '',
          status: status || 'open',
          orderTime: Math.floor(Date.now() / 1000),
          createdBy: req.user.username,
          orderItems: {
            create: orderItems.map((item) => {
              const orderItemData = {
                productId: parseInt(item.productId),
                quantity: parseInt(item.quantity),
                description: item.description || '',
              };

              if (
                item.orderItemProductOptions &&
                item.orderItemProductOptions.length > 0
              ) {
                orderItemData.orderItemProductOptions = {
                  create: item.orderItemProductOptions.map((opt) => {
                    let selectionString;

                    if (typeof opt.selection === 'string') {
                      selectionString = opt.selection;
                    } else if (typeof opt.selection === 'number') {
                      selectionString = opt.selection.toString();
                    } else if (Array.isArray(opt.selection)) {
                      selectionString = JSON.stringify(opt.selection);
                    } else if (typeof opt.selection === 'object') {
                      selectionString = JSON.stringify(opt.selection);
                    } else {
                      selectionString = '';
                    }

                    return {
                      optionId: parseInt(opt.productOptionId),
                      selection: selectionString,
                    };
                  }),
                };
              }

              return orderItemData;
            }),
          },
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              mobile: true,
            },
          },
          orderItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                },
              },
              orderItemProductOptions: {
                include: {
                  option: {
                    select: {
                      id: true,
                      title: true,
                      model: true,
                      states: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      // ✅ ثبت تاریخچه
      try {
        await createOrderHistory(
          order.id,
          'created',
          req.user?.username || 'system',
          null,
          order
        );
        console.log('✅ History created');
      } catch (historyError) {
        console.warn('⚠️ Failed to create history:', historyError.message);
      }

      console.log('✅ Order created:', order.id);
      res.status(200).json(order);
    } catch (error) {
      console.error('❌ Error creating order:', error);
      res.status(500).json({
        error: 'خطا در ایجاد سفارش',
        details: error.message,
      });
    }
  }
);

// Update order
app.put(
  '/api/orders/:id',
  authenticateToken,
  authorizeRoles('admin', 'manager', 'user'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { customerId, description, status, orderItems } = req.body;

      console.log('📥 PUT /api/orders/:id');
      console.log('📦 Order ID:', id);

      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ error: 'شناسه سفارش نامعتبر است' });
      }

      if (!customerId || isNaN(parseInt(customerId))) {
        return res.status(400).json({ error: 'شناسه مشتری نامعتبر است' });
      }

      if (!orderItems || orderItems.length === 0) {
        return res
          .status(400)
          .json({ error: 'حداقل یک محصول باید انتخاب شود' });
      }

      const orderId = parseInt(id);

      const oldOrder = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          customer: true,
          orderItems: {
            include: {
              product: true,
              orderItemProductOptions: true,
            },
          },
        },
      });

      if (!oldOrder) {
        return res.status(404).json({ error: 'سفارش یافت نشد' });
      }

      console.log('✅ Old order found');

      const orderItemIds = oldOrder.orderItems.map((item) => item.id);

      if (orderItemIds.length > 0) {
        await prisma.orderItemProductOption.deleteMany({
          where: {
            orderItemId: {
              in: orderItemIds,
            },
          },
        });
      }

      await prisma.orderItem.deleteMany({
        where: { orderId: orderId },
      });
      console.log('✅ Old orderItems deleted');

      const newOrderItemsData = orderItems.map((item) => {
        const orderItemData = {
          productId: parseInt(item.productId),
          quantity: parseInt(item.quantity),
          description: item.description || '',
        };

        if (
          item.orderItemProductOptions &&
          item.orderItemProductOptions.length > 0
        ) {
          orderItemData.orderItemProductOptions = {
            create: item.orderItemProductOptions.map((opt) => {
              let selectionString;

              if (typeof opt.selection === 'string') {
                selectionString = opt.selection;
              } else if (typeof opt.selection === 'number') {
                selectionString = opt.selection.toString();
              } else if (Array.isArray(opt.selection)) {
                selectionString = JSON.stringify(opt.selection);
              } else if (typeof opt.selection === 'object') {
                selectionString = JSON.stringify(opt.selection);
              } else {
                selectionString = '';
              }

              return {
                optionId: parseInt(opt.productOptionId),
                selection: selectionString,
              };
            }),
          };
        }

        return orderItemData;
      });

      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          customerId: parseInt(customerId),
          description: description || '',
          status: status || 'open',
          updatedBy: req.user?.username || 'system',
          orderItems: {
            create: newOrderItemsData,
          },
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              mobile: true,
            },
          },
          orderItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                },
              },
              orderItemProductOptions: {
                include: {
                  option: true,
                },
              },
            },
          },
        },
      });

      console.log('✅ Order updated successfully');

      // ✅ ثبت تاریخچه
      try {
        const action =
          oldOrder.status !== status ? 'status_changed' : 'updated';
        await createOrderHistory(
          orderId,
          action,
          req.user?.username || 'system',
          oldOrder,
          updatedOrder
        );
        console.log('✅ History created');
      } catch (historyError) {
        console.warn('⚠️ Failed to create history:', historyError.message);
      }

      res.status(200).json(updatedOrder);
    } catch (error) {
      console.error('❌ Error updating order:');
      console.error('   Message:', error.message);

      res.status(500).json({
        error: 'خطا در بروزرسانی سفارش',
        message: error.message,
      });
    }
  }
);

// Delete order
app.delete(
  '/api/orders/:id',
  authenticateToken,
  authorizeRoles('admin', 'manager'),
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log('📥 DELETE /api/orders/' + id);

      const order = await prisma.order.findUnique({
        where: { id: parseInt(id) },
      });

      if (!order) {
        return res.status(404).json({ error: 'سفارش یافت نشد' });
      }

      await prisma.order.delete({
        where: { id: parseInt(id) },
      });

      console.log('✅ Order deleted:', id);
      res.json({ message: 'سفارش با موفقیت حذف شد' });
    } catch (error) {
      console.error('❌ Error deleting order:', error);
      res.status(500).json({ error: 'خطا در حذف سفارش' });
    }
  }
);

// ========== SERVER START ==========

app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
