export const logger = {
  info: (msg: string, meta?: any) => {
    console.log(`[INFO] ${new Date().toISOString()} - ${msg}`, meta || '');
  },
  error: (msg: string, error?: any) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, error || '');
  },
  warn: (msg: string, meta?: any) => {
    console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`, meta || '');
  }
};
