import { ffmpegCapabilities } from '../ffmpegHealthCheck';
import { logger } from '../../utils/logger';

export interface OverlayConfig {
  text: string;
  animation?: 'fade-in' | 'fade-in-out' | 'pop' | 'none';
  fontSize?: number;
  color?: string;
  startTime?: number; // Time in seconds
  endTime?: number;   // Time in seconds
  theme?: string;
}

export const buildOverlayFilter = (config: OverlayConfig, currentInput: string, filterIndex: number): { filterStr: string; nextLabel: string } | null => {
  if (!ffmpegCapabilities.hasDrawtextSupport) {
    logger.warn('[OverlayBuilder] Skipping text overlay - drawtext missing');
    return null;
  }

  const fontPath = process.platform === 'darwin' ? '/Library/Fonts/Arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  const cleanText = config.text.replace(/'/g, "\\'").replace(/:/g, "\\:");
  
  const size = config.fontSize || (config.theme?.includes('luxury') ? 40 : 48);
  const color = config.color || 'white';
  
  const startTime = config.startTime ?? 0;
  const endTime = config.endTime ?? 5;

  let textAnim = '';
  // Apply enable filter to restrict when it draws
  textAnim += `:enable='between(t,${startTime},${endTime})'`;

  // Apply alpha fade
  if (config.animation === 'fade-in') {
    textAnim += `:alpha='if(lt(t,${startTime + 1}),0,if(lt(t,${startTime + 2}),t-${startTime + 1},1))'`; 
  } else if (config.animation === 'fade-in-out') {
    // Fade in over 1s, stay at 1, fade out over 1s
    textAnim += `:alpha='if(lt(t,${startTime + 1}),t-${startTime},if(lt(t,${endTime - 1}),1,if(lt(t,${endTime}),${endTime}-t,0)))'`;
  }

  // Draw background box based on theme
  let boxSettings = 'box=1:boxcolor=black@0.4:boxborderw=15';
  if (config.theme?.includes('minimal') || config.theme?.includes('luxury')) {
    boxSettings = 'box=0'; // No box for luxury/minimal
  }

  const nextLabel = `v${filterIndex}`;
  const filterStr = `[${currentInput}]drawtext=fontfile=${fontPath}:text='${cleanText}':fontsize=${size}:fontcolor=${color}:${boxSettings}:x=(w-text_w)/2:y=(h-text_h)/2${textAnim}[${nextLabel}]`;
  
  return { filterStr, nextLabel };
};
