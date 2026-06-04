import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class JobController {
  static async getJobStatus(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      const job = await prisma.renderJob.findFirst({
        where: { projectId },
        orderBy: { createdAt: 'desc' }
      });
      
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      
      res.json(job);
    } catch (error) {
      console.error('Error fetching job status:', error);
      res.status(500).json({ error: 'Failed to fetch job status' });
    }
  }
}
