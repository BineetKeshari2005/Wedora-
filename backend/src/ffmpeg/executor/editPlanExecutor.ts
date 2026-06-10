import ffmpeg from '../../ffmpeg/ffmpeg.config';
import { logger } from '../../utils/logger';
import { EditPlan } from '../../schemas/editPlan';
import { VideoMetadata } from '../../services/ffprobe.service';

export class EditPlanExecutor {
  static async execute(
    inputVideo: string,
    outputPath: string,
    onProgress: (pct: number) => void,
    editPlan: EditPlan,
    metadata: VideoMetadata
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputVideo);
      const filters: string[] = [];
      
      let currentV = '0:v';
      let currentA = metadata.hasAudio ? '0:a' : null;
      let duration = metadata.duration;

      // 1. Trim Strategy
      if (editPlan.trimStrategy?.enabled) {
        const start = editPlan.trimStrategy.startTime;
        const end = editPlan.trimStrategy.endTime;
        duration = end - start;
        
        filters.push(`[${currentV}]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v_trimmed]`);
        currentV = 'v_trimmed';

        if (currentA) {
          filters.push(`[${currentA}]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a_trimmed]`);
          currentA = 'a_trimmed';
        }
      }

      // 2. Aspect Ratio (Scale & Pad)
      if (editPlan.aspectRatio && editPlan.aspectRatio !== 'original') {
        const ratios: Record<string, string> = {
          '16:9': 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
          '9:16': 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
          '1:1': 'scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2'
        };
        const scaleFilter = ratios[editPlan.aspectRatio];
        if (scaleFilter) {
          filters.push(`[${currentV}]${scaleFilter}[v_scaled]`);
          currentV = 'v_scaled';
        }
      }

      // 3. Intro/Outro Handling (Fade)
      if (editPlan.transitionStyle === 'fade') {
        const fadeDuration = 1;
        const fadeOutStart = Math.max(0, duration - fadeDuration);
        
        filters.push(`[${currentV}]fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${fadeOutStart}:d=${fadeDuration}[v_faded]`);
        currentV = 'v_faded';

        if (currentA) {
          filters.push(`[${currentA}]afade=t=in:st=0:d=${fadeDuration},afade=t=out:st=${fadeOutStart}:d=${fadeDuration}[a_faded]`);
          currentA = 'a_faded';
        }
      }

      // 4. Overlays
      if (editPlan.overlays && editPlan.overlays.length > 0) {
        let lastV = currentV;
        editPlan.overlays.forEach((overlay, idx) => {
          const nextV = `v_text_${idx}`;
          const safeText = overlay.text.replace(/'/g, "\u2019").replace(/:/g, "\\:");
          let yPos = '(h-text_h)/2';
          if (overlay.position === 'top') yPos = 'h*0.1';
          if (overlay.position === 'bottom') yPos = 'h*0.8';

          const enableStr = `between(t, ${overlay.startTime}, ${overlay.endTime})`;
          
          filters.push(`[${lastV}]drawtext=text='${safeText}':fontsize=48:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=10:x=(w-text_w)/2:y=${yPos}:enable='${enableStr}'[${nextV}]`);
          lastV = nextV;
        });
        currentV = lastV;
      }

      // Apply Filters
      if (filters.length > 0) {
        const mapOutputs = [currentV];
        if (currentA) mapOutputs.push(currentA);
        command.complexFilter(filters.join(';'), mapOutputs);
      }

      const { fps, format } = editPlan.renderSettings || {};
      
      const targetFps = fps || metadata.fps || 30;

      command
        .videoCodec('libx264')
        .outputOptions([
          '-preset fast',
          '-crf 22',
          '-pix_fmt yuv420p',
          `-r ${targetFps}`
        ]);

      if (currentA) {
        command.audioCodec('aac');
      }

      command
        .toFormat(format || 'mp4')
        .save(outputPath)
        .on('start', (cmd) => {
          logger.info(`[EditPlanExecutor V1] FFmpeg started`, { cmd });
        })
        .on('progress', (progress) => {
          if (progress.percent) onProgress(progress.percent);
        })
        .on('error', (err, stdout, stderr) => {
          logger.error(`[EditPlanExecutor V1] Render failed`, { err: err.message, stderr });
          reject(err);
        })
        .on('end', () => {
          logger.info(`[EditPlanExecutor V1] Render completed successfully`);
          onProgress(100);
          resolve();
        });
    });
  }
}
