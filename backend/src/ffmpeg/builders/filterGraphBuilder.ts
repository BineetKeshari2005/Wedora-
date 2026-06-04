import { RenderContext } from '../../services/template-engine.service';
import { buildOverlayFilter, OverlayConfig } from './overlayBuilder';
import { buildZoomFilter, buildColorGradeFilter, buildGlowFilter } from './cinematicEffects';

export const buildFilterGraph = (template: any, context: RenderContext): { filters: string[]; finalOutput: string } => {
  const filters: string[] = [];
  let currentLabel = '0:v';
  let filterIndex = 0;
  
  const { groqData, aiAnalysis } = context;
  const cinematicDirections: string[] = groqData?.cinematicDirections || [];
  const directionsStr = cinematicDirections.join(' ').toLowerCase();
  
  const mood = (aiAnalysis?.mood || '').toLowerCase();
  const theme = (aiAnalysis?.themes?.[0] || '').toLowerCase();

  // 1. AI-Driven Zoom
  const isSlowZoom = directionsStr.includes('slow zoom');
  const isFastZoom = directionsStr.includes('fast zoom') || directionsStr.includes('quick zoom');
  let zoomStyle = template.zoom;
  if (isSlowZoom) zoomStyle = 'slow';
  if (isFastZoom) zoomStyle = 'fast';

  if (zoomStyle) {
    const res = buildZoomFilter(zoomStyle, currentLabel, filterIndex);
    if (res) {
      filters.push(res.filterStr);
      currentLabel = res.nextLabel;
      filterIndex++;
    }
  }

  // 2. AI-Driven Color Tone (Mood Mapping)
  let colorTone = template.colorTone || 'warm'; // Default to warm if none
  if (mood.includes('royal') || mood.includes('luxury') || mood.includes('editorial')) {
    colorTone = 'luxury';
  } else if (mood.includes('romantic') || mood.includes('soft') || mood.includes('dreamy')) {
    colorTone = 'romantic';
  } else if (mood.includes('energetic') || mood.includes('vibrant') || mood.includes('party')) {
    colorTone = 'vibrant';
  } else if (directionsStr.includes('warm')) {
    colorTone = 'warm';
  }

  if (colorTone) {
    const res = buildColorGradeFilter(colorTone, currentLabel, filterIndex);
    if (res) {
      filters.push(res.filterStr);
      currentLabel = res.nextLabel;
      filterIndex++;
    }
  }

  // 3. AI-Driven Blur / Glow Effect
  if (directionsStr.includes('cinematic blur') || directionsStr.includes('blur')) {
    const nextLabel = `v${filterIndex}`;
    filters.push(`[${currentLabel}]boxblur=5:1[${nextLabel}]`);
    currentLabel = nextLabel;
    filterIndex++;
  } else if (directionsStr.includes('glow') || mood.includes('dreamy') || template.effects?.includes('soft-glow')) {
    const res = buildGlowFilter(currentLabel, filterIndex);
    filters.push(res.filterStr);
    currentLabel = res.nextLabel;
    filterIndex++;
  }

  // 4. AI-Driven Dynamic Text Overlays
  const overlayTexts: string[] = groqData?.overlayText || [];
  if (overlayTexts.length > 0) {
    const durationPerText = 3.5; // Each text stays for 3.5 seconds
    
    overlayTexts.forEach((text, i) => {
      // Create sequenced animated overlays
      const startTime = i * durationPerText + 0.5; // Start at 0.5s for the first one
      const endTime = startTime + durationPerText - 0.5;
      
      const config: OverlayConfig = {
        text: text,
        animation: 'fade-in-out',
        startTime,
        endTime,
        theme: theme,
      };
      
      const res = buildOverlayFilter(config, currentLabel, filterIndex);
      if (res) {
        filters.push(res.filterStr);
        currentLabel = res.nextLabel;
        filterIndex++;
      }
    });
  }

  return { filters, finalOutput: currentLabel };
};
