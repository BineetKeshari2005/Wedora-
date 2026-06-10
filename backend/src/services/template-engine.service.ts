import { readFile } from 'fs/promises';
import path from 'path';
import ffmpeg from '../ffmpeg/ffmpeg.config';
import { buildFilterGraph } from '../ffmpeg/builders/filterGraphBuilder';
import { logger } from '../utils/logger';
import { EditPlan } from '../schemas/editPlan';
import { EditPlanExecutor } from '../ffmpeg/executor/editPlanExecutor';
import { FFprobeService } from './ffprobe.service';

export interface RenderContext {
  templateId: string;
  groqData: any;
  aiAnalysis: any;
}

export class TemplateEngine {
  private static templatesDir = path.resolve(__dirname, '../../templates');

  static async load(templateId: string): Promise<any> {
    try {
      const filePath = path.join(this.templatesDir, `${templateId}.json`);
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      logger.warn(`Template "${templateId}" not found, falling back to default-template.`);
      const defaultPath = path.join(this.templatesDir, `default-template.json`);
      const raw = await readFile(defaultPath, 'utf-8');
      return JSON.parse(raw);
    }
  }

  static async renderTemplate(
    inputVideo: string,
    outputPath: string,
    onProgress: (pct: number) => void,
    renderContext: RenderContext
  ): Promise<void> {
    const tpl = await this.load(renderContext.templateId);
    
    return new Promise((resolve, reject) => {
      let command = ffmpeg(inputVideo);

      const { filters, finalOutput } = buildFilterGraph(tpl, renderContext);
      
      if (filters.length > 0) {
         command.complexFilter(filters, [finalOutput]);
      }

      command
        .videoCodec('libx264')
        .outputOptions([
          '-preset fast',
          '-crf 22',
          '-pix_fmt yuv420p'
        ])
        .save(outputPath)
        .on('start', (cmd) => {
          logger.info(`[FFmpeg] Started rendering template ${renderContext.templateId}`, { cmd });
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            onProgress(progress.percent);
          }
        })
        .on('error', (err, stdout, stderr) => {
          logger.error(`[FFmpeg] Render failed`, { err: err.message, stderr });
          reject(err);
        })
        .on('end', () => {
          logger.info(`[FFmpeg] Render completed successfully for ${renderContext.templateId}`);
          onProgress(100);
          resolve();
        });
    });
  }

  static async renderEditPlan(
    inputVideo: string,
    outputPath: string,
    onProgress: (pct: number) => void,
    editPlan: EditPlan
  ): Promise<void> {
    const metadata = await FFprobeService.getMetadata(inputVideo);
    return EditPlanExecutor.execute(inputVideo, outputPath, onProgress, editPlan, metadata);
  }
}
