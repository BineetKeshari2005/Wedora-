import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VideoEditIntent {
  style: string;
  intensity: string;
  overlayTexts: string[];
  focusArea: string;
  purpose: string;
  referenceVideo: string;
  additionalInstructions: string;
}

// ─── Allowed Values ──────────────────────────────────────────────────────────

const VALID_STYLES = [
  'Luxury',
  'Romantic',
  'Royal Wedding',
  'Cinematic',
  'Viral Reel',
  'Brand Showcase',
  'Minimal Edit',
  'AI Decide',
  'Keep Original Style', // skip-default
];

const VALID_INTENSITIES = [
  'Keep Mostly Original',
  'Moderate Editing',
  'Heavy Transformation',
  'AI Decide',
];

const VALID_FOCUS_AREAS = [
  'Venue',
  'Decor',
  'Couple',
  'Full Wedding Story',
  'AI Decide',
];

const VALID_PURPOSES = [
  'Get More Bookings',
  'Showcase Work',
  'Promote Venue',
  'Social Media Engagement',
  'AI Decide',
];

const REFERENCE_URL_PATTERNS = [
  /^https?:\/\/(www\.)?instagram\.com\//,
  /^https?:\/\/(www\.)?youtube\.com\//,
  /^https?:\/\/youtu\.be\//,
  /^https?:\/\/(www\.)?pinterest\.com\//,
  /^https?:\/\/pin\.it\//,
];

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitised: VideoEditIntent;
}

export function validateVideoEditIntent(raw: any): ValidationResult {
  const errors: string[] = [];

  // Style – optional, defaults to "Keep Original Style"
  let style = typeof raw?.style === 'string' ? raw.style.trim() : '';
  if (style && !VALID_STYLES.includes(style)) {
    errors.push(`Invalid style "${style}". Allowed: ${VALID_STYLES.join(', ')}`);
  }
  if (!style) style = 'Keep Original Style';

  // Intensity – optional, defaults to "AI Decide"
  let intensity = typeof raw?.intensity === 'string' ? raw.intensity.trim() : '';
  if (intensity && !VALID_INTENSITIES.includes(intensity)) {
    errors.push(`Invalid intensity "${intensity}". Allowed: ${VALID_INTENSITIES.join(', ')}`);
  }
  if (!intensity) intensity = 'AI Decide';

  // Overlay texts – array of strings, sanitise
  let overlayTexts: string[] = [];
  if (Array.isArray(raw?.overlayTexts)) {
    overlayTexts = raw.overlayTexts
      .filter((t: any) => typeof t === 'string' && t.trim().length > 0)
      .map((t: string) => t.trim().slice(0, 200)); // cap each at 200 chars
  }

  // Focus area – optional, defaults to "AI Decide"
  let focusArea = typeof raw?.focusArea === 'string' ? raw.focusArea.trim() : '';
  if (focusArea && !VALID_FOCUS_AREAS.includes(focusArea)) {
    errors.push(`Invalid focusArea "${focusArea}". Allowed: ${VALID_FOCUS_AREAS.join(', ')}`);
  }
  if (!focusArea) focusArea = 'AI Decide';

  // Purpose – optional, defaults to "AI Decide"
  let purpose = typeof raw?.purpose === 'string' ? raw.purpose.trim() : '';
  if (purpose && !VALID_PURPOSES.includes(purpose)) {
    errors.push(`Invalid purpose "${purpose}". Allowed: ${VALID_PURPOSES.join(', ')}`);
  }
  if (!purpose) purpose = 'AI Decide';

  // Reference video URL – optional, validate format if provided
  let referenceVideo = typeof raw?.referenceVideo === 'string' ? raw.referenceVideo.trim() : '';
  if (referenceVideo) {
    const isValidUrl = REFERENCE_URL_PATTERNS.some(pattern => pattern.test(referenceVideo));
    if (!isValidUrl) {
      errors.push(`Reference URL must be from Instagram, YouTube, or Pinterest. Got: "${referenceVideo}"`);
      referenceVideo = ''; // strip invalid URL
    }
  }

  // Additional instructions – free text, cap at 1000 chars
  let additionalInstructions = typeof raw?.additionalInstructions === 'string'
    ? raw.additionalInstructions.trim().slice(0, 1000)
    : '';

  const sanitised: VideoEditIntent = {
    style,
    intensity,
    overlayTexts,
    focusArea,
    purpose,
    referenceVideo,
    additionalInstructions,
  };

  return { valid: errors.length === 0, errors, sanitised };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export async function saveVideoEditIntent(
  projectId: string,
  intent: VideoEditIntent
): Promise<void> {
  logger.info(`[VideoEditIntent] Saving intent for project ${projectId}`, {
    style: intent.style,
    intensity: intent.intensity,
    overlayCount: intent.overlayTexts.length,
    focusArea: intent.focusArea,
    purpose: intent.purpose,
    hasReference: !!intent.referenceVideo,
    hasInstructions: !!intent.additionalInstructions,
  });

  await prisma.project.update({
    where: { id: projectId },
    data: { editPreferences: intent as any },
  });

  logger.info(`[VideoEditIntent] Saved successfully for project ${projectId}`);
}

export async function getVideoEditIntent(
  projectId: string
): Promise<VideoEditIntent | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { editPreferences: true },
  });

  if (!project?.editPreferences) {
    logger.info(`[VideoEditIntent] No intent found for project ${projectId}`);
    return null;
  }

  logger.info(`[VideoEditIntent] Retrieved intent for project ${projectId}`);
  return project.editPreferences as unknown as VideoEditIntent;
}
