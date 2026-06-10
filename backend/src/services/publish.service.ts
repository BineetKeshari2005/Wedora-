import { prisma } from '../lib/prisma';
import { Platform, PostStatus } from '@prisma/client';
import { SocialAccountService } from './social-account.service';
import { FacebookPublishService } from './facebook-publish.service';
import { PinterestPublishService } from './pinterest-publish.service';
import { InstagramPublishService } from './instagram-publish.service';
import { QueueService } from './queue.service';
import { logger } from '../utils/logger';

/**
 * PublishService orchestrates the publishing lifecycle:
 * 1. Pre-flight validation (token check, content existence)
 * 2. Status transitions (DRAFT → READY → PUBLISHING → PUBLISHED/FAILED)
 * 3. Mock platform upload (real API calls would go here)
 * 4. Retry logic for failed publishes
 */
export class PublishService {
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAYS_MS = [60_000, 300_000, 900_000]; // 1m, 5m, 15m

  /**
   * Initiates publishing for a project on selected platforms.
   * Performs pre-flight checks and transitions content to READY or SCHEDULED status.
   */
  static async publish(projectId: string, platforms: Platform[], userId: string, scheduledFor?: Date) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { platformContents: true }
    });

    if (!project) throw new Error('Project not found');
    if (!project.renderedVideoUrl) throw new Error('Video has not been rendered yet');

    const results: { platform: Platform; status: string; error?: string }[] = [];

    for (const platform of platforms) {
      // 1. Check that content exists for this platform
      const content = project.platformContents.find(c => c.platform === platform);
      if (!content) {
        results.push({ platform, status: 'FAILED', error: 'No content generated for this platform' });
        continue;
      }

      // 2. Check that a social account is connected
      const accounts = await SocialAccountService.getConnectedAccounts(userId);
      const account = accounts.find(a => a.platform === platform);
      if (!account) {
        await prisma.platformContent.update({
          where: { id: content.id },
          data: { postStatus: 'FAILED', errorMessage: `No ${platform} account connected` }
        });
        results.push({ platform, status: 'FAILED', error: `No ${platform} account connected` });
        continue;
      }

      if (account.status === 'EXPIRED') {
        await prisma.platformContent.update({
          where: { id: content.id },
          data: { postStatus: 'FAILED', errorMessage: `${platform} token expired. Please reconnect.` }
        });
        results.push({ platform, status: 'FAILED', error: `${platform} token expired` });
        continue;
      }

      // 3. Transition to READY or SCHEDULED
      const newStatus = scheduledFor ? 'SCHEDULED' : 'READY';
      await prisma.platformContent.update({
        where: { id: content.id },
        data: { 
          postStatus: newStatus, 
          errorMessage: null, 
          retryCount: 0,
          scheduledFor: scheduledFor || null
        }
      });

      results.push({ platform, status: newStatus });
    }

    // 4. Kick off the worker for all successful items using BullMQ
    for (const platform of platforms) {
      if (results.find(r => r.platform === platform && (r.status === 'READY' || r.status === 'SCHEDULED'))) {
        try {
          const content = await prisma.platformContent.findUnique({
            where: { projectId_platform: { projectId, platform } }
          });
          if (content) {
            const job = await QueueService.addSocialUploadJob(projectId, platform, scheduledFor);
            if (job && job.id) {
              await prisma.platformContent.update({
                where: { id: content.id },
                data: { bullMqJobId: job.id.toString() }
              });
            }
          }
        } catch (err: any) {
          logger.error(`[PublishService] Failed to queue job for ${platform}: ${err.message}`);
        }
      }
    }

    return results;
  }

  /**
   * Processes all READY jobs for a project (useful for manual fallback).
   */
  static async processReadyJobs(projectId: string) {
    const readyContents = await prisma.platformContent.findMany({
      where: { projectId, postStatus: { in: ['READY', 'SCHEDULED'] } }
    });

    for (const content of readyContents) {
      await this.processJobByPlatform(content.projectId, content.platform);
    }
  }

  /**
   * Processes a single publish job. Called by BullMQ worker.
   */
  static async processJobByPlatform(projectId: string, platform: Platform) {
    const content = await prisma.platformContent.findUnique({
      where: { projectId_platform: { projectId, platform } },
      include: { project: true }
    });

    if (!content || !['READY', 'SCHEDULED'].includes(content.postStatus)) return;

    // Transition to PUBLISHING
    await prisma.platformContent.update({
      where: { id: content.id },
      data: { postStatus: 'PUBLISHING', errorMessage: null }
    });

    logger.info(`[PublishWorker] Publishing to ${content.platform} for project ${content.projectId}`);

    try {
      let result: { postUrl: string; externalId?: string };

      if (platform === 'FACEBOOK') {
        // ── Real Facebook Graph API publishing ──
        const userId = content.project.userId;
        logger.info(`[PublishWorker] Using REAL Facebook Graph API for userId: ${userId}`);

        const fbResult = await FacebookPublishService.publishVideo(userId, {
          videoUrl: content.project.renderedVideoUrl!,
          caption: content.caption || '',
          hashtags: content.hashtags,
          title: content.title || undefined,
          description: content.description || undefined,
        });

        result = { postUrl: fbResult.postUrl, externalId: fbResult.externalId };

        // Create a SocialPost record with the external Facebook ID
        await prisma.socialPost.create({
          data: {
            projectId,
            platform: 'FACEBOOK',
            status: 'PUBLISHED',
            caption: content.caption,
            externalId: fbResult.externalId,
          }
        });
        logger.info(`[PublishWorker] SocialPost created with externalId: ${fbResult.externalId}`);
      } else if (platform === 'PINTEREST') {
        // ── Real Pinterest API publishing ──
        const userId = content.project.userId;
        const boardId = content.metadata && typeof content.metadata === 'object' && 'boardId' in content.metadata 
          ? (content.metadata as any).boardId 
          : null;

        if (!boardId) {
          throw new Error('No boardId selected for Pinterest publish. Please select a board first.');
        }

        logger.info(`[PublishWorker] Using REAL Pinterest API for userId: ${userId}, boardId: ${boardId}`);

        const pinResult = await PinterestPublishService.publishVideo(userId, boardId, {
          videoUrl: content.project.renderedVideoUrl!,
          caption: content.caption || '',
          title: content.title || undefined,
          description: content.description || undefined,
        });

        result = { postUrl: pinResult.postUrl, externalId: pinResult.externalId };

        await prisma.socialPost.create({
          data: {
            projectId,
            platform: 'PINTEREST',
            status: 'PUBLISHED',
            caption: content.caption,
            externalId: pinResult.externalId,
          }
        });
        logger.info(`[PublishWorker] SocialPost created with externalId: ${pinResult.externalId}`);
      } else if (platform === 'INSTAGRAM') {
        // ── Real Instagram Graph API publishing ──
        const userId = content.project.userId;
        logger.info(`[PublishWorker] Using REAL Instagram Graph API for userId: ${userId}`);

        const igResult = await InstagramPublishService.publishVideo(userId, {
          videoUrl: content.project.renderedVideoUrl!,
          caption: content.caption || '',
        });

        result = { postUrl: igResult.postUrl, externalId: igResult.externalId };

        await prisma.socialPost.create({
          data: {
            projectId,
            platform: 'INSTAGRAM',
            status: 'PUBLISHED',
            caption: content.caption,
            externalId: igResult.externalId,
          }
        });
        logger.info(`[PublishWorker] SocialPost created with externalId: ${igResult.externalId}`);
      } else {
        // ── Mock path for other platforms (Instagram, YouTube, LinkedIn) ──
        logger.info(`[PublishWorker] Using MOCK upload for ${platform} (no real API configured)`);
        const mockResult = await this.uploadToPlatform(platform, {
          videoUrl: content.project.renderedVideoUrl!,
          caption: content.caption || '',
          hashtags: content.hashtags,
          title: content.title || undefined,
          description: content.description || undefined,
          tags: content.tags,
        });
        result = { postUrl: mockResult.postUrl };
      }

      // Success → PUBLISHED
      await prisma.platformContent.update({
        where: { id: content.id },
        data: {
          postStatus: 'PUBLISHED',
          postUrl: result.postUrl,
          publishedAt: new Date(),
          errorMessage: null,
          bullMqJobId: null
        }
      });

      logger.info(`[PublishWorker] ✅ Published to ${content.platform}: ${result.postUrl}`);
    } catch (err: any) {
      const isPermanent = this.isPermanentError(err);
      const currentRetry = content.retryCount;

      if (isPermanent || currentRetry >= this.MAX_RETRIES) {
        // Permanent failure
        await prisma.platformContent.update({
          where: { id: content.id },
          data: {
            postStatus: 'FAILED',
            errorMessage: err.message || 'Unknown error',
            retryCount: currentRetry,
            bullMqJobId: null
          }
        });
        logger.error(`[PublishWorker] ❌ Permanently failed ${content.platform}: ${err.message}`);
      } else {
        // Transient failure → schedule retry
        const delay = this.RETRY_DELAYS_MS[currentRetry] || 60_000;
        await prisma.platformContent.update({
          where: { id: content.id },
          data: {
            postStatus: 'READY',
            errorMessage: `Retry ${currentRetry + 1}/${this.MAX_RETRIES}: ${err.message}`,
            retryCount: currentRetry + 1,
            bullMqJobId: null
          }
        });

        logger.warn(`[PublishWorker] ⏳ Retrying ${content.platform} in ${delay / 1000}s (attempt ${currentRetry + 1})`);

        // Schedule retry using BullMQ instead of setTimeout
        QueueService.addSocialUploadJob(projectId, platform, new Date(Date.now() + delay)).catch(e =>
          logger.error(`[PublishWorker] Failed to queue retry: ${e.message}`)
        );
      }
    }
  }

  /**
   * Manual retry for a failed publish.
   */
  static async retry(projectId: string, platform: Platform) {
    const content = await prisma.platformContent.findUnique({
      where: { projectId_platform: { projectId, platform } }
    });

    if (!content) throw new Error('Content not found');
    if (content.postStatus !== 'FAILED') throw new Error('Can only retry failed publishes');

    // Reset to READY with fresh retry count
    await prisma.platformContent.update({
      where: { id: content.id },
      data: { postStatus: 'READY', errorMessage: null, retryCount: 0 }
    });

    // Process by re-queuing instead of immediate inline execution
    QueueService.addSocialUploadJob(projectId, platform).catch(err => {
      logger.error(`[PublishService] Manual retry failed to queue: ${err.message}`);
    });

    return { platform, status: 'READY' };
  }

  /**
   * Gets the publishing status for all platforms of a project.
   */
  static async getPublishStatus(projectId: string) {
    const contents = await prisma.platformContent.findMany({
      where: { projectId },
      select: {
        platform: true,
        postStatus: true,
        errorMessage: true,
        postUrl: true,
        publishedAt: true,
        retryCount: true,
      },
      orderBy: { platform: 'asc' }
    });

    return contents;
  }

  /**
   * Mock platform upload. Replace with real SDK calls later.
   */
  private static async uploadToPlatform(
    platform: Platform,
    payload: {
      videoUrl: string;
      caption: string;
      hashtags: string[];
      title?: string;
      description?: string;
      tags: string[];
    }
  ): Promise<{ postUrl: string }> {
    // Simulate upload delay (2-5 seconds)
    const delay = 2000 + Math.random() * 3000;
    await new Promise(resolve => setTimeout(resolve, delay));

    // Simulate occasional transient failures for realism (10% chance)
    if (Math.random() < 0.1) {
      const error = new Error('Network timeout: Could not reach platform API');
      (error as any).isTransient = true;
      throw error;
    }

    // Return mock post URL
    const mockId = Math.random().toString(36).substring(7);
    switch (platform) {
      case 'YOUTUBE':
        return { postUrl: `https://www.youtube.com/watch?v=${mockId}` };
      case 'YOUTUBE':
        return { postUrl: `https://www.youtube.com/shorts/${mockId}` };
      case 'LINKEDIN':
        return { postUrl: `https://www.linkedin.com/posts/${mockId}` };
      default:
        return { postUrl: `https://example.com/${mockId}` };
    }
  }

  /**
   * Determines if an error is permanent (no point retrying).
   */
  private static isPermanentError(err: any): boolean {
    if (err.isTransient) return false;
    const status = err.response?.status;
    // 400, 401, 403 are permanent. 429, 500, 502, 503 are transient.
    if (status && [400, 401, 403].includes(status)) return true;
    return false;
  }
}
