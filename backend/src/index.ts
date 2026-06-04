// backend/src/index.ts
import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import uploadRoutes from './routes/upload.routes';
import projectRoutes from './routes/project.routes';
import jobRoutes from './routes/job.routes';
import { startAllWorkers } from './workers';
import { runFFmpegHealthCheck } from './ffmpeg/ffmpegHealthCheck';

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Register the routes
app.use('/api', uploadRoutes);
app.use('/api/project', projectRoutes);
app.use('/api', jobRoutes);

app.get('/', (req: Request, res: Response) => {
  res.send('Wedora API is running');
});

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start listening for background jobs
runFFmpegHealthCheck().then(() => {
  startAllWorkers();
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
