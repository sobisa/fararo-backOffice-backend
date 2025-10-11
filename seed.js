// prisma/seed.js (نسخه CommonJS)

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // بقیه کد مثل بالا...

  const hashedPasswordAdmin = await bcrypt.hash('1234', 10);

  await prisma.user.upsert({
    where: { username: 'p2' },
    update: { role: 'manager', name: 'پرستو سرافرازی' },
    create: {
      username: 'sobi',
      password: hashedPasswordAdmin,
      name: 'سبحان',
      role: 'admin',
      enabled: 1,
    },
  });

  console.log('✅ Admin user created');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Username: admin');
  console.log('Password: admin123');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
