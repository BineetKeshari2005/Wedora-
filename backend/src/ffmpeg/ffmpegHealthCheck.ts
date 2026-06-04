import { exec } from 'child_process';
import util from 'util';
import { logger } from '../utils/logger';

const execAsync = util.promisify(exec);

export const ffmpegCapabilities = {
  hasDrawtextSupport: false,
};

/**
 * Runs on startup to verify if the local FFmpeg build supports
 * freetype / drawtext. Updates the global capabilities object.
 */
export const runFFmpegHealthCheck = async () => {
  try {
    // Check available filters
    const { stdout, stderr } = await execAsync('/opt/homebrew/bin/ffmpeg -filters');
    
    if (stdout.includes('drawtext') || stderr.includes('drawtext')) {
      ffmpegCapabilities.hasDrawtextSupport = true;
      logger.info('[FFmpeg Health] drawtext filter is supported. Text overlays enabled.');
    } else {
      ffmpegCapabilities.hasDrawtextSupport = false;
      logger.warn('[FFmpeg Health] drawtext filter missing. Text overlays will be gracefully skipped.');
      logger.warn('[FFmpeg Health] Fix: run `brew reinstall ffmpeg --with-freetype`');
    }
  } catch (err) {
    logger.error('[FFmpeg Health] Failed to verify FFmpeg filters', err);
    ffmpegCapabilities.hasDrawtextSupport = false;
  }
};
