import axios from 'axios';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

const GRAPH_API_VERSION = 'v18.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export interface InstagramPublishPayload {
  videoUrl: string;
  caption: string;
}

export interface InstagramPublishResult {
  postUrl: string;
  externalId: string; // The Instagram media ID
}

export class InstagramPublishService {
  /**
   * Publishes a video as a Reel to an Instagram Business Account using the Graph API.
   *
   * Flow:
   * 1. Retrieve the INSTAGRAM SocialAccount.
   * 2. Initialize a media container with videoUrl and caption.
   * 3. Poll the container until processing is FINISHED.
   * 4. Publish the container.
   */
  static async publishVideo(
    userId: string,
    payload: InstagramPublishPayload
  ): Promise<InstagramPublishResult> {
    if (!payload.videoUrl) {
      throw new Error('videoUrl is required for Instagram publishing');
    }

    // ── 1. Retrieve the connected Instagram account ──
    const account = await prisma.socialAccount.findUnique({
      where: { userId_platform: { userId, platform: 'INSTAGRAM' } },
    });

    if (!account) {
      throw new Error('No Instagram account connected for this user');
    }
    if (account.status !== 'CONNECTED') {
      throw new Error(`Instagram account status is ${account.status}. Please reconnect.`);
    }

    const igAccountId = account.accountId;
    const pageAccessToken = account.accessToken;
    const accountName = account.accountName || 'Unknown';

    if (!igAccountId || !pageAccessToken) {
      throw new Error('Instagram account is missing accountId or accessToken');
    }

    logger.info(`[Instagram Publish] ─── Pre-Request ───`);
    logger.info(`[Instagram Publish] igAccountId: ${igAccountId}`);
    logger.info(`[Instagram Publish] accountName: ${accountName}`);
    logger.info(`[Instagram Publish] caption: ${payload.caption.substring(0, 200)}${payload.caption.length > 200 ? '...' : ''}`);
    logger.info(`[Instagram Publish] videoUrl: ${payload.videoUrl}`);

    // ── 2. Create Media Container ──
    logger.info(`[Instagram Publish] Creating media container for Reel...`);
    
    const mediaContainerParams = {
      access_token: pageAccessToken,
      media_type: 'REELS',
      video_url: payload.videoUrl,
      caption: payload.caption,
    };

    logger.info(`[Instagram Publish] Request Endpoint: ${GRAPH_BASE_URL}/${igAccountId}/media`);
    logger.info(`[Instagram Publish] Request Payload (params): ${JSON.stringify({ ...mediaContainerParams, access_token: '***' })}`);

    let creationId: string;
    try {
      const createResponse = await axios.post(`${GRAPH_BASE_URL}/${igAccountId}/media`, null, {
        params: mediaContainerParams
      });
      creationId = createResponse.data.id;
      logger.info(`[Instagram Publish] Media container created. creationId: ${creationId}`);
    } catch (err: any) {
      logger.error(`[Instagram Publish] Failed to create media container: ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
      throw new Error('Failed to create Instagram media container');
    }

    // ── 3. Poll Container Status ──
    logger.info(`[Instagram Publish] Polling status for creationId: ${creationId}...`);
    let isFinished = false;
    let attempts = 0;
    const maxAttempts = 30; // Max 5 minutes total (30 * 10 seconds)
    const pollIntervalMs = 10000;

    while (!isFinished && attempts < maxAttempts) {
      attempts++;
      try {
        const statusResponse = await axios.get(`${GRAPH_BASE_URL}/${creationId}`, {
          params: {
            access_token: pageAccessToken,
            fields: 'status_code'
          }
        });
        
        const statusCode = statusResponse.data.status_code;
        logger.info(`[Instagram Publish] Poll attempt ${attempts}/${maxAttempts}: status_code = ${statusCode}`);

        if (statusCode === 'FINISHED') {
          isFinished = true;
          break;
        } else if (statusCode === 'ERROR') {
          throw new Error('Instagram media container processing failed with status ERROR');
        } else if (statusCode === 'EXPIRED') {
          throw new Error('Instagram media container EXPIRED');
        }
      } catch (err: any) {
        // If the error is from our thrown errors above, re-throw
        if (err.message.includes('Instagram media container')) throw err;
        logger.warn(`[Instagram Publish] Error polling status (attempt ${attempts}): ${err.message}`);
      }

      if (!isFinished) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }
    }

    if (!isFinished) {
      throw new Error(`Instagram media container did not finish processing within the allotted time (${maxAttempts} attempts).`);
    }

    // ── 4. Publish Container ──
    logger.info(`[Instagram Publish] Media container is ready. Publishing...`);
    let mediaId: string;
    try {
      const publishResponse = await axios.post(`${GRAPH_BASE_URL}/${igAccountId}/media_publish`, null, {
        params: {
          access_token: pageAccessToken,
          creation_id: creationId
        }
      });
      mediaId = publishResponse.data.id;
      logger.info(`[Instagram Publish] ✅ Successfully published Reel! Media ID: ${mediaId}`);
    } catch (err: any) {
      logger.error(`[Instagram Publish] Failed to publish container: ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
      throw new Error('Failed to publish Instagram media container');
    }

    // Return the result
    const postUrl = `https://www.instagram.com/p/${mediaId}/`;

    return {
      externalId: mediaId,
      postUrl,
    };
  }
}
