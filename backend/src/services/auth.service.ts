import axios, { AxiosInstance } from 'axios';
import querystring from 'querystring';
import { SocialAccount, Platform } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

/**
 * Generic OAuth helper for Instagram, TikTok and Google (YouTube).
 * - generateAuthUrl(platform, state) returns the URL to redirect the user.
 * - exchangeCode(platform, code) exchanges an auth code for access/refresh tokens.
 * - refreshToken(platform, refreshToken) obtains a new access token.
 * Tokens are encrypted before storage using a server‑side key.
 */
export class AuthService {
  private static prisma = new PrismaClient();
  private static encryptionKey = Buffer.from(process.env.SOCIAL_ENCRYPTION_KEY ?? '', 'base64');

  static getClientConfig(platform: Platform) {
    switch (platform) {
      case Platform.INSTAGRAM:
        return {
          clientId: process.env.INSTAGRAM_APP_ID!,
          clientSecret: process.env.INSTAGRAM_APP_SECRET!,
          authUrl: 'https://api.instagram.com/oauth/authorize',
          tokenUrl: 'https://api.instagram.com/oauth/access_token',
          redirectUri: process.env.INSTAGRAM_REDIRECT_URI!,
          scopes: ['user_profile', 'user_media', 'instagram_content_publish'],
        };
      case Platform.TIKTOK:
        return {
          clientId: process.env.TIKTOK_CLIENT_KEY!,
          clientSecret: process.env.TIKTOK_CLIENT_SECRET!,
          authUrl: 'https://open.tiktokapis.com/v2/auth/authorize/',
          tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
          redirectUri: process.env.TIKTOK_REDIRECT_URI!,
          scopes: ['video.upload', 'video.publish'],
        };
      case Platform.YOUTUBE:
        return {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
          tokenUrl: 'https://oauth2.googleapis.com/token',
          redirectUri: process.env.GOOGLE_REDIRECT_URI!,
          scopes: ['https://www.googleapis.com/auth/youtube.upload'],
        };
      default:
        throw new Error('Unsupported platform');
    }
  }

  static generateAuthUrl(platform: Platform, state: string): string {
    const cfg = this.getClientConfig(platform);
    const params = {
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: cfg.scopes.join(' '),
      state,
    };
    return `${cfg.authUrl}?${querystring.stringify(params)}`;
  }

  static async exchangeCode(
    platform: Platform,
    code: string,
    userId: string,
    providerUserId: string,
  ): Promise<SocialAccount> {
    const cfg = this.getClientConfig(platform);
    const payload = {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: cfg.redirectUri,
    };
    const response = await axios.post(cfg.tokenUrl, querystring.stringify(payload), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const { access_token, refresh_token, expires_in } = response.data;
    const encryptedAccess = this.encrypt(access_token);
    const encryptedRefresh = this.encrypt(refresh_token);
    const expiresAt = new Date(Date.now() + expires_in * 1000);
    const account = await this.prisma.socialAccount.upsert({
      where: { userId_platform: { userId, platform } },
      update: { accessToken: encryptedAccess, refreshToken: encryptedRefresh, expiresAt },
      create: {
        userId,
        platform,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt,
      },
    });
    return account;
  }

  static async refreshToken(platform: Platform, storedRefreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const cfg = this.getClientConfig(platform);
    const payload = {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: this.decrypt(storedRefreshToken),
    };
    const resp = await axios.post(cfg.tokenUrl, querystring.stringify(payload), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const { access_token, expires_in } = resp.data;
    return { accessToken: this.encrypt(access_token), expiresAt: new Date(Date.now() + expires_in * 1000) };
  }

  private static encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  private static decrypt(ciphertext: string): string {
    const data = Buffer.from(ciphertext, 'base64');
    const iv = data.slice(0, 12);
    const tag = data.slice(12, 28);
    const encrypted = data.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
