import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
// Using global fetch (Node 18+). No import needed.
// Using require to avoid type issues for unzipper
// eslint-disable-next-line @typescript-eslint/no-var-requires
const unzipper = require('unzipper');

import { pipeline } from 'stream';
import { promisify } from 'util';
const streamPipeline = promisify(pipeline);

/**
 * Path where the static FFmpeg binary will be stored.
 */
export const FFMPEG_DIR = path.resolve(__dirname, '../../ffmpeg');
export const FFMPEG_BIN = path.join(FFMPEG_DIR, os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

/**
 * Downloads and extracts a static FFmpeg binary if it does not already exist.
 * The URL must point to a zip/tar archive that contains the `ffmpeg` executable.
 */
export async function ensureFFmpeg(downloadUrl: string = process.env.FFMPEG_DOWNLOAD_URL!): Promise<string> {
  if (!downloadUrl) throw new Error('FFMPEG_DOWNLOAD_URL not set in .env');

  // Ensure target directory exists
  if (!fs.existsSync(FFMPEG_DIR)) {
    fs.mkdirSync(FFMPEG_DIR, { recursive: true });
  }

  // If binary already present, just return it
  if (fs.existsSync(FFMPEG_BIN)) {
    return FFMPEG_BIN;
  }

  console.log('[ffmpegDownloader] Downloading FFmpeg binary...');
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download FFmpeg: ${response.statusText}`);
  }

  // Assume a zip archive – pipe to unzipper
  await streamPipeline(
    response.body as any,
    unzipper.Extract({ path: FFMPEG_DIR })
  );

  // Ensure executable permission on *nix
  if (os.platform() !== 'win32') {
    execSync(`chmod +x ${FFMPEG_BIN}`);
  }

  console.log('[ffmpegDownloader] FFmpeg ready at', FFMPEG_BIN);
  return FFMPEG_BIN;
}
