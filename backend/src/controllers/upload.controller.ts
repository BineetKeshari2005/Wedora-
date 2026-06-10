import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { CloudinaryService } from '../services/cloudinary.service';
import { QueueService } from '../services/queue.service';

const prisma = new PrismaClient();

export class UploadController {
  /**
   * Handles the POST request when a user uploads a video.
   */
  static async uploadVideo(req: Request, res: Response): Promise<void> {
    try {
      // 1. Ensure a file was actually uploaded by Multer
      if (!req.file) {
        res.status(400).json({ error: 'No video file provided.' });
        return;
      }

      // If no projectId is provided, auto-create a project (and guest user)
      let { projectId, context } = req.body;
      
      let parsedContext = null;
      if (context) {
        try {
          parsedContext = JSON.parse(context);
        } catch (e) {
          console.warn('Failed to parse context JSON', e);
          parsedContext = { text: context };
        }
      }

      if (!projectId) {
        // Upsert a default guest user so we don't create duplicates
        const guestUser = await prisma.user.upsert({
          where: { email: 'guest@wedora.local' },
          update: {},
          create: { email: 'guest@wedora.local', name: 'Guest User' },
        });

        const project = await prisma.project.create({
          data: {
            title: `Upload ${new Date().toLocaleString()}`,
            userId: guestUser.id,
            userContext: parsedContext
          },
        });
        projectId = project.id;
        console.log(`Auto-created project ${projectId} for guest user.`);
      } else if (parsedContext) {
        // If projectId exists but we got new context, update it
        await prisma.project.update({
          where: { id: projectId },
          data: { userContext: parsedContext }
        });
      }

      console.log(`Starting upload to Cloudinary for project ${projectId}...`);

      // 2. Stream the buffer to Cloudinary
      const cloudinaryResult = await CloudinaryService.uploadVideoBuffer(req.file.buffer);

      console.log('Cloudinary upload successful! URL:', cloudinaryResult.secure_url);

      // 3. Save the video record to PostgreSQL via Prisma
      const newVideo = await prisma.video.create({
        data: {
          projectId: projectId,
          type: 'RAW',
          url: cloudinaryResult.secure_url,
          duration: cloudinaryResult.duration,
          width: cloudinaryResult.width,
          height: cloudinaryResult.height,
        },
      });

      console.log('Video saved to database.');

      const { pipelineVersion } = req.body;

      // 4. If V2 or V3 pipeline, skip queue auto-start
      if (pipelineVersion === 'v2' || pipelineVersion === 'v3') {
        // Just return the video and project IDs, UI will call /start-edit later
        res.status(200).json({
          message: 'Video uploaded successfully. Ready for V2 Q&A.',
          video: newVideo,
        });
        return;
      }

      // 5. Create a Job in BullMQ so a background worker starts extracting frames
      const job = await QueueService.addExtractionJob(
        projectId, 
        newVideo.id, 
        cloudinaryResult.secure_url,
        context || ''
      );

      // Also create a RenderJob record in PostgreSQL to track status in the UI
      await prisma.renderJob.create({
        data: {
          projectId: projectId,
          status: 'PENDING',
          bullMqJobId: job.id || '',
        }
      });

      console.log(`Dispatched background job ${job.id}`);

      // 6. Respond to the client immediately so they don't have to wait for analysis
      res.status(200).json({
        message: 'Video uploaded successfully and is now queuing for analysis.',
        video: newVideo,
      });

    } catch (error) {
      console.error('Upload Error:', error);
      res.status(500).json({ error: 'Failed to process video upload.' });
    }
  }
}
