import axios from 'axios';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

const GRAPH_API_VERSION = 'v18.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Masks an access token for safe logging.
 * Shows first 8 and last 4 characters.
 */
function maskToken(token: string): string {
  if (!token || token.length < 16) return '***';
  return `${token.substring(0, 8)}...${token.substring(token.length - 4)}`;
}

export interface FacebookPublishResult {
  postUrl: string;
  externalId: string; // The Facebook post_id or video_id
  videoId?: string;
}

export class FacebookPublishService {
  /**
   * Publishes a video to a Facebook Page using the Graph API.
   *
   * Flow:
   * 1. Look up the connected SocialAccount to get pageId + pageAccessToken
   * 2. POST the video to /{page-id}/videos
   * 3. Return the Facebook video ID and post URL
   */
  static async publishVideo(
    userId: string,
    payload: {
      videoUrl: string;
      caption: string;
      hashtags: string[];
      title?: string;
      description?: string;
    }
  ): Promise<FacebookPublishResult> {
    // ── 1. Retrieve the connected Facebook account ──
    const account = await prisma.socialAccount.findUnique({
      where: { userId_platform: { userId, platform: 'FACEBOOK' } },
    });

    if (!account) {
      throw new Error('No Facebook account connected for this user');
    }
    if (account.status !== 'CONNECTED') {
      throw new Error(`Facebook account status is ${account.status}. Please reconnect.`);
    }

    const pageId = account.accountId;
    const pageAccessToken = account.accessToken;
    const accountName = account.accountName || 'Unknown';

    if (!pageId || !pageAccessToken) {
      throw new Error('Facebook account is missing pageId or accessToken');
    }

    // ── Token Verification ──
    try {
      logger.info(`[Facebook Publish] Verifying token identity via GET /me...`);
      const meResponse = await axios.get(`${GRAPH_BASE_URL}/me`, {
        params: {
          access_token: pageAccessToken,
          fields: 'id,name'
        }
      });
      
      const tokenIdentity = meResponse.data;
      
      let tokenType = 'UNKNOWN';
      if (account.metadata && typeof account.metadata === 'object' && 'tokenType' in account.metadata) {
        tokenType = String((account.metadata as any).tokenType);
      }

      logger.info(`[Facebook Publish] ─── Token Verification Results ───`);
      logger.info(`[Facebook Publish]   accountId: ${account.id}`); // Database ID of SocialAccount
      logger.info(`[Facebook Publish]   pageId: ${pageId}`); // Facebook Page ID
      logger.info(`[Facebook Publish]   pageName: ${accountName}`);
      logger.info(`[Facebook Publish]   tokenType: ${tokenType}`);
      logger.info(`[Facebook Publish]   Token identity id (/me): ${tokenIdentity.id}`);
      logger.info(`[Facebook Publish]   Token identity name (/me): ${tokenIdentity.name}`);
      
      if (tokenIdentity.id !== pageId) {
        logger.warn(`[Facebook Publish] ⚠️ WARNING: Token identity ID (${tokenIdentity.id}) does NOT match Page ID (${pageId})! This might be a user token.`);
      } else {
        logger.info(`[Facebook Publish] ✅ SUCCESS: Token belongs to the correct page.`);
      }
    } catch (tokenErr: any) {
      logger.error(`[Facebook Publish] Failed to verify token identity: ${tokenErr.message}`);
      if (tokenErr.response && tokenErr.response.data) {
        logger.error(`[Facebook Publish] Graph API Error: ${JSON.stringify(tokenErr.response.data)}`);
      }
    }

    // Build the caption with hashtags
    const hashtagString = payload.hashtags
      .map(tag => (tag.startsWith('#') ? tag : `#${tag}`))
      .join(' ');
    const fullCaption = [payload.caption, hashtagString].filter(Boolean).join('\n\n');

    // ── 2. Log pre-request details ──
    logger.info(`[Facebook Publish] ─── Pre-Request ───`);
    logger.info(`[Facebook Publish] pageId: ${pageId}`);
    logger.info(`[Facebook Publish] pageAccessToken: ${maskToken(pageAccessToken)}`);
    logger.info(`[Facebook Publish] accountName: ${accountName}`);
    logger.info(`[Facebook Publish] caption: ${fullCaption.substring(0, 200)}${fullCaption.length > 200 ? '...' : ''}`);
    logger.info(`[Facebook Publish] videoUrl: ${payload.videoUrl}`);
    logger.info(`[Facebook Publish] title: ${payload.title || '(none)'}`);

    // ── 3. Make the Graph API request ──
    // POST /{page-id}/videos — uploads a video via URL
    const endpoint = `${GRAPH_BASE_URL}/${pageId}/videos`;
    logger.info(`[Facebook Publish] Graph API endpoint: ${endpoint}`);

    try {
      const response = await axios.post(endpoint, null, {
        params: {
          access_token: pageAccessToken,
          file_url: payload.videoUrl,
          description: fullCaption,
          title: payload.title || undefined,
        },
        timeout: 120_000, // 2 minute timeout for video uploads
      });

      // ── 4. Log the full Facebook response ──
      const data = response.data;
      logger.info(`[Facebook Publish] ─── Graph API Response ───`);
      logger.info(`[Facebook Publish] HTTP Status: ${response.status}`);
      logger.info(`[Facebook Publish] Response data: ${JSON.stringify(data, null, 2)}`);
      logger.info(`[Facebook Publish] post_id: ${data.post_id || data.id || '(not returned)'}`);
      logger.info(`[Facebook Publish] video_id: ${data.id || '(not returned)'}`);
      logger.info(`[Facebook Publish] success: true`);

      const videoId = data.id;
      const postId = data.post_id || data.id;

      if (!videoId && !postId) {
        throw new Error('Facebook returned no video_id or post_id in the response');
      }

      const externalId = postId || videoId;
      const postUrl = `https://www.facebook.com/${pageId}/videos/${videoId}/`;

      // ── 5. Log success ──
      logger.info(`[Facebook Publish Success]`);
      logger.info(`  externalId: ${externalId}`);
      logger.info(`  pageId: ${pageId}`);
      logger.info(`  accountName: ${accountName}`);

      return {
        postUrl,
        externalId,
        videoId,
      };
    } catch (err: any) {
      // ── 4b. Log Graph API errors ──
      logger.error(`[Facebook Publish] ─── Graph API Error ───`);

      if (err.response) {
        const errorData = err.response.data?.error || err.response.data;
        logger.error(`[Facebook Publish] HTTP Status: ${err.response.status}`);
        logger.error(`[Facebook Publish] error.code: ${errorData?.code || '(none)'}`);
        logger.error(`[Facebook Publish] error.message: ${errorData?.message || err.message}`);
        logger.error(`[Facebook Publish] error_subcode: ${errorData?.error_subcode || '(none)'}`);
        logger.error(`[Facebook Publish] error.type: ${errorData?.type || '(none)'}`);
        logger.error(`[Facebook Publish] fbtrace_id: ${errorData?.fbtrace_id || '(none)'}`);
        logger.error(`[Facebook Publish] Full error response: ${JSON.stringify(err.response.data, null, 2)}`);

        // Re-throw with a clear message
        const fbError = new Error(
          `Facebook Graph API error ${errorData?.code || err.response.status}: ${errorData?.message || err.message}`
        );
        (fbError as any).isTransient = [429, 500, 502, 503].includes(err.response.status);
        (fbError as any).graphApiCode = errorData?.code;
        (fbError as any).graphApiSubcode = errorData?.error_subcode;
        throw fbError;
      } else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        logger.error(`[Facebook Publish] Request timed out: ${err.message}`);
        const timeoutError = new Error(`Facebook upload timed out: ${err.message}`);
        (timeoutError as any).isTransient = true;
        throw timeoutError;
      } else {
        logger.error(`[Facebook Publish] Network error: ${err.message}`);
        throw err;
      }
    }
  }
}
