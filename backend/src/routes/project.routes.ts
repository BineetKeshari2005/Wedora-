import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ContentService } from '../services/content.service';
import { Platform } from '@prisma/client';
import { logger } from '../utils/logger';
import { validateVideoEditIntent, saveVideoEditIntent } from '../services/video-edit-intent.service';

const router = Router();

// GET /api/project
// List all projects
router.get('/', async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(projects);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// GET /api/project/:projectId
router.get('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        analysis: true
      }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const rawData = project.analysis?.rawVisionData as any;
    const groqData = rawData?.groq;

    res.json({
      ...project,
      projectId: project.id,
      captions: project.generatedCaption ? [project.generatedCaption] : (groqData?.captions || []),
      hashtags: project.generatedHashtags?.length ? project.generatedHashtags : (groqData?.hashtags || []),
      templateId: project.analysis?.templateId || 'default',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch project status' });
  }
});

// PATCH /api/project/:projectId
router.patch('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { generatedCaption, generatedHashtags } = req.body;
    
    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...(generatedCaption !== undefined && { generatedCaption }),
        ...(generatedHashtags !== undefined && { generatedHashtags }),
      }
    });

    res.json(updatedProject);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// DELETE /api/project/:projectId
router.delete('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    await prisma.project.delete({
      where: { id: projectId }
    });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// POST /api/project/:projectId/duplicate
router.post('/:projectId/duplicate', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await prisma.project.findUnique({
      where: { id: projectId }
    });
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const newProject = await prisma.project.create({
      data: {
        title: `${project.title} (Copy)`,
        userId: project.userId,
        renderedVideoUrl: project.renderedVideoUrl,
        renderStatus: project.renderStatus,
        userContext: project.userContext || undefined,
        generatedCaption: project.generatedCaption,
        generatedHashtags: project.generatedHashtags,
      }
    });

    res.json(newProject);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to duplicate project' });
  }
});

// POST /api/project/:projectId/save-intent (Save VideoEditIntent only — no rendering)
router.post('/:projectId/save-intent', async (req, res) => {
  const { projectId } = req.params;
  const { editIntent } = req.body;

  logger.info(`[SaveIntent] Received intent for project ${projectId}`, { raw: editIntent });

  // 1. Verify project exists
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    logger.warn(`[SaveIntent] Project ${projectId} not found`);
    return res.status(404).json({ error: 'Project not found.' });
  }

  // 2. Validate
  const { valid, errors, sanitised } = validateVideoEditIntent(editIntent);
  if (!valid) {
    logger.warn(`[SaveIntent] Validation failed for project ${projectId}`, { errors });
    // We still save with defaults — errors are warnings for the frontend
  }

  // 3. Save
  try {
    await saveVideoEditIntent(projectId, sanitised);
    logger.info(`[SaveIntent] Intent saved for project ${projectId}`, { sanitised });

    res.json({
      success: true,
      message: 'VideoEditIntent saved.',
      intent: sanitised,
      warnings: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    logger.error(`[SaveIntent] Failed to save intent for project ${projectId}`, error);
    res.status(500).json({ error: 'Failed to save VideoEditIntent.' });
  }
});

// POST /api/project/:projectId/start-edit (V2 Pipeline — saves intent AND starts rendering)
router.post('/:projectId/start-edit', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { editPreferences } = req.body;

    logger.info(`[StartEdit] Received V2 edit request for project ${projectId}`);

    // 1. Validate the incoming intent
    const { valid, errors, sanitised } = validateVideoEditIntent(editPreferences);
    if (!valid) {
      logger.warn(`[StartEdit] Validation warnings for project ${projectId}`, { errors });
    }

    // 2. Save the validated intent to the project
    await saveVideoEditIntent(projectId, sanitised);
    logger.info(`[StartEdit] Intent saved for project ${projectId}`, { sanitised });

    // 3. Update render status
    await prisma.project.update({
      where: { id: projectId },
      data: { renderStatus: 'PENDING' }
    });

    const video = await prisma.video.findFirst({ where: { projectId, type: 'RAW' } });
    if (!video) {
      logger.error(`[StartEdit] No RAW video found for project ${projectId}`);
      return res.status(404).json({ error: 'Raw video not found for project.' });
    }

    // 4. Dispatch the V2 EditPlan Job
    const { QueueService } = require('../services/queue.service');
    const job = await QueueService.addEditPlanJob(
      projectId, 
      video.id, 
      video.url, 
      sanitised
    );
    logger.info(`[StartEdit] Dispatched EditPlan job ${job.id} for project ${projectId}`);

    // 5. Create or update the RenderJob record
    await prisma.renderJob.upsert({
      where: { bullMqJobId: job.id },
      create: {
        projectId,
        status: 'PENDING',
        bullMqJobId: job.id,
      },
      update: {
        status: 'PENDING',
        bullMqJobId: job.id,
      }
    });

    res.json({
      success: true,
      message: 'EditPlan V2 pipeline started.',
      job: job.id,
      intent: sanitised,
      warnings: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    logger.error(`[StartEdit] Error starting V2 pipeline`, error);
    res.status(500).json({ error: 'Failed to start V2 edit pipeline' });
  }
});


// --- Content Management Endpoints ---

// GET /api/project/:projectId/content
router.get('/:projectId/content', async (req, res) => {
  try {
    const { projectId } = req.params;
    const contents = await ContentService.getByProject(projectId);
    res.json(contents);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch platform contents' });
  }
});

// POST /api/project/:projectId/content/generate
router.post('/:projectId/content/generate', async (req, res) => {
  try {
    const { projectId } = req.params;
    await ContentService.generateForAllPlatforms(projectId);
    const contents = await ContentService.getByProject(projectId);
    res.json(contents);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Failed to generate contents' });
  }
});

// GET /api/project/:projectId/content/:platform
router.get('/:projectId/content/:platform', async (req, res) => {
  try {
    const { projectId, platform } = req.params;
    const content = await prisma.platformContent.findUnique({
      where: { projectId_platform: { projectId, platform: platform as Platform } }
    });
    if (!content) return res.status(404).json({ error: 'Content not found' });
    res.json(content);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch platform content' });
  }
});

// POST /api/project/:projectId/content/:platform/regenerate
router.post('/:projectId/content/:platform/regenerate', async (req, res) => {
  try {
    const { projectId, platform } = req.params;
    const content = await ContentService.regenerate(projectId, platform as Platform);
    res.json(content);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Failed to regenerate content' });
  }
});

// PATCH /api/project/:projectId/content/:platform
router.patch('/:projectId/content/:platform', async (req, res) => {
  try {
    const { projectId, platform } = req.params;
    const updates = req.body;
    const content = await prisma.platformContent.findUnique({
      where: { projectId_platform: { projectId, platform: platform as Platform } }
    });
    if (!content) return res.status(404).json({ error: 'Content not found' });
    
    const updated = await ContentService.update(content.id, updates);
    res.json(updated);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Failed to update content' });
  }
});

export default router;
