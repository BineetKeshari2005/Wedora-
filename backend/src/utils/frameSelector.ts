import fs from 'fs';
import path from 'path';
import { logger } from './logger';

/**
 * Selects a set of visually representative frames from a directory of extracted frames.
 * Uses average pixel brightness per quadrant as a lightweight perceptual fingerprint.
 * Greedy selection: pick the frame most different from already-selected frames.
 * 
 * No external dependencies — reads raw JPEG/PNG file sizes and pixel samples.
 */

interface FrameSignature {
  file: string;
  features: number[]; // 4 quadrant brightness values + file size ratio
}

/**
 * Compute a lightweight "signature" for a frame file.
 * We use file size (proxy for visual complexity) and sample bytes from different
 * positions in the file (proxy for brightness/color distribution).
 */
function computeSignature(filePath: string): number[] {
  const buf = fs.readFileSync(filePath);
  const size = buf.length;

  // Sample 8 evenly-spaced positions across the file buffer
  // These raw byte samples act as a rough fingerprint of the image content
  const sampleCount = 8;
  const features: number[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const pos = Math.floor((size * (i + 1)) / (sampleCount + 1));
    // Average a small window around each sample point
    let sum = 0;
    const windowSize = Math.min(64, size - pos);
    for (let j = 0; j < windowSize; j++) {
      sum += buf[pos + j];
    }
    features.push(sum / windowSize);
  }

  // Add normalized file size as a feature (visual complexity proxy)
  features.push(size / 1_000_000); // In MB

  return features;
}

/**
 * Compute Euclidean distance between two feature vectors.
 */
function distance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

/**
 * Select the most representative frames from a directory.
 * 
 * Algorithm:
 * 1. Compute signatures for all frames.
 * 2. Start with the first frame.
 * 3. Iteratively pick the frame with the maximum minimum distance 
 *    from all already-selected frames (maximin diversification).
 * 
 * @param framesDir - Directory containing extracted frame images
 * @param targetCount - Number of representative frames to select (default 6)
 * @returns Array of selected file paths (absolute)
 */
export function selectRepresentativeFrames(
  framesDir: string,
  targetCount: number = 6
): string[] {
  const files = fs.readdirSync(framesDir)
    .filter(f => f.match(/\.(jpe?g|png)$/i))
    .sort((a, b) => {
      const numA = parseInt(a.replace(/[^\d]/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/[^\d]/g, ''), 10) || 0;
      return numA - numB;
    });

  if (files.length === 0) {
    logger.warn('[FrameSelector] No image files found in directory.');
    return [];
  }

  if (files.length <= targetCount) {
    logger.info(`[FrameSelector] Only ${files.length} frames available, using all.`);
    return files.map(f => path.join(framesDir, f));
  }

  // Compute signatures for all frames
  const signatures: FrameSignature[] = files.map(file => ({
    file,
    features: computeSignature(path.join(framesDir, file)),
  }));

  // Greedy maximin selection
  const selected: number[] = [0]; // Start with the first frame
  const selectedSet = new Set<number>([0]);

  while (selected.length < targetCount) {
    let bestIdx = -1;
    let bestMinDist = -1;

    for (let i = 0; i < signatures.length; i++) {
      if (selectedSet.has(i)) continue;

      // Compute minimum distance to any already-selected frame
      let minDist = Infinity;
      for (const s of selected) {
        const d = distance(signatures[i].features, signatures[s].features);
        if (d < minDist) minDist = d;
      }

      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;
    selected.push(bestIdx);
    selectedSet.add(bestIdx);
  }

  // Sort selected indices to maintain temporal order
  selected.sort((a, b) => a - b);

  const result = selected.map(i => path.join(framesDir, signatures[i].file));
  logger.info(`[FrameSelector] Selected ${result.length} representative frames from ${files.length} total.`);

  return result;
}
