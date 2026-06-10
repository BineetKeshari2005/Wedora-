import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Parse the REDIS_URL into an ioredis-compatible connection.
 * Supports both local redis:// and Upstash rediss:// (TLS) URLs.
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
    try {
      const parsed = new URL(redisUrl);
      return new IORedis({
        ...redisOpts,
        host: parsed.hostname,
        port: parseInt(parsed.port),
        username: parsed.username || 'default',
        password: parsed.password, // Use raw password without decoding
        tls: parsed.protocol === 'rediss:' ? {} : undefined,
      });
    } catch(e) {
      // Fallback if URL parsing fails
      return new IORedis(redisUrl, redisOpts);
    }
  }
  // Fallback to localhost
  return new IORedis({
    ...redisOpts,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  });
};

const connection = getConnection() as any;

// 1. Extraction Queue (FFmpeg raw video -> frames)
export const extractionQueue = new Queue('video-extraction', { connection });

// 2. AI Analysis Queue (Frames -> Qwen2-VL -> Groq)
export const aiAnalysisQueue = new Queue('ai-analysis', { connection });

// 3. Render Pipeline Queue (AI Logic -> FFmpeg -> Final Video)
export const renderQueue = new Queue('render-pipeline', { connection });

// 4. Social Upload Queue (Final Video -> Instagram/TikTok APIs)
export const socialUploadQueue = new Queue('social-upload', { connection });

// --- V2 Pipeline Queues ---
// 5. EditPlan Pipeline (FFprobe -> Groq EditPlan)
export const editPlanQueue = new Queue('edit-plan', { connection });

// 6. Render V2 Pipeline (FFmpeg executes EditPlan)
export const renderV2Queue = new Queue('render-v2', { connection });

export class QueueService {
  /**
   * Starts the extraction process. This is called directly after a successful video upload.
   */
  static async addExtractionJob(projectId: string, videoId: string, videoUrl: string, context?: string) {
    return await extractionQueue.add('extract-frames', { projectId, videoId, videoUrl, context }, {
      attempts: 3, // Retry 3 times if FFmpeg crashes
      backoff: {
        type: 'exponential',
        delay: 5000, // Wait 5s, then 25s, then 125s before retrying
      },
    });
  }

  static async addAiAnalysisJob(projectId: string, framesDir: string) {
    return await aiAnalysisQueue.add('analyze-frames', { projectId, framesDir }, {
      attempts: 3, 
      backoff: { type: 'exponential', delay: 10000 },
    });
  }

  static async addRenderJob(projectId: string, templateId: string, groqData?: any) {
    return await renderQueue.add('render-video', { projectId, templateId, groqData }, {
      attempts: 2, 
      backoff: { type: 'exponential', delay: 20000 }, // Rendering is heavy, give it longer backoff
    });
  }

  // --- V2 Pipeline Methods ---
  static async addEditPlanJob(projectId: string, videoId: string, videoUrl: string, editPreferences: any) {
    return await editPlanQueue.add('generate-edit-plan', { projectId, videoId, videoUrl, editPreferences }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  static async addRenderV2Job(projectId: string, editPlan: any) {
    return await renderV2Queue.add('render-v2-video', { projectId, editPlan }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 20000 },
    });
  }

  static async addSocialUploadJob(projectId: string, platform: string, scheduledFor?: Date) {
    // If a date is provided, delay the job!
    const delay = scheduledFor ? scheduledFor.getTime() - Date.now() : 0;
    
    return await socialUploadQueue.add('upload-social', { projectId, platform }, {
      delay: delay > 0 ? delay : 0,
      attempts: 5, // Social APIs are flaky, retry more often
      backoff: { type: 'exponential', delay: 60000 }, // 1 min backoffs
    });
  }
}
