import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class PreviewController {
  /**
   * GET /api/preview/:projectId
   * Returns the processed video URL (if available) and an optional AI‑generated caption.
   */
  static async getPreview(req: Request, res: Response): Promise<void> {
    const { projectId } = req.params;
    if (!projectId) {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }
    try {
      // 1️⃣ Processed video (final reel)
      const video = await prisma.video.findFirst({
        where: { projectId, type: 'PROCESSED' },
      });

      // 2️⃣ AI analysis – we look for a caption inside rawVisionData if it exists
      const analysis = await prisma.aiAnalysis.findUnique({
        where: { projectId },
      });

      const caption = analysis?.rawVisionData && typeof analysis.rawVisionData === 'object' && 'caption' in analysis.rawVisionData
        ? (analysis.rawVisionData as any).caption
        : undefined;

      res.status(200).json({
        videoUrl: video?.url ?? null,
        caption: caption ?? null,
      });
    } catch (err) {
      console.error('Preview error:', err);
      res.status(500).json({ error: 'Failed to fetch preview data' });
    }
  }
}
