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

export const startRenderWorker = () => {
  return createWorker('render-pipeline', async (job: Job) => {
    const { projectId, templateId, groqData } = job.data;
    const outputPath = path.join('/tmp/wedora/renders', `${projectId}_final.mp4`);
    
    try {
      // 1. Mark Project as RENDERING
      await prisma.project.update({
        where: { id: projectId },
        data: { renderStatus: 'RENDERING' }
      });

      // Fetch the raw video and AI analysis from Postgres
      const video = await prisma.video.findFirst({ where: { projectId, type: 'RAW' } });
      if (!video) throw new Error('Raw video not found for rendering');

      const aiAnalysis = await prisma.aiAnalysis.findUnique({ where: { projectId } });

      // Ensure the output directory exists before running FFmpeg
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      // 2. Run the FFmpeg Rendering Template
      logger.info(`[RenderPipeline] Starting render for project: ${projectId} using template: ${templateId}`);
      let lastReportedProgress = 0;
      let lastUpdateTime = 0;
      let redisUpdateCount = 0;

      const handleProgress = (percent: number) => {
        const mapped = 60 + Math.floor(percent * 0.3); // Maps 0-100 to 60-90
        const now = Date.now();
        
        if (mapped === lastReportedProgress) return;

        if (mapped >= lastReportedProgress + 5 || now - lastUpdateTime > 1000) {
          job.updateProgress(mapped).catch(() => {});
          lastReportedProgress = mapped;
          lastUpdateTime = now;
          redisUpdateCount++;
        }
      };

      await TemplateEngine.renderTemplate(
          video.url,
          outputPath,
          handleProgress,

          { templateId, groqData, aiAnalysis }
        );

      // 3. Upload to Cloudinary
      logger.info(`[RenderPipeline] Uploading final video to Cloudinary for project: ${projectId}`);
      const uploadResult = await cloudinary.uploader.upload(outputPath, {
        resource_type: "video",
        folder: "wedora_final_renders",
      });
      const finalVideoUrl = uploadResult.secure_url;

      // 4. Update the Project model with the completed status and URL
      await prisma.project.update({
        where: { id: projectId },
        data: {
          renderStatus: 'COMPLETED',
          renderedVideoUrl: finalVideoUrl,
          renderCompletedAt: new Date()
        }
      });

      // Save the processed video explicitly in Video table as well
      await prisma.video.create({
        data: {
          projectId,
          type: 'PROCESSED',
          url: finalVideoUrl,
        }
      });

      // 5. Mark the RenderJob as COMPLETED (100%)
      await prisma.renderJob.updateMany({
        where: { projectId },
        data: { status: 'COMPLETED', progress: 100 }
      });

      // 6. Dispatch the final job: Social Upload
      await QueueService.addSocialUploadJob(projectId, 'INSTAGRAM');

      // 7. Cleanup Temp Files
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        const framesDir = path.join('/tmp/wedora/frames', projectId);
        if (fs.existsSync(framesDir)) {
          fs.rmSync(framesDir, { recursive: true, force: true });
        }
        logger.info(`[RenderPipeline] Cleaned up temporary files for project: ${projectId}`);
      } catch (cleanupErr) {
        logger.warn(`[RenderPipeline] Failed to clean up temp files for project ${projectId}`, cleanupErr);
      }

      logger.info(`[RenderPipeline] Render finished. Redis updates: ${redisUpdateCount}, Postgres updates: ${redisUpdateCount}`);

      return { finalUrl: finalVideoUrl };

    } catch (error) {
      // Handle Render Failure
      logger.error(`[RenderPipeline] Render failed for project: ${projectId}`, error);
      await prisma.project.update({
        where: { id: projectId },
        data: { renderStatus: 'FAILED' }
      });
      throw error;
    }
  }, 1); // Rendering is CPU intensive, concurrency 1 per worker!
};
