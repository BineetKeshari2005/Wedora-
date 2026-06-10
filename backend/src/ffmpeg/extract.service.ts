import fs from 'fs';
import path from 'path';
import { FFmpegEngine } from './engine';
import { logger } from '../utils/logger';

export class ExtractService {
  /**
   * Extracts 1 frame every X seconds from a video URL.
   */
  static async extractFrames(
    projectId: string, 
    videoUrl: string, 
    intervalSec: number = 1,
    onProgress?: (percent: number) => void
  ): Promise<string> {
    
    // Create a temporary directory to hold the frames
    const outputDir = path.join('/tmp/wedora/frames', projectId);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPattern = path.join(outputDir, 'frame_%04d.jpg');

    const args = [
      '-y', // Overwrite output files
      '-i', videoUrl, // Input video URL
      '-vf', `fps=1/${intervalSec}`, // Extract 1 frame every `intervalSec` seconds
      '-q:v', '2', // High quality JPEG
      outputPattern
    ];

    logger.info(`Extracting frames to ${outputDir}...`);
    
    // Note: We pass 100 for total duration as a dummy value here since we don't know the remote URL duration easily without ffprobe.
    // In production, you would run ffprobe first.
    await FFmpegEngine.execute(args, 100, onProgress);
    
    return outputDir;
  }
}
