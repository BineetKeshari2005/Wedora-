import { Job } from 'bullmq';
import { createWorker } from './base.worker';
import { PrismaClient } from '@prisma/client';
import { FFprobeService } from '../services/ffprobe.service';
import { EditPlanService } from '../services/edit-plan.service';
import { QueueService } from '../services/queue.service';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();
const editPlanService = new EditPlanService();

export const startEditPlanWorker = () => {
  return createWorker('edit-plan', async (job: Job) => {
    const { projectId, videoId, videoUrl, editPreferences } = job.data;
    logger.info(`[EditPlan Worker] Processing job for Project ${projectId}`);

    try {
      // 1. Update status to PROCESSING
      await prisma.renderJob.updateMany({
        where: { projectId, status: 'PENDING' },
        data: { status: 'PROCESSING', progress: 10 },
      });

      // 2. Run ffprobe to extract metadata (duration, width, height, fps)
      logger.info(`[EditPlan Worker] Running ffprobe on ${videoUrl}`);
      const metadata = await FFprobeService.getMetadata(videoUrl);
      logger.info(`[EditPlan Worker] Metadata extracted`, metadata);
      
      await job.updateProgress(30);

      // 3. Generate EditPlan via LLM
      logger.info(`[EditPlan Worker] Generating EditPlan via LLM`);
      const editPlan = await editPlanService.generateEditPlan(metadata, editPreferences);
      logger.info(`[EditPlan Worker] EditPlan generated`, { editPlan });
      
      // Store the generated editPlan alongside the preferences
      await prisma.project.update({
        where: { id: projectId },
        data: { 
          editPreferences: { ...(editPreferences || {}), generatedPlan: editPlan } 
        }
      });

      await job.updateProgress(60);

      // 4. Dispatch Render V2 Job
      logger.info(`[EditPlan Worker] Dispatching V2 Render Job`);
      const renderJob = await QueueService.addRenderV2Job(projectId, editPlan);
      logger.info(`[EditPlan Worker] V2 Render job dispatched: ${renderJob.id}`);

      await job.updateProgress(70);

      return { success: true, editPlan };
    } catch (error: any) {
      logger.error(`[EditPlan Worker] Error for project ${projectId}:`, error);
      
      await prisma.renderJob.updateMany({
        where: { projectId },
        data: { 
          status: 'FAILED', 
          errorLogs: error.message || 'Unknown EditPlan error' 
        },
      });
      await prisma.project.update({
        where: { id: projectId },
        data: { renderStatus: 'FAILED' }
      });
      
      throw error;
    }
  }, 2);
};
