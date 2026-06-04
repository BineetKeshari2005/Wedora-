import { startExtractionWorker } from './extraction.worker';
import { startAiWorker } from './ai.worker';
import { startRenderWorker } from './render.worker';
import { startSocialWorker } from './social.worker';
import { logger } from '../utils/logger';

export const startAllWorkers = () => {
  logger.info('Initializing background workers...');
  
  startExtractionWorker();
  startAiWorker();
  startRenderWorker();
  startSocialWorker();

  logger.info('All background workers are actively listening to BullMQ.');
};
