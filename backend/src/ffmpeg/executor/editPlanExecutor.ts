import ffmpeg from '../../ffmpeg/ffmpeg.config';
import { logger } from '../../utils/logger';
import path from 'path';
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

      // 2. Aspect Ratio (Scale & Layout)
      if (editPlan.version === '3.0') {
        // ─── V3 Dynamic Canvas Composition Engine ─────────────────────────
        const canvasW = 1080;
        const canvasH = 1920;

        // Separate overlays by placement
        const headerOverlays = (editPlan.overlays || []).filter(o => o.placement === 'header');
        const videoOverlays = (editPlan.overlays || []).filter(o => o.placement === 'video' || !o.placement);

        // Define elegant font for premium feel
        const fontPath = path.resolve(process.cwd(), 'assets/fonts/PlayfairDisplay-Italic.ttf');

        // Helper: escape text for FFmpeg drawtext
        const escapeText = (t: string) => t.replace(/\\/g, '\\\\').replace(/'/g, '\u2019').replace(/:/g, '\\:').replace(/%/g, '%%');

        // ─── Header Metrics ──────────────────────────────────────────────
        const headerFontSize = 72;
        const headerLineH = Math.ceil(headerFontSize * 1.5);
        const headerPadY = 28;
        let maxHeaderLines = 0;
        headerOverlays.forEach(o => {
          const lines = o.text.split('\n').filter(l => l.trim().length > 0).length;
          if (lines > maxHeaderLines) maxHeaderLines = lines;
        });
        const headerHeight = maxHeaderLines > 0
          ? maxHeaderLines * headerLineH + headerPadY * 2
          : 0;

        // ─── Footer Metrics ──────────────────────────────────────────────
        const footerFontSize = 56;
        const footerLineH = Math.ceil(footerFontSize * 1.5);
        const footerPadY = 24;
        const footerTextLines: string[] = (editPlan.showFooter && editPlan.footerText)
          ? editPlan.footerText.split('\n').filter((l: string) => l.trim().length > 0)
          : [];
        const footerHeight = footerTextLines.length > 0
          ? footerTextLines.length * footerLineH + footerPadY * 2
          : 0;

        // ─── Available Video Area ────────────────────────────────────────
        const availVideoH = canvasH - headerHeight - footerHeight;

        logger.info('[EditPlanExecutor] V3 Layout Metrics', {
          headerHeight, footerHeight, availVideoH,
          headerOverlays: headerOverlays.length,
          videoOverlays: videoOverlays.length,
          footerLines: footerTextLines.length,
        });

        // ─── Compose Canvas ──────────────────────────────────────────────
        if (headerHeight > 0 || footerHeight > 0) {
          // Black canvas + video overlay approach — zero wasted space
          filters.push(`color=c=black:s=${canvasW}x${canvasH}:d=${duration}:r=${metadata.fps || 30}[bg]`);
          filters.push(`[${currentV}]scale=${canvasW}:${availVideoH}:force_original_aspect_ratio=increase,crop=${canvasW}:${availVideoH}[vid_scaled]`);
          filters.push(`[bg][vid_scaled]overlay=x=0:y=${headerHeight}:shortest=1[composed]`);
          currentV = 'composed';
        } else {
          // No header/footer — scale to full canvas
          filters.push(`[${currentV}]scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH}[v_scaled]`);
          currentV = 'v_scaled';
        }

        // ─── Draw Header Text ────────────────────────────────────────────
        headerOverlays.forEach((overlay, oIdx) => {
          const lines = overlay.text.split('\n');
          let hdrLineIdx = 0;
          
          let alphaExpr = '1';
          let enableStr = '';
          if (overlay.startTime !== undefined && overlay.endTime !== undefined && overlay.endTime > overlay.startTime) {
            const st = overlay.startTime;
            const et = overlay.endTime;
            // 400ms fade in and fade out
            alphaExpr = `if(lt(t,${st}+0.4),(t-${st})/0.4,if(gt(t,${et}-0.4),(${et}-t)/0.4,1))`;
            enableStr = `:enable='between(t,${st},${et})'`;
          } else if (overlay.startTime !== undefined) {
            const st = overlay.startTime;
            alphaExpr = `if(lt(t,${st}+0.4),(t-${st})/0.4,1)`;
            enableStr = `:enable='gte(t,${st})'`;
          }

          lines.forEach((line: string) => {
            if (!line.trim()) return;
            const safe = escapeText(line);
            
            // All headers share the exact same top padding and Y coordinate structure
            // They draw into the exact same fixed header container.
            const yPos = headerPadY + hdrLineIdx * headerLineH;
            const tag = `v_hdr_${oIdx}_${hdrLineIdx}`;

            filters.push(`[${currentV}]drawtext=text='${safe}':fontfile='${fontPath}':fontsize=${headerFontSize}:fontcolor=white:alpha='${alphaExpr}':x=(w-text_w)/2:y=${yPos}${enableStr}[${tag}]`);
            currentV = tag;
            hdrLineIdx++;
          });
        });

        // ─── Draw Video Overlays (on top of video area) ──────────────────
        videoOverlays.forEach((overlay, idx) => {
          const safe = escapeText(overlay.text);
          const tag = `v_vid_${idx}`;
          // Center vertically within the video region
          const videoCenterY = headerHeight + Math.floor(availVideoH / 2);
          const yPos = `${videoCenterY}-(text_h/2)`;

          let alphaExpr = '1';
          let enableStr = '';
          if (overlay.startTime !== undefined && overlay.endTime !== undefined && overlay.endTime > overlay.startTime) {
            const st = overlay.startTime;
            const et = overlay.endTime;
            alphaExpr = `if(lt(t,${st}+0.4),(t-${st})/0.4,if(gt(t,${et}-0.4),(${et}-t)/0.4,1))`;
            enableStr = `:enable='between(t,${st},${et})'`;
          } else if (overlay.startTime !== undefined) {
            const st = overlay.startTime;
            alphaExpr = `if(lt(t,${st}+0.4),(t-${st})/0.4,1)`;
            enableStr = `:enable='gte(t,${st})'`;
          }

          filters.push(`[${currentV}]drawtext=text='${safe}':fontsize=48:fontcolor=white:alpha='${alphaExpr}':box=1:boxcolor=black@0.5:boxborderw=10:x=(w-text_w)/2:y=${yPos}${enableStr}[${tag}]`);
          currentV = tag;
        });

        // ─── Draw Footer Text ────────────────────────────────────────────
        if (footerTextLines.length > 0) {
          const footerStartY = canvasH - footerHeight + footerPadY;
          footerTextLines.forEach((line: string, li: number) => {
            const safe = escapeText(line);
            const yPos = footerStartY + li * footerLineH;
            const tag = `v_ftr_${li}`;

            filters.push(`[${currentV}]drawtext=text='${safe}':fontfile='${fontPath}':fontsize=${footerFontSize}:fontcolor=white:x=(w-text_w)/2:y=${yPos}[${tag}]`);
            currentV = tag;
          });
        }
        // ─── End V3 Layout ────────────────────────────────────────────────
      } else if (editPlan.aspectRatio && editPlan.aspectRatio !== 'original') {
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

      // 4. Overlays (V1/V2)
      if (editPlan.version !== '3.0' && editPlan.overlays && editPlan.overlays.length > 0) {
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

      // 4.5. V3 Overlays — handled inline during canvas composition above (section 2)

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
          '-preset slow',
          '-crf 18',
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
          logger.info(`[EditPlanExecutor] FFmpeg started (Version ${editPlan.version})`, { cmd });
        })
        .on('progress', (progress) => {
          if (progress.percent) onProgress(progress.percent);
        })
        .on('error', (err, stdout, stderr) => {
          logger.error(`[EditPlanExecutor] Render failed`, { err: err.message, stderr });
          reject(err);
        })
        .on('end', () => {
          logger.info(`[EditPlanExecutor] Render completed successfully`);
          onProgress(100);
          resolve();
        });
    });
  }
}
