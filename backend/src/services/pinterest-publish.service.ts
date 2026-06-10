import axios from 'axios';
import FormData from 'form-data';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

export interface PinterestPublishResult {
  postUrl: string;
  externalId: string;
}

export class PinterestPublishService {
  /**
   * Publishes a video to a Pinterest Board using the API.
   */
  static async publishVideo(
    userId: string,
    boardId: string,
    payload: {
      videoUrl: string;
      caption: string;
      title?: string;
      description?: string;
    }
  ): Promise<PinterestPublishResult> {
    const account = await prisma.socialAccount.findUnique({
      where: { userId_platform: { userId, platform: 'PINTEREST' } },
    });

    if (!account) {
      throw new Error('No Pinterest account connected for this user');
    }
    if (account.status !== 'CONNECTED') {
      throw new Error(`Pinterest account status is ${account.status}. Please reconnect.`);
    }

    const accessToken = account.accessToken;
    if (!accessToken) {
      throw new Error('Pinterest account is missing accessToken');
    }

    if (!boardId) {
      throw new Error('boardId is required to publish to Pinterest');
    }

    logger.info(`[Pinterest Publish] ─── Pre-Request ───`);
    logger.info(`[Pinterest Publish] boardId: ${boardId}`);
    logger.info(`[Pinterest Publish] videoUrl: ${payload.videoUrl}`);

    try {
      // 1. Register video upload
      logger.info(`[Pinterest Publish] Registering video upload...`);
      const registerRes = await axios.post('https://api.pinterest.com/v5/media', 
        { media_type: 'video' },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      const mediaId = registerRes.data.media_id;
      const uploadUrl = registerRes.data.upload_url;
      const uploadParameters = registerRes.data.upload_parameters;

      if (!mediaId || !uploadUrl) {
        throw new Error('Failed to register media upload with Pinterest');
      }

      // 2. Download video stream from URL and upload to AWS S3 (Pinterest's bucket)
      logger.info(`[Pinterest Publish] Uploading video bytes to S3... media_id: ${mediaId}`);
      const videoStreamRes = await axios.get(payload.videoUrl, { responseType: 'stream' });

      const form = new FormData();
      for (const [key, value] of Object.entries(uploadParameters)) {
        form.append(key, value as string);
      }
      form.append('file', videoStreamRes.data, { filename: 'video.mp4', contentType: 'video/mp4' });

      await axios.post(uploadUrl, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });

      // 3. Poll for media processing completion
      logger.info(`[Pinterest Publish] Polling media processing status...`);
      let isReady = false;
      let attempts = 0;
      const MAX_ATTEMPTS = 60; // 5 minutes (5s * 60)

      while (!isReady && attempts < MAX_ATTEMPTS) {
        attempts++;
        const statusRes = await axios.get(`https://api.pinterest.com/v5/media/${mediaId}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        const status = statusRes.data.status;
        logger.info(`[Pinterest Publish] Media status: ${status} (Attempt ${attempts})`);

        if (status === 'succeeded') {
          isReady = true;
        } else if (status === 'failed') {
          throw new Error('Pinterest media processing failed');
        } else {
          // Wait 5 seconds before polling again
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      if (!isReady) {
        throw new Error('Timed out waiting for Pinterest media to process');
      }

      // 4. Create the Pin
      logger.info(`[Pinterest Publish] Creating Pin on board ${boardId}...`);
      const pinPayload = {
        board_id: boardId,
        title: payload.title || 'Wedding Video',
        description: payload.description || payload.caption || 'Beautiful wedding video',
        media_source: {
          source_type: 'video_id',
          media_id: mediaId
        }
      };

      const pinRes = await axios.post('https://api.pinterest.com/v5/pins', pinPayload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const pinId = pinRes.data.id;
      // You can construct the URL manually if not provided
      const postUrl = `https://www.pinterest.com/pin/${pinId}/`;

      logger.info(`[Pinterest Publish Success]`);
      logger.info(`  pinId: ${pinId}`);
      logger.info(`  postUrl: ${postUrl}`);

      return {
        postUrl,
        externalId: pinId,
      };

    } catch (err: any) {
      logger.error(`[Pinterest Publish] ─── API Error ───`);
      if (err.response) {
        logger.error(`[Pinterest Publish] HTTP Status: ${err.response.status}`);
        logger.error(`[Pinterest Publish] Error data: ${JSON.stringify(err.response.data, null, 2)}`);
        
        const pinError = new Error(`Pinterest API error: ${JSON.stringify(err.response.data)}`);
        (pinError as any).isTransient = [429, 500, 502, 503].includes(err.response.status);
        throw pinError;
      } else {
        logger.error(`[Pinterest Publish] Network/Unknown error: ${err.message}`);
        throw err;
      }
    }
  }
}
