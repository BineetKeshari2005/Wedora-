import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

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
      projectId: project.id,
      renderStatus: project.renderStatus,
      renderedVideoUrl: project.renderedVideoUrl,
      captions: groqData?.captions || [],
      hashtags: groqData?.hashtags || [],
      templateId: project.analysis?.templateId || 'default',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch project status' });
  }
});

export default router;
