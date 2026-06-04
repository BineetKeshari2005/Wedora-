import { FFmpegEngine } from '../engine';
import { ScaleFilter } from '../filters/scale.filter';
import { TextFilter } from '../filters/text.filter';
import fs from 'fs';

export class CinematicFadeTemplate {
  /**
   * Orchestrates the complex filtergraph for the cinematic fade template.
   * Takes an input video, center-crops it for Reels, applies a slight Ken Burns zoom, 
   * overlays elegant text, and saves it.
   */
  static async render(
    inputUrl: string, 
    outputPath: string, 
    onProgress?: (percent: number) => void
  ): Promise<string> {
    
    // We construct the filtergraph by chaining our modular filters
    const scaleFilter = ScaleFilter.reelScale('[0:v]', '[scaled]');
    const zoomFilter = '[scaled]zoompan=z=\'min(zoom+0.0015,1.5)\':d=125[zoomed]';
    const textFilter = TextFilter.drawCenteredText('[zoomed]', 'Beautiful Moments', '[outv]');

    const filterComplex = `${scaleFilter};${zoomFilter};${textFilter}`;

    const args = [
      '-y',                // Overwrite
      '-i', inputUrl,      // Input video
      '-filter_complex', filterComplex, // The massive filter chain we just built
      '-map', '[outv]',    // Map the final video stream
      '-map', '0:a?',      // Map original audio (if it exists)
      '-c:v', 'libx264',   // Standard H.264 codec
      '-preset', 'fast',   // Encoding speed
      '-crf', '23',        // Visual quality (lower is better, 23 is default)
      '-c:a', 'aac',       // Standard audio codec
      outputPath
    ];

    // Assuming 15 second average duration for progress calculation
    await FFmpegEngine.execute(args, 15, onProgress);

    return outputPath;
  }
}
