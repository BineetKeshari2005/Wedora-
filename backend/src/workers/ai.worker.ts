import { logger } from '../utils/logger';

// Placeholder AI worker – actual vision analysis moved to extraction.worker.
// This worker remains for compatibility; it simply logs its invocation.
export function startAiWorker(): void {
  logger.info('AI worker placeholder started – no operations performed.');
}
