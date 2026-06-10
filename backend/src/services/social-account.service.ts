import { prisma } from '../lib/prisma';
import { Platform, ConnectionStatus } from '@prisma/client';

export class SocialAccountService {
  /**
   * Returns all connected accounts for a user.
   */
  static async getConnectedAccounts(userId: string) {
    return await prisma.socialAccount.findMany({
      where: { userId },
      select: {
        id: true,
        platform: true,
        accountId: true,
        accountName: true,
        accountImage: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { platform: 'asc' }
    });
  }

  /**
   * Upserts a social account (called after successful OAuth callback).
   */
  static async upsertAccount(
    userId: string,
    platform: Platform,
    data: {
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number; // in seconds
      accountId: string;
      accountName: string;
      accountImage?: string;
      metadata?: any;
    }
  ) {
    const expiresAt = data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : null;

    return await prisma.socialAccount.upsert({
      where: {
        userId_platform: { userId, platform }
      },
      update: {
        accessToken: data.accessToken,
        ...(data.refreshToken && { refreshToken: data.refreshToken }),
        expiresAt,
        accountId: data.accountId,
        accountName: data.accountName,
        ...(data.accountImage && { accountImage: data.accountImage }),
        ...(data.metadata && { metadata: data.metadata }),
        status: 'CONNECTED',
      },
      create: {
        userId,
        platform,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || null,
        expiresAt,
        accountId: data.accountId,
        accountName: data.accountName,
        accountImage: data.accountImage || null,
        metadata: data.metadata || {},
        status: 'CONNECTED',
      }
    });
  }

  /**
   * Disconnects (deletes) a social account.
   */
  static async disconnectAccount(userId: string, platform: Platform) {
    await prisma.socialAccount.delete({
      where: {
        userId_platform: { userId, platform }
      }
    });
  }
}
