import { Job } from 'bullmq';
import { createWorker } from './base.worker';
import { QueueService } from '../services/queue.service';
import { ExtractService } from '../ffmpeg/extract.service';
import { VisionService } from '../services/vision.service';
import { GroqService } from '../services/groq.service';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { ContextBuilder } from '../utils/contextBuilder';

export const startExtractionWorker = () => {
  return createWorker('video-extraction', async (job: Job) => {
    const { projectId, videoId, videoUrl, context } = job.data;

    // 1. Extract frames
    await prisma.project.update({ where: { id: projectId }, data: { renderStatus: 'EXTRACTING' } });
    logger.info(`[VideoExtraction] Starting extraction for project: ${projectId}`);
    const framesDir = await ExtractService.extractFrames(
      projectId,
      videoUrl,
      3, // 1 frame every 3 seconds
      (percent) => job.updateProgress(Math.floor(percent * 0.3))
    );
    logger.info(`[VideoExtraction] Frames extracted to: ${framesDir}`);

    // 2. Perform vision analysis on extracted frames
    await prisma.project.update({ where: { id: projectId }, data: { renderStatus: 'ANALYZING' } });
    logger.info(`[VideoExtraction] Analyzing frames for project: ${projectId}`);
    const analysisResult = await VisionService.analyzeFrames(framesDir);
    logger.info(`[VideoExtraction] Analysis complete. Themes: ${analysisResult.themes?.join(', ') || 'none'}`);

    // Fetch user context from the project
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    const userContext = project?.userContext;

    // Merge AI Vision + User Context
    const mergedContext = ContextBuilder.mergeContext(userContext, analysisResult);

    // 3. Generate creative content using Groq LLM
    logger.info(`[VideoExtraction] Generating Groq captions for context: ${JSON.stringify(mergedContext)}`);
    const groqService = new GroqService();
    const groqResult = await groqService.generate({
      metadata: analysisResult,
      userContext: JSON.stringify(mergedContext),
      platform: 'INSTAGRAM',
    });

    // 4. Store analysis in AiAnalysis table (upsert), embedding Groq results in rawVisionData
    await prisma.aiAnalysis.upsert({
      where: { projectId },
      update: {
        themes: analysisResult.themes ?? [],
        mood: analysisResult.mood,
        aesthetics: analysisResult.aesthetics,
        templateId: groqResult.templateId || analysisResult.recommended_template,
        rawVisionData: { vision: analysisResult, groq: groqResult } as any,
      },
      create: {
        projectId,
        themes: analysisResult.themes ?? [],
        mood: analysisResult.mood,
        aesthetics: analysisResult.aesthetics,
        templateId: groqResult.templateId || analysisResult.recommended_template,
        rawVisionData: { vision: analysisResult, groq: groqResult } as any,
      },
    });

    // 5. Dispatch render job using the chosen template and passing groqData
    const templateId = groqResult.templateId || analysisResult.recommended_template || 'default-template';
    await QueueService.addRenderJob(projectId, templateId, groqResult);

    return { framesDir, analysisResult, groqResult };
  }, 2);
};
