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

// ثبت تاریخچه سفارش
async function createOrderHistory(
  orderId,
  action,
  changedBy,
  oldData,
  newData
) {
  const changes = {};

  if (oldData) {
    // مقایسه تغییرات
    if (oldData.status !== newData.status) {
      changes.status = { old: oldData.status, new: newData.status };
    }
    if (oldData.customerId !== newData.customerId) {
      changes.customerId = { old: oldData.customerId, new: newData.customerId };
    }
    if (oldData.description !== newData.description) {
      changes.description = {
        old: oldData.description || '',
        new: newData.description || '',
      };
    }

    const oldItemsCount = oldData.orderItems?.length || 0;
    const newItemsCount = newData.orderItems?.length || 0;
    if (oldItemsCount !== newItemsCount) {
      changes.itemsCount = { old: oldItemsCount, new: newItemsCount };
    }
  }

  await prisma.orderHistory.create({
    data: {
      orderId,
      action,
      changedBy,
      oldData: oldData ? JSON.stringify(oldData) : null,
      newData: JSON.stringify(newData),
      changes: Object.keys(changes).length > 0 ? JSON.stringify(changes) : null,
    },
  });
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

      await prisma.company.delete({
        where: { id: parseInt(id) },
      });

      res.json({ message: 'شرکت با موفقیت حذف شد' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'خطا در حذف شرکت' });
    }
  }
);

// ========== CUSTOMER ROUTES (✅ کامل و اصلاح شده) ==========

// Get all customers
app.get('/api/customers', authenticateToken, async (req, res) => {
  try {
    // ✅ دریافت مشتریان حقیقی
    const individuals = await prisma.customer.findMany({
      include: {
        company: true,
        contacts: true,
      },
    });

    // ✅ دریافت شرکت‌ها (کمپانی‌ها)
    const companies = await prisma.company.findMany();

    // ✅ ترکیب هر دو لیست
    const allCustomers = [
      // شرکت‌ها
      ...companies.map((company) => ({
        id: company.id,
        name: company.name,
        serial: company.serial,
        taxCode: company.taxCode,
        phone: company.phone,
        address: company.address,
        description: company.description,
        type: 'company',
        createdAt: company.createdAt,
        updatedAt: company.updatedAt,
      })),
      // مشتریان حقیقی
      ...individuals.map((customer) => ({
        id: customer.id,
        name: customer.name,
        mobile: customer.mobile,
        position: customer.position,
        phone: customer.mobile,
        address: null,
        description: customer.description,
        companyId: customer.companyId,
        company: customer.company,
        contacts: customer.contacts,
        type: 'individual',
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      })),
    ];

    res.json(allCustomers);
  } catch (error) {
    console.error('❌ Error fetching customers:', error);
    res.status(500).json({ error: 'خطا در دریافت مشتریان' });
  }
});

// Get single customer
app.get('/api/customers/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const type = req.query.type; // individual یا company

    console.log('📥 Fetching customer:', { id, type });

    if (type === 'company') {
      // دریافت شرکت
      const company = await prisma.company.findUnique({
        where: { id: parseInt(id) },
      });

      if (!company) {
        return res.status(404).json({ error: 'شرکت یافت نشد' });
      }

      res.json({
        ...company,
        type: 'company',
      });
    } else {
      // دریافت مشتری حقیقی
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

      res.json({
        id: customer.id,
        name: customer.name,
        mobile: customer.mobile,
        position: customer.position,
        phone: customer.mobile,
        address: null,
        description: customer.description,
        companyId: customer.companyId,
        company: customer.company,
        contacts: customer.contacts,
        type: 'individual',
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      });
    }
  } catch (error) {
    console.error('❌ Error fetching customer:', error);
    res.status(500).json({ error: 'خطا در دریافت مشتری' });
  }
});

// Create customer or company
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
        type,
        serial,
        taxCode,
        companyId,
        position,
        contacts,
      } = req.body;

      console.log('📥 Creating customer:', req.body);

      if (type === 'company') {
        // ایجاد شرکت
        const company = await prisma.company.create({
          data: {
            name,
            serial: serial || null,
            taxCode: taxCode || null,
            phone: phone || null,
            address: address || null,
            description: description || null,
          },
        });

        res.status(200).json({
          ...company,
          type: 'company',
        });
      } else {
        // ایجاد مشتری حقیقی
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

        res.status(200).json({
          id: customer.id,
          name: customer.name,
          mobile: customer.mobile,
          position: customer.position,
          description: customer.description,
          companyId: customer.companyId,
          type: 'individual',
          contacts: customer.contacts,
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,
        });
      }
    } catch (error) {
      console.error('❌ Error creating customer:', error);
      res.status(500).json({ error: 'خطا در ایجاد مشتری' });
    }
  }
);

// Update customer or company
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
        type,
        serial,
        taxCode,
        companyId,
        position,
        contacts,
      } = req.body;

      console.log('📥 Updating customer:', { id, type, data: req.body });

      if (type === 'company') {
        // ویرایش شرکت
        const company = await prisma.company.update({
          where: { id: parseInt(id) },
          data: {
            name,
            serial: serial || null,
            taxCode: taxCode || null,
            phone: phone || null,
            address: address || null,
            description: description || null,
          },
        });

        res.json({
          ...company,
          type: 'company',
        });
      } else {
        // حذف contacts قبلی
        await prisma.contact.deleteMany({
          where: { customerId: parseInt(id) },
        });

        // ویرایش مشتری حقیقی
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

        res.json({
          id: customer.id,
          name: customer.name,
          mobile: customer.mobile,
          position: customer.position,
          description: customer.description,
          companyId: customer.companyId,
          type: 'individual',
          contacts: customer.contacts,
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,
        });
      }
    } catch (error) {
      console.error('❌ Error updating customer:', error);
      res.status(500).json({ error: 'خطا در بروزرسانی مشتری' });
    }
  }
);

// Delete customer or company
app.delete(
  '/api/customers/:id',
  authenticateToken,
  authorizeRoles('admin', 'manager'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const type = req.query.type;

      console.log('📥 Deleting customer:', { id, type });

      if (type === 'company') {
        await prisma.company.delete({
          where: { id: parseInt(id) },
        });
      } else {
        await prisma.customer.delete({
          where: { id: parseInt(id) },
        });
      }

      res.json({ message: 'مشتری با موفقیت حذف شد' });
    } catch (error) {
      console.error('❌ Error deleting customer:', error);
      res.status(500).json({ error: 'خطا در حذف مشتری' });
    }
  }
);

// ========== OPTION ROUTES (✅ اصلاح شده) ==========

// Get all options
app.get('/api/options', authenticateToken, async (req, res) => {
  try {
    console.log('📥 GET /api/options');

    const options = await prisma.option.findMany({
      orderBy: {
        id: 'desc',
      },
    });

    // ✅ تبدیل states از JSON string به آرایه
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

    // ✅ تبدیل states از JSON string به آرایه
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

      // ✅ Validation
      if (!title || !model) {
        return res.status(400).json({ error: 'عنوان و نوع آپشن الزامی است' });
      }

      // ✅ چک کردن states برای multiState و countableMultiState
      if (model === 'multiState' || model === 'countableMultiState') {
        if (!states || !Array.isArray(states) || states.length === 0) {
          return res.status(400).json({
            error: 'برای آپشن‌های چند گزینه‌ای، حداقل یک گزینه الزامی است',
          });
        }

        // حذف گزینه‌های خالی
        const filteredStates = states.filter((s) => s && s.trim() !== '');

        if (filteredStates.length === 0) {
          return res.status(400).json({
            error: 'حداقل یک گزینه معتبر وارد کنید',
          });
        }
      }

      // ✅ تبدیل states به JSON string
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

      // ✅ برگرداندن با states به صورت آرایه
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

      // ✅ Validation
      if (!title || !model) {
        return res.status(400).json({ error: 'عنوان و نوع آپشن الزامی است' });
      }

      // ✅ چک کردن states برای multiState و countableMultiState
      if (model === 'multiState' || model === 'countableMultiState') {
        if (!states || !Array.isArray(states) || states.length === 0) {
          return res.status(400).json({
            error: 'برای آپشن‌های چند گزینه‌ای، حداقل یک گزینه الزامی است',
          });
        }

        // حذف گزینه‌های خالی
        const filteredStates = states.filter((s) => s && s.trim() !== '');

        if (filteredStates.length === 0) {
          return res.status(400).json({
            error: 'حداقل یک گزینه معتبر وارد کنید',
          });
        }
      }

      // ✅ تبدیل states به JSON string
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

      // ✅ برگرداندن با states به صورت آرایه
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

      // حذف productOptions قبلی
      await prisma.productOption.deleteMany({
        where: { productId: parseInt(id) },
      });

      // بروزرسانی محصول با productOptions جدید
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

      await prisma.productOption.deleteMany({
        where: { productId: parseInt(id) },
      });

      await prisma.product.delete({
        where: { id: parseInt(id) },
      });

      res.json({ message: 'محصول با موفقیت حذف شد' });
    } catch (error) {
      console.error('❌ Error deleting product:', error);
      res.status(500).json({ error: 'خطا در حذف محصول' });
    }
  }
);

// ========== ORDER ROUTES (✅ کامل اصلاح شده) ==========

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

    // ✅ تبدیل به فرمت مورد نیاز Frontend
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

    // ✅ تبدیل به فرمت مورد نیاز Frontend
    const formattedOrder = {
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
    };

    console.log('✅ Order fetched:', formattedOrder.id);
    res.json(formattedOrder);
  } catch (error) {
    console.error('❌ Error fetching order:', error);
    res.status(500).json({ error: 'خطا در دریافت سفارش' });
  }
});

// Get order history
app.get('/api/orders/:id/history', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📥 GET /api/orders/' + id + '/history');

    const history = await prisma.orderHistory.findMany({
      where: { orderId: parseInt(id) },
      orderBy: { changedAt: 'desc' },
    });

    const parsedHistory = history.map((h) => ({
      id: h.id,
      orderId: h.orderId,
      action: h.action,
      changedBy: h.changedBy,
      changedAt: h.changedAt,
      oldData: h.oldData ? JSON.parse(h.oldData) : null,
      newData: JSON.parse(h.newData),
      changes: h.changes ? JSON.parse(h.changes) : null,
    }));

    console.log('✅ History fetched:', parsedHistory.length);
    res.json(parsedHistory);
  } catch (error) {
    console.error('❌ Error fetching history:', error);
    res.status(500).json({ error: 'خطا در دریافت تاریخچه' });
  }
});

// Create order
app.post(
  '/api/orders',
  authenticateToken,
  authorizeRoles('admin', 'manager', 'user'),
  async (req, res) => {
    try {
      const { customerId, description, status, orderItems } = req.body;

      console.log('📥 POST /api/orders');
      console.log('📦 Data:', {
        customerId,
        description,
        status,
        itemsCount: orderItems?.length,
      });

      // ✅ Validation
      if (!customerId) {
        return res.status(400).json({ error: 'شناسه مشتری الزامی است' });
      }

      if (!orderItems || orderItems.length === 0) {
        return res
          .status(400)
          .json({ error: 'حداقل یک محصول باید انتخاب شود' });
      }

      // ✅ ایجاد سفارش
      const order = await prisma.order.create({
        data: {
          customerId: parseInt(customerId),
          description: description || '',
          status: status || 'open',
          orderTime: Math.floor(Date.now() / 1000),
          createdBy: req.user.username,
          orderItems: {
            create: orderItems.map((item) => ({
              productId: parseInt(item.productId),
              quantity: parseInt(item.quantity),
              description: item.description || '',
              orderItemProductOptions: {
                create: (item.orderItemProductOptions || []).map((opt) => ({
                  optionId: parseInt(opt.productOptionId),
                  selection: opt.selection,
                })),
              },
            })),
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
      await createOrderHistory(
        order.id,
        'created',
        req.user.username,
        null,
        order
      );

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
  '/api/orders',
  authenticateToken,
  authorizeRoles('admin', 'manager', 'user'),
  async (req, res) => {
    try {
      const { id, customerId, description, status, orderItems } = req.body;

      console.log('📥 PUT /api/orders');
      console.log('📦 Order ID:', id);

      // ✅ Validation
      if (!id) {
        return res.status(400).json({ error: 'شناسه سفارش الزامی است' });
      }

      if (!customerId) {
        return res.status(400).json({ error: 'شناسه مشتری الزامی است' });
      }

      if (!orderItems || orderItems.length === 0) {
        return res
          .status(400)
          .json({ error: 'حداقل یک محصول باید انتخاب شود' });
      }

      // ✅ دریافت سفارش قبلی (برای تاریخچه)
      const oldOrder = await prisma.order.findUnique({
        where: { id: parseInt(id) },
        include: {
          customer: true,
          orderItems: {
            include: {
              product: true,
              orderItemProductOptions: {
                include: {
                  option: true,
                },
              },
            },
          },
        },
      });

      if (!oldOrder) {
        return res.status(404).json({ error: 'سفارش یافت نشد' });
      }

      // ✅ حذف orderItems قبلی
      await prisma.orderItem.deleteMany({
        where: { orderId: parseInt(id) },
      });

      // ✅ بروزرسانی سفارش
      const updatedOrder = await prisma.order.update({
        where: { id: parseInt(id) },
        data: {
          customerId: parseInt(customerId),
          description: description || '',
          status: status,
          updatedBy: req.user.username,
          orderItems: {
            create: orderItems.map((item) => ({
              productId: parseInt(item.productId),
              quantity: parseInt(item.quantity),
              description: item.description || '',
              orderItemProductOptions: {
                create: (item.orderItemProductOptions || []).map((opt) => ({
                  optionId: parseInt(opt.productOptionId),
                  selection: opt.selection,
                })),
              },
            })),
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
      const action = oldOrder.status !== status ? 'status_changed' : 'updated';
      await createOrderHistory(
        parseInt(id),
        action,
        req.user.username,
        oldOrder,
        updatedOrder
      );

      console.log('✅ Order updated:', updatedOrder.id);
      res.status(200).json(updatedOrder);
    } catch (error) {
      console.error('❌ Error updating order:', error);
      res.status(500).json({
        error: 'خطا در بروزرسانی سفارش',
        details: error.message,
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
