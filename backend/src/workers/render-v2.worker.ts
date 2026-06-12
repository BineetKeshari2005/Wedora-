import { Job } from 'bullmq';
import { createWorker } from './base.worker';
import { QueueService } from '../services/queue.service';
import { PrismaClient } from '@prisma/client';
import { TemplateEngine } from '../services/template-engine.service';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';
import { v2 as cloudinary } from 'cloudinary';

const prisma = new PrismaClient();

export const startRenderV2Worker = () => {
  return createWorker('render-v2', async (job: Job) => {
    const { projectId, editPlan } = job.data;
    const outputPath = path.join('/tmp/wedora/renders', `${projectId}_v2_final.mp4`);
    
    try {
      await prisma.project.update({
        where: { id: projectId },
        data: { renderStatus: 'RENDERING' }
      });

      const video = await prisma.video.findFirst({ where: { projectId, type: 'RAW' } });
      if (!video) throw new Error('Raw video not found for rendering');

      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      logger.info(`[RenderV2Pipeline] Starting render for project: ${projectId}`);
      
      let lastReportedProgress = 0;
      let lastUpdateTime = 0;
      let redisUpdateCount = 0;

      const handleProgress = (percent: number) => {
        const mapped = 70 + Math.floor(percent * 0.2); // Maps 0-100 to 70-90
        const now = Date.now();
        
        if (mapped === lastReportedProgress) return;

        if (mapped >= lastReportedProgress + 5 || now - lastUpdateTime > 1000) {
          job.updateProgress(mapped).catch(() => {});
          lastReportedProgress = mapped;
          lastUpdateTime = now;
          redisUpdateCount++;
        }
      };

      await TemplateEngine.renderEditPlan(
          video.url,
          outputPath,
          handleProgress, 
          editPlan
        );

      logger.info(`[RenderV2Pipeline] Uploading final video to Cloudinary for project: ${projectId}`);
      const uploadResult = await cloudinary.uploader.upload(outputPath, {
        resource_type: "video",
        folder: "wedora_final_renders",
      });
      const finalVideoUrl = uploadResult.secure_url;

      await prisma.project.update({
        where: { id: projectId },
        data: {
          renderStatus: 'COMPLETED',
          renderedVideoUrl: finalVideoUrl,
          renderCompletedAt: new Date()
        }
      });

      await prisma.video.create({
        data: {
          projectId,
          type: 'PROCESSED',
          url: finalVideoUrl,
        }
      });

      await prisma.renderJob.updateMany({
        where: { projectId },
        data: { status: 'COMPLETED', progress: 100 }
      });

      // Dispatch social upload
      await QueueService.addSocialUploadJob(projectId, 'INSTAGRAM');

      // Cleanup Temp Files
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        logger.info(`[RenderV2Pipeline] Cleaned up temporary files for project: ${projectId}`);
      } catch (cleanupErr) {
        logger.warn(`[RenderV2Pipeline] Failed to clean up temp files for project ${projectId}`, cleanupErr);
      }

      logger.info(`[RenderV2Pipeline] Render finished. Redis updates: ${redisUpdateCount}, Postgres updates: ${redisUpdateCount}`);

      return { finalUrl: finalVideoUrl };

    } catch (error: any) {
      logger.error(`[RenderV2Pipeline] Render failed for project: ${projectId}`, error);
      await prisma.project.update({
        where: { id: projectId },
        data: { renderStatus: 'FAILED' }
      });
      await prisma.renderJob.updateMany({
        where: { projectId },
        data: { status: 'FAILED', errorLogs: error.message }
      });
      throw error;
    }
  }, 1); // FFmpeg is heavy, limit to 1 per instance
};
