import { z } from 'zod';

export const OverlayPlanSchema = z.object({
  text: z.string().default(''),
  startTime: z.number().min(0).default(0),
  endTime: z.number().min(0).default(0),
  position: z.enum(['top', 'center', 'bottom']).default('center'),
  placement: z.enum(['video', 'header']).optional().default('video'),
});

export const RenderSettingsSchema = z.object({
  resolution: z.string().default('1080p'),
  fps: z.number().default(30),
  format: z.string().default('mp4'),
}).passthrough(); // Preserve compatibility with future versions

export const TrimStrategySchema = z.object({
  enabled: z.boolean().default(false),
  startTime: z.number().min(0).default(0),
  endTime: z.number().min(0).default(0),
});

export const EditPlanSchema = z.object({
  version: z.string().default('3.0'),
  editingStyle: z.string().default('standard'),
  editingIntensity: z.enum(['low', 'medium', 'high']).default('medium'),
  transitionStyle: z.enum(['none', 'fade', 'slide', 'zoom']).default('none'),
  cutFrequency: z.enum(['slow', 'normal', 'fast']).default('normal'),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', 'original']).default('original'),
  trimStrategy: TrimStrategySchema.optional(),
  overlays: z.array(OverlayPlanSchema).default([]),
  
  // V3 Header/Footer Feature
  showFooter: z.boolean().optional(),
  footerText: z.string().optional(),

  renderSettings: RenderSettingsSchema.default({
    resolution: '1080p',
    fps: 30,
    format: 'mp4'
  }),
}).passthrough(); // Preserve compatibility with future versions

export type OverlayPlan = z.infer<typeof OverlayPlanSchema>;
export type EditPlan = z.infer<typeof EditPlanSchema>;
export type RenderSettings = z.infer<typeof RenderSettingsSchema>;

// Helper to validate and log
export function validateEditPlan(data: unknown, logger?: (msg: string, data?: any) => void): EditPlan {
  try {
    const parsed = EditPlanSchema.parse(data);
    if (logger) {
      logger('Generated EditPlan validated successfully', { version: parsed.version });
    } else {
      console.log('Generated EditPlan validated successfully:', JSON.stringify(parsed, null, 2));
    }
    return parsed;
  } catch (error) {
    if (logger) {
      logger('Failed to validate EditPlan. Rejecting malformed AI output.', { error });
    } else {
      console.error('Failed to validate EditPlan. Rejecting malformed AI output:', error);
    }
    throw error;
  }
}
