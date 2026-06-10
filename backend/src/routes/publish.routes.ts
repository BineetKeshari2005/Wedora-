import { Router } from 'express';
import { PublishService } from '../services/publish.service';
import { Platform } from '@prisma/client';
import { prisma } from '../lib/prisma';

const router = Router();

// POST /api/publish
// Body: { projectId: string, platforms: string[], scheduledFor?: string }
router.post('/', async (req, res) => {
  try {
    const { projectId, platforms, scheduledFor } = req.body;
    const guestUser = await prisma.user.findUnique({ where: { email: 'guest@wedora.local' } });
    if (!guestUser) {
      return res.status(400).json({ error: 'Guest user not found' });
    }
    const resolvedUserId = guestUser.id;

    if (!projectId || !platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ error: 'projectId and platforms[] are required' });
    }

    const validPlatforms = platforms.map(p => p.toUpperCase() as Platform);
    const scheduledDate = scheduledFor ? new Date(scheduledFor) : undefined;
    const results = await PublishService.publish(projectId, validPlatforms, resolvedUserId, scheduledDate);

    res.status(202).json({ message: 'Publishing initiated', results });
  } catch (err: any) {
    console.error('[PublishRoute] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to initiate publishing' });
  }
});

// GET /api/publish/:projectId/status
router.get('/:projectId/status', async (req, res) => {
  try {
    const { projectId } = req.params;
    const statuses = await PublishService.getPublishStatus(projectId);
    res.json(statuses);
  } catch (err: any) {
    console.error('[PublishRoute] Status error:', err);
    res.status(500).json({ error: 'Failed to fetch publish status' });
  }
});

// POST /api/publish/:projectId/retry/:platform
router.post('/:projectId/retry/:platform', async (req, res) => {
  try {
    const { projectId, platform } = req.params;
    const upperPlatform = platform.toUpperCase() as Platform;
    const result = await PublishService.retry(projectId, upperPlatform);
    res.json(result);
  } catch (err: any) {
    console.error('[PublishRoute] Retry error:', err);
    res.status(500).json({ error: err.message || 'Failed to retry publishing' });
  }
});

export default router;
