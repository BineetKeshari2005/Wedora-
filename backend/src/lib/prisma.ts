import { PrismaClient } from '@prisma/client';

// Instantiate a single PrismaClient to be shared across the application.
// This avoids creating multiple connections and respects connection pooling.
export const prisma = new PrismaClient();
