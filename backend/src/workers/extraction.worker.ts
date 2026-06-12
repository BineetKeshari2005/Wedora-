import { Job } from 'bullmq';
import { createWorker } from './base.worker';
import { QueueService } from '../services/queue.service';
import { ExtractService } from '../ffmpeg/extract.service';
import { VisionService } from '../services/vision.service';
import { GroqService } from '../services/groq.service';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { ContextBuilder } from '../utils/contextBuilder';
import { TemplateScorer } from '../utils/templateScorer';

export const startExtractionWorker = () => {
  return createWorker('video-extraction', async (job: Job) => {
    const { projectId, videoId, videoUrl, context } = job.data;

    // 1. Extract frames
    await prisma.project.update({ where: { id: projectId }, data: { renderStatus: 'EXTRACTING' } });
    logger.info(`[VideoExtraction] Starting extraction for project: ${projectId}`);
    let lastReportedProgress = 0;
    let lastUpdateTime = 0;
    let redisUpdateCount = 0;

    const handleProgress = (percent: number) => {
      const mapped = Math.floor(percent * 0.3); // Maps 0-100 to 0-30
      const now = Date.now();
      
      if (mapped === lastReportedProgress) return;

      if (mapped >= lastReportedProgress + 5 || now - lastUpdateTime > 1000) {
        job.updateProgress(mapped).catch(() => {});
        lastReportedProgress = mapped;
        lastUpdateTime = now;
        redisUpdateCount++;
      }
    };

    const framesDir = await ExtractService.extractFrames(
      projectId,
      videoUrl,
      1, // 1 frame every 1 second for dense coverage
      handleProgress
    );
    logger.info(`[VideoExtraction] Frames extracted to: ${framesDir}`);

    // 2. Perform vision analysis on extracted frames
    await prisma.project.update({ where: { id: projectId }, data: { renderStatus: 'ANALYZING' } });
    logger.info(`[VideoExtraction] Analyzing frames for project: ${projectId}`);
    const analysisResult = await VisionService.analyzeFrames(framesDir);
    logger.info(`[VideoExtraction] Analysis complete. Summary: ${analysisResult.sceneSummary || 'none'}`);

    // 3. Score templates using the new dynamic scorer
    const scoredTemplateId = TemplateScorer.scoreTemplates(analysisResult);
    logger.info(`[VideoExtraction] Best matching template: ${scoredTemplateId}`);

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
        themes: analysisResult.visibleElements || [], // Map to existing field for schema compat
        mood: analysisResult.lightingCharacteristics?.[0] || 'neutral',
        aesthetics: analysisResult.dominantColors?.[0] || 'standard',
        templateId: scoredTemplateId,
        rawVisionData: { vision: analysisResult, groq: groqResult } as any,
      },
      create: {
        projectId,
        themes: analysisResult.visibleElements || [],
        mood: analysisResult.lightingCharacteristics?.[0] || 'neutral',
        aesthetics: analysisResult.dominantColors?.[0] || 'standard',
        templateId: scoredTemplateId,
        rawVisionData: { vision: analysisResult, groq: groqResult } as any,
      },
    });

    await prisma.project.update({
      where: { id: projectId },
      data: {
        generatedCaption: groqResult.captions?.[0] || null,
        generatedHashtags: groqResult.hashtags || [],
      }
    });

    // 5. Dispatch render job using the chosen template and passing groqData
    await QueueService.addRenderJob(projectId, scoredTemplateId, groqResult);

    logger.info(`[VideoExtraction] Extraction finished. Redis updates: ${redisUpdateCount}, Postgres updates: ${redisUpdateCount}`);

    return { framesDir, analysisResult, groqResult };
  }, 2);
};
