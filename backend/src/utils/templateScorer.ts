import fs from 'fs';
import path from 'path';
import { logger } from './logger';

interface TemplateMetadata {
  id: string;
  name: string;
  zoom?: any;
  transition?: any;
  overlay?: any;
  textAnimation?: string;
  brollCategories?: string[];
  pacing?: string;
  [key: string]: any;
}

export class TemplateScorer {
  private static templatesCache: TemplateMetadata[] | null = null;
  private static templatesDir = path.resolve(__dirname, '../../templates');

  private static loadTemplates(): TemplateMetadata[] {
    if (this.templatesCache) return this.templatesCache;
    
    try {
      const files = fs.readdirSync(this.templatesDir).filter(f => f.endsWith('.json'));
      const templates: TemplateMetadata[] = [];
      
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.templatesDir, file), 'utf-8');
          const parsed = JSON.parse(raw);
          // If the template doesn't have an ID, infer it from the filename
          if (!parsed.id) {
            parsed.id = file.replace('.json', '');
          }
          templates.push(parsed);
        } catch (e) {
          logger.error(`[TemplateScorer] Failed to parse ${file}`);
        }
      }
      this.templatesCache = templates;
      return templates;
    } catch (e) {
      logger.error('[TemplateScorer] Failed to read templates directory');
      return [];
    }
  }

  /**
   * Score templates dynamically against the vision analysis signals.
   */
  static scoreTemplates(visionAnalysis: any): string {
    const templates = this.loadTemplates();
    if (templates.length === 0) return 'default-template';

    const scores: Record<string, number> = {};
    for (const tpl of templates) {
      scores[tpl.id] = 0;
    }

    const { 
      cameraMovements = [], 
      lightingCharacteristics = [], 
      dominantColors = [], 
      venueFeatures = [],
      peopleAndActivities = [] 
    } = visionAnalysis;

    // Helper to safely join arrays for text searching
    const cameraText = cameraMovements.join(' ').toLowerCase();
    const lightingText = lightingCharacteristics.join(' ').toLowerCase();
    const colorText = dominantColors.join(' ').toLowerCase();
    const venueText = venueFeatures.join(' ').toLowerCase();
    const activitiesText = peopleAndActivities.join(' ').toLowerCase();

    for (const tpl of templates) {
      // 1. Pace Matching
      const isFastCamera = cameraText.includes('fast') || cameraText.includes('quick') || cameraText.includes('shaky');
      const isSlowCamera = cameraText.includes('slow') || cameraText.includes('smooth') || cameraText.includes('pan');
      
      if (tpl.pacing === 'fast' && isFastCamera) scores[tpl.id] += 5;
      if (tpl.pacing === 'slow' && isSlowCamera) scores[tpl.id] += 5;
      
      // 2. Lighting & Color Mood
      const isDark = lightingText.includes('dark') || lightingText.includes('dim') || lightingText.includes('moody');
      const isBright = lightingText.includes('bright') || lightingText.includes('sunny') || lightingText.includes('well-lit');
      const isWarm = colorText.includes('warm') || colorText.includes('gold') || colorText.includes('red');
      
      if (isDark && tpl.id.includes('moody')) scores[tpl.id] += 8;
      if (isBright && tpl.id.includes('cinematic')) scores[tpl.id] += 4;
      if (isWarm && tpl.id.includes('luxury')) scores[tpl.id] += 3;

      // 3. Venue & Scenery
      const isOutdoor = venueText.includes('outdoor') || venueText.includes('nature') || venueText.includes('sky');
      const isGrand = venueText.includes('hall') || venueText.includes('ballroom') || venueText.includes('palace');
      
      if (isOutdoor && (tpl.id.includes('destination') || tpl.brollCategories?.includes('scenic'))) scores[tpl.id] += 6;
      if (isGrand && tpl.id.includes('royal')) scores[tpl.id] += 6;

      // 4. Intimacy / Minimalist
      const isIntimate = activitiesText.includes('close-up') || activitiesText.includes('intimate') || activitiesText.includes('getting ready');
      if (isIntimate && tpl.id.includes('minimal')) scores[tpl.id] += 5;
      
      // 5. Default bias to prevent zeroes causing arbitrary first-pick
      scores[tpl.id] += 1;
    }

    // Find the highest scoring template
    let bestId = 'default-template';
    let maxScore = -1;
    
    for (const [id, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        bestId = id;
      }
    }

    logger.info(`[TemplateScorer] Selected template '${bestId}' with score ${maxScore}`);
    return bestId;
  }
}
