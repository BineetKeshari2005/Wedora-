CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "CinematicTemplate" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "definition" JSONB NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT now()
);
