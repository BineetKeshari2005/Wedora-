import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

/**
 * Parse the REDIS_URL into an ioredis-compatible connection.
 */
const getConnection = () => {
  const redisUrl = process.env.REDIS_URL;
  const redisOpts = {
    maxRetriesPerRequest: null,
    connectTimeout: 10000,
    lazyConnect: true,
    retryStrategy(times: number) {
      return Math.min(times * 50, 2000);
    },
  };

  if (redisUrl) {
    return new IORedis(redisUrl, redisOpts);
  }

  return new IORedis({
    ...redisOpts,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  });
};

const connection = getConnection() as any;

/**
 * Creates a BullMQ worker with standardized error handling, progress tracking, and logging.
 */
export const createWorker = (
  queueName: string,
  processor: (job: Job) => Promise<any>,
  concurrency: number = 1
) => {
  const worker = new Worker(queueName, processor, { connection, concurrency });

  worker.on('active', async (job: Job) => {
    logger.info(`[${queueName}] Job ${job.id} active. Payload:`, job.data);
    
    // Update Postgres if this is the first step in the pipeline
    if (queueName === 'video-extraction') {
      try {
        await prisma.renderJob.updateMany({
          where: { bullMqJobId: job.id || '' },
          data: { status: 'PROCESSING', progress: 5 }
        });
      } catch(e) { /* Ignore if record doesn't exist yet */ }
    }
  });

  worker.on('completed', async (job: Job) => {
    logger.info(`[${queueName}] Job ${job.id} completed successfully.`);
  });

  worker.on('failed', async (job: Job | undefined, err: Error) => {
    logger.error(`[${queueName}] Job ${job?.id} failed:`, err);
    
    if (job) {
      try {
        await prisma.renderJob.updateMany({
          where: { projectId: job.data.projectId, status: 'PROCESSING' },
          data: { 
            status: 'FAILED',
          }
        });
      } catch(e) {
        logger.error('Failed to update PostgreSQL job status', e);
      }
    }
  });

  worker.on('progress', async (job: Job, progress: any) => {
    logger.info(`[${queueName}] Job ${job.id} progress: ${progress}%`);
    
    // Only update progress in PG if it's a number
    if (typeof progress === 'number') {
      try {
        await prisma.renderJob.updateMany({
          where: { projectId: job.data.projectId },
          data: { progress }
        });
      } catch(e) {}
    }
  });

  return worker;
};
