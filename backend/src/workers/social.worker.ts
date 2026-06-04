import { Job } from 'bullmq';
import { createWorker } from './base.worker';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export const startSocialWorker = () => {
  return createWorker('social-upload', async (job: Job) => {
    const { projectId, platform } = job.data;
    
    // 1. Simulate API call to Instagram/TikTok
    logger.info(`[Social] Uploading to ${platform} for project ${projectId}`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const mockExternalId = `IG_${Math.random().toString(36).substring(7)}`;

    // 2. Save the SocialPost record to PostgreSQL
    await prisma.socialPost.create({
      data: {
        projectId,
        platform: platform as any,  // Cast to Platform enum
        externalId: mockExternalId,
        status: 'PUBLISHED',
      }
    });

    logger.info(`[Social] Published to ${platform}: ${mockExternalId}`);
    return { success: true, externalId: mockExternalId };
  }, 5); // Network IO, concurrency 5
};
