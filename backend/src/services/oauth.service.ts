import { Platform } from '@prisma/client';
import crypto from 'crypto';
import axios, { AxiosResponse } from 'axios';

export interface PinterestBoard {
  id: string;
  name: string;
}

export interface PinterestBoardsResponse {
  items: PinterestBoard[];
  bookmark?: string;
}

export interface FacebookOAuthResult {
  userAccessToken: string;
  pages: any[];
}

interface GenericOAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  accountId: string;
  accountName: string;
  accountImage?: string;
  metadata?: any;
}


export class OAuthService {
  /**
   * Generates the authorization URL for a given platform.
   */
  static getAuthorizationUrl(platform: Platform, state: string): string {
    const redirectUri = `${process.env.APP_URL || 'http://localhost:5001'}/api/auth/${platform.toLowerCase()}/callback`;
    
    switch (platform) {
      case 'YOUTUBE':
        const ytClientId = process.env.YOUTUBE_CLIENT_ID || 'mock_client_id';
        return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${ytClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/youtube.upload&access_type=offline&prompt=consent&state=${state}`;
      
      case 'LINKEDIN':
        const liClientId = process.env.LINKEDIN_CLIENT_ID || 'mock_client_id';
        return `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${liClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=w_member_social%20r_liteprofile`;
      
      case 'FACEBOOK':
      case 'INSTAGRAM':
        const fbClientId = process.env.FACEBOOK_CLIENT_ID;
        const fbConfigId = process.env.FACEBOOK_CONFIG_ID;
        if (!fbClientId) throw new Error('FACEBOOK_CLIENT_ID is missing');
        
        let fbUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${fbClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&response_type=code`;
        if (fbConfigId) {
          fbUrl += `&config_id=${fbConfigId}`;
        }
        
        console.log('[OAuthService] Generated Facebook OAuth URL:', fbUrl);
        console.log('[OAuthService] Redirect URI:', redirectUri);
        return fbUrl;
      
      case 'PINTEREST':
        const pinClientId = process.env.PINTEREST_CLIENT_ID;
        if (!pinClientId) throw new Error('PINTEREST_CLIENT_ID is missing');
        // Scopes needed: boards:read, pins:read, pins:write, user_accounts:read
        const pinScope = 'boards:read,pins:read,pins:write,user_accounts:read';
        return `https://www.pinterest.com/oauth/?client_id=${pinClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${pinScope}&state=${state}`;

      default:
        throw new Error(`Unsupported platform for OAuth: ${platform}`);
    }
  }

  /**
   * Exchanges a Facebook OAuth code for a user access token and fetches user pages.
   */
  static async exchangeFacebookCode(code: string, redirectUri: string, platformLabel: string = 'FACEBOOK'): Promise<FacebookOAuthResult> {
    console.log(`[OAuthService] Exchanging code for ${platformLabel}...`);

    const fbClientId = process.env.FACEBOOK_CLIENT_ID;
    const fbClientSecret = process.env.FACEBOOK_CLIENT_SECRET;
    
    if (!fbClientId || !fbClientSecret) {
      throw new Error('FACEBOOK_CLIENT_ID or FACEBOOK_CLIENT_SECRET is missing');
    }

    try {
      // 1. Exchange code for User Access Token
      const tokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
        params: {
          client_id: fbClientId,
          redirect_uri: redirectUri,
          client_secret: fbClientSecret,
          code: code
        }
      });
      
      console.log('[OAuthService] Token Response:', JSON.stringify(tokenResponse.data, null, 2));

      const userAccessToken = tokenResponse.data.access_token;
      if (!userAccessToken) {
        throw new Error('Failed to obtain user access token from Facebook');
      }

      // ── Log: USER_TOKEN received from Meta OAuth exchange ──
      console.log('[OAuthService] ─── Token Type: USER_TOKEN ───');
      console.log(`[OAuthService] User Access Token (masked): ${userAccessToken.substring(0, 10)}...${userAccessToken.substring(userAccessToken.length - 4)}`);
      console.log(`[OAuthService] Token length: ${userAccessToken.length}`);

      // 2. Fetch User Pages
      console.log(`[OAuthService] Fetching pages from /me/accounts using USER_TOKEN...`);
      const pagesResponse = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
        params: {
          access_token: userAccessToken,
          fields: 'id,name,access_token,picture,instagram_business_account'
        }
      });
      
      console.log('[OAuthService] Pages Response Data:', JSON.stringify(pagesResponse.data, null, 2));

      const pages = pagesResponse.data.data || [];

      // ── Log: PAGE_TOKEN received for each page from /me/accounts ──
      for (const page of pages) {
        const pt = page.access_token || '';
        console.log('[OAuthService] ─── Token Type: PAGE_TOKEN ───');
        console.log(`[OAuthService]   pageId: ${page.id}`);
        console.log(`[OAuthService]   pageName: ${page.name}`);
        console.log(`[OAuthService]   Page Access Token (masked): ${pt.substring(0, 10)}...${pt.substring(pt.length - 4)}`);
        console.log(`[OAuthService]   Token length: ${pt.length}`);
        console.log(`[OAuthService]   Tokens match? ${userAccessToken === pt ? 'YES ⚠️ SAME TOKEN' : 'NO ✅ Different tokens'}`);
      }

      return { userAccessToken, pages };
    } catch (error: any) {
      console.error('[OAuthService] Graph API Error:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Exchanges a Pinterest OAuth code for tokens, user profile, and fetches all boards.
   */
  static async exchangePinterestCode(code: string, redirectUri: string) {
    console.log(`[OAuthService] Exchanging code for PINTEREST...`);

    const clientId = process.env.PINTEREST_CLIENT_ID;
    const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      throw new Error('PINTEREST_CLIENT_ID or PINTEREST_CLIENT_SECRET is missing');
    }

    try {
      // 1. Exchange code for Access Token
      const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenResponse = await axios.post('https://api.pinterest.com/v5/oauth/token', 
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: redirectUri
        }).toString(),
        {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      const accessToken = tokenResponse.data.access_token;
      const refreshToken = tokenResponse.data.refresh_token;

      if (!accessToken) {
        throw new Error('Failed to obtain access token from Pinterest');
      }

      // 2. Fetch User Profile
      console.log(`[OAuthService] Fetching Pinterest user profile...`);
      const userResponse = await axios.get('https://api.pinterest.com/v5/user_account', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      const accountId = userResponse.data.account_type === 'BUSINESS' ? userResponse.data.id : userResponse.data.username;
      const accountName = userResponse.data.username;
      const accountImage = userResponse.data.profile_image;

      // 3. Fetch Boards
      console.log(`[OAuthService] Fetching Pinterest boards...`);
      const boards = await this.getPinterestBoards(accessToken);

      return {
        accessToken,
        refreshToken,
        accountId: userResponse.data.id,
        accountName,
        accountImage,
        boards
      };
    } catch (error: any) {
      console.error('[OAuthService] Pinterest API Error:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetches all boards for the connected Pinterest account.
   */
  static async getPinterestBoards(accessToken: string): Promise<PinterestBoard[]> {
    let boards: PinterestBoard[] = [];
    let bookmark: string | undefined = undefined;

    try {
      do {
        const response: AxiosResponse<PinterestBoardsResponse> = await axios.get('https://api.pinterest.com/v5/boards', {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: bookmark ? { bookmark } : {}
        });

        boards = boards.concat(response.data.items || []);
        bookmark = response.data.bookmark;
      } while (bookmark);

      return boards;
    } catch (error: any) {
      console.error('[OAuthService] Failed to fetch Pinterest boards:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Exchanges the OAuth code for tokens (generic, for non-Facebook platforms).
   */
  static async exchangeCodeForTokens(platform: Platform, code: string, redirectUri: string): Promise<GenericOAuthTokenResponse> {
    console.log(`[OAuthService] Exchanging code for ${platform}...`);
    
    // MOCK RESPONSE for other platforms
    return {
      accessToken: `mock_access_token_${crypto.randomBytes(4).toString('hex')}`,
      refreshToken: `mock_refresh_token_${crypto.randomBytes(4).toString('hex')}`,
      expiresIn: 3600,
      accountId: `mock_account_${crypto.randomBytes(4).toString('hex')}`,
      accountName: `Mock ${platform} Account`,
      accountImage: `https://api.dicebear.com/7.x/initials/svg?seed=Mock${platform}`,
      metadata: { mockLinkedPageId: '12345' }
    };
  }

  /**
   * Generates a random state string for CSRF protection.
   */
  static generateState(): string {
    return crypto.randomBytes(16).toString('hex');
  }
}
