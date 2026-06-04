import { Router } from 'express';
import { uploadMiddleware } from '../middlewares/upload';
import { UploadController } from '../controllers/upload.controller';

const router = Router();

// Define the POST /api/upload route
// 1. `uploadMiddleware.single('video')` tells Multer to look for a file field named 'video'
// 2. If it passes Multer, it moves to `UploadController.uploadVideo`
router.post('/upload', uploadMiddleware.single('video'), UploadController.uploadVideo);

export default router;
