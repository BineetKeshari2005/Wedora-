import { Job } from 'bullmq';
import { createWorker } from './base.worker';
import { PublishService } from '../services/publish.service';
import { logger } from '../utils/logger';

export const startSocialWorker = () => {
  return createWorker('social-upload', async (job: Job) => {
    const { projectId, platform } = job.data;
    
    logger.info(`[Social] Worker picked up job for ${platform} for project ${projectId}`);
    
    // Delegate entirely to PublishService
    await PublishService.processJobByPlatform(projectId, platform);
    
    return { success: true, platform };
  }, 5); // Network IO, concurrency 5
};
