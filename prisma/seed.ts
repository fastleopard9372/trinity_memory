import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create test user
  const testUserId = 'test-user-id';
  const testUser = await prisma.profile.upsert({
    where: { userId: testUserId },
    update: {},
    create: {
      userId: testUserId,
      email: 'test@trinity-ai.com',
      username: 'testuser',
      settings: {
        theme: 'dark',
        notifications: true,
      },
    },
  });

  console.log('✅ Created test user:', testUser.email);

  // Create tags
  const tags = ['important', 'project', 'personal', 'work', 'ai', 'development'];
  
  for (const tagName of tags) {
    await prisma.tag.upsert({
      where: { name_userId: { name: tagName, userId: testUserId } },
      update: {},
      create: {
        name: tagName,
        userId: testUserId,
        category: 'general',
      },
    });
  }

  console.log(`✅ Created ${tags.length} tags`);

  // Create memory rules
  const rules = [
    {
      userId: testUserId,
      ruleType: 'length',
      conditions: { minMessages: 10 },
      actions: { generateSummary: true },
      isActive: true,
    },
    {
      userId: testUserId,
      ruleType: 'keyword',
      conditions: { keywords: ['important', 'remember'] },
      actions: { tag: true, tags: ['important'] },
      isActive: true,
    },
  ];

  for (const rule of rules) {
    await prisma.memoryRule.create({
      data: rule,
    });
  }

  console.log(`✅ Created ${rules.length} memory rules`);

  console.log('🎉 Database seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });