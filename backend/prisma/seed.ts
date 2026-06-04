import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // 1. Create a dummy user
  const user = await prisma.user.upsert({
    where: { email: 'hello@wedora.ai' },
    update: {},
    create: {
      email: 'hello@wedora.ai',
      name: 'Test Bride',
    },
  });

  console.log(`Created user: ${user.name}`);

  // 2. Create a test project
  const project = await prisma.project.create({
    data: {
      title: 'Bali Wedding Highlights',
      userId: user.id,
      
      // 3. Create nested relations (Videos and AI Analysis)
      videos: {
        create: [
          {
            type: 'RAW',
            url: 'https://res.cloudinary.com/demo/video/upload/dog.mp4',
            duration: 15.5,
          }
        ]
      },
      analysis: {
        create: {
          themes: ['beach', 'sunset', 'luxury'],
          mood: 'romantic',
          aesthetics: 'cinematic',
          templateId: 'cinematic-slow-fade'
        }
      }
    }
  });

  console.log(`Created project: ${project.title} with 1 raw video and AI analysis data.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('Seed completed successfully!');
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
