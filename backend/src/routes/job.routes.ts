import { Router } from 'express';
import { JobController } from '../controllers/job.controller';

const router = Router();

router.get('/jobs/:projectId', JobController.getJobStatus);

export default router;
