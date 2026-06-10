import { startExtractionWorker } from './extraction.worker';
import { startAiWorker } from './ai.worker';
import { startRenderWorker } from './render.worker';
import { startSocialWorker } from './social.worker';
import { startEditPlanWorker } from './edit-plan.worker';
import { startRenderV2Worker } from './render-v2.worker';
import { logger } from '../utils/logger';

export const startAllWorkers = () => {
  logger.info('Initializing background workers...');
  
  startExtractionWorker();
  startAiWorker();
  startRenderWorker();
  startSocialWorker();
  startEditPlanWorker();
  startRenderV2Worker();

  logger.info('All background workers are actively listening to BullMQ.');
};
