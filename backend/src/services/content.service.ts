import { prisma } from '../lib/prisma';
import { Platform } from '@prisma/client';
import { GroqService } from './groq.service';
import { logger } from '../utils/logger';

export class ContentService {
  private static groqService = new GroqService();

  /**
   * Generates content for all platforms if they don't already exist.
   * Typically called right after the main video pipeline is completed, 
   * or when the user opens the editor for the first time.
   */
  static async generateForAllPlatforms(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { platformContents: true, analysis: true }
    });

    if (!project) throw new Error('Project not found');

    const platforms = Object.values(Platform);
    const existingPlatforms = project.platformContents.map(pc => pc.platform);
    
    for (const platform of platforms) {
      if (!existingPlatforms.includes(platform)) {
        await this.generateForPlatform(projectId, platform, project);
      }
    }
  }

  /**
   * Generates content for a specific platform for the first time.
   */
  static async generateForPlatform(projectId: string, platform: Platform, projectContext?: any) {
    let project = projectContext;
    if (!project || !project.analysis) {
      project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { analysis: true }
      });
      if (!project) throw new Error('Project not found');
    }

    const analysisResult = (project.analysis?.rawVisionData as any)?.vision || {};
    const mergedContext = project.userContext ? JSON.stringify(project.userContext) : '';

    logger.info(`[ContentService] Generating content for ${platform} - Project ${projectId}`);

    const groqResult = await this.groqService.generate({
      metadata: analysisResult,
      userContext: mergedContext,
      platform: platform,
    });

    return await prisma.platformContent.upsert({
      where: {
        projectId_platform: { projectId, platform }
      },
      update: {
        // If it already exists (due to race condition), just update it
        caption: groqResult.captions?.[0] || null,
        hashtags: groqResult.hashtags || [],
        hook: groqResult.hooks?.[0] || null,
        title: groqResult.title || null,
        description: groqResult.description || null,
        tags: groqResult.tags || [],
        isAiGenerated: true,
        isEdited: false,
      },
      create: {
        projectId,
        platform,
        caption: groqResult.captions?.[0] || null,
        hashtags: groqResult.hashtags || [],
        hook: groqResult.hooks?.[0] || null,
        title: groqResult.title || null,
        description: groqResult.description || null,
        tags: groqResult.tags || [],
        isAiGenerated: true,
        isEdited: false,
        generationCount: 1,
      }
    });
  }

  /**
   * Regenerates content for a specific platform, overwriting the existing AI record.
   */
  static async regenerate(projectId: string, platform: Platform) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { analysis: true }
    });

    if (!project) throw new Error('Project not found');

    const analysisResult = (project.analysis?.rawVisionData as any)?.vision || {};
    const mergedContext = project.userContext ? JSON.stringify(project.userContext) : '';

    logger.info(`[ContentService] Regenerating content for ${platform} - Project ${projectId}`);

    const groqResult = await this.groqService.generate({
      metadata: analysisResult,
      userContext: mergedContext,
      platform: platform,
    });

    const existingContent = await prisma.platformContent.findUnique({
      where: { projectId_platform: { projectId, platform } }
    });

    if (existingContent) {
      return await prisma.platformContent.update({
        where: { id: existingContent.id },
        data: {
          caption: groqResult.captions?.[0] || null,
          hashtags: groqResult.hashtags || [],
          hook: groqResult.hooks?.[0] || null,
          title: groqResult.title || null,
          description: groqResult.description || null,
          tags: groqResult.tags || [],
          isAiGenerated: true,
          isEdited: false,
          generationCount: existingContent.generationCount + 1,
        }
      });
    } else {
      return await this.generateForPlatform(projectId, platform, project);
    }
  }

  /**
   * Updates platform content (when user edits manually).
   */
  static async update(contentId: string, fields: {
    caption?: string;
    hashtags?: string[];
    hook?: string;
    title?: string;
    description?: string;
    tags?: string[];
    metadata?: any;
  }) {
    return await prisma.platformContent.update({
      where: { id: contentId },
      data: {
        ...fields,
        isEdited: true,
        isAiGenerated: false,
      }
    });
  }

  /**
   * Gets all platform contents for a given project.
   */
  static async getByProject(projectId: string) {
    return await prisma.platformContent.findMany({
      where: { projectId },
      orderBy: { platform: 'asc' }
    });
  }
}
