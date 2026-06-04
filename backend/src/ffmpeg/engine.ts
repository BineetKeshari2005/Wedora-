import { spawn } from 'child_process';
import { logger } from '../utils/logger';

export class FFmpegEngine {
  /**
   * Safely executes an FFmpeg command via child_process.
   * Parses the output to provide percentage-based progress updates.
   * 
   * @param args The array of FFmpeg arguments (e.g., ['-i', 'input.mp4', ...])
   * @param totalDurationSec The total duration of the video (used to calculate progress %)
   * @param onProgress Callback function that fires with progress (0-100)
   */
  static execute(
    args: string[], 
    totalDurationSec: number, 
    onProgress?: (percent: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info(`Starting FFmpeg with args: ffmpeg ${args.join(' ')}`);
      
      const ffmpeg = spawn('ffmpeg', args);

      // FFmpeg outputs logs and progress to stderr, not stdout
      ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();
        
        // Parse the time=00:00:05.00 string to calculate progress
        if (onProgress && totalDurationSec > 0) {
          const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
          if (timeMatch) {
            const hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const seconds = parseFloat(timeMatch[3]);
            
            const currentSec = hours * 3600 + minutes * 60 + seconds;
            const percent = Math.min(100, Math.round((currentSec / totalDurationSec) * 100));
            
            onProgress(percent);
          }
        }
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (err) => {
        logger.error('Failed to start FFmpeg process', err);
        reject(err);
      });
    });
  }
}
