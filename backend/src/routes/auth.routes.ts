import { Router } from 'express';
import { OAuthService } from '../services/oauth.service';
import { SocialAccountService } from '../services/social-account.service';
import { Platform } from '@prisma/client';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';

const router = Router();

// In-memory store for temporary OAuth sessions
// In production, use Redis or a database
const oauthSessions = new Map<string, { userAccessToken: string; pages: any[] }>();

// GET /api/auth/facebook
router.get('/facebook', (req, res) => {
  try {
    const state = OAuthService.generateState();
    
    // Store state in an HttpOnly cookie to validate on callback
    res.cookie('oauth_state', state, { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60 * 1000 // 10 minutes
    });

    const authUrl = OAuthService.getAuthorizationUrl('FACEBOOK', state);
    res.redirect(authUrl);
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// GET /api/auth/facebook/callback
router.get('/facebook/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error(`OAuth error for Facebook:`, error);
    return res.redirect('http://localhost:3000/settings?error=oauth_rejected');
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Authorization code missing' });
  }

  // Validate state to prevent CSRF
  if (!state || state !== req.cookies.oauth_state) {
    return res.redirect('http://localhost:3000/settings?error=invalid_state');
  }

  try {
    const redirectUri = `${process.env.APP_URL || 'http://localhost:5001'}/api/auth/facebook/callback`;
    
    // Exchange code for user access token and fetch pages
    const { userAccessToken, pages } = await OAuthService.exchangeFacebookCode(code, redirectUri);

    // Create a temporary session to pass pages to frontend
    const sessionId = crypto.randomBytes(16).toString('hex');
    oauthSessions.set(sessionId, { userAccessToken, pages });

    // Clean up temporary sessions after 10 minutes (simple TTL)
    setTimeout(() => {
      oauthSessions.delete(sessionId);
    }, 10 * 60 * 1000);

    // Clear the state cookie
    res.clearCookie('oauth_state');

    // Redirect to frontend to select a page
    res.redirect(`http://localhost:3000/settings?fb_session_id=${sessionId}`);
  } catch (err: any) {
    console.error(`Error during Facebook callback:`, err);
    res.redirect('http://localhost:3000/settings?error=callback_failed');
  }
});

// GET /api/auth/facebook/session/:sessionId/pages
router.get('/facebook/session/:sessionId/pages', (req, res) => {
  const { sessionId } = req.params;
  const session = oauthSessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  res.json({ pages: session.pages });
});

// POST /api/auth/facebook/pages/select
router.post('/facebook/pages/select', async (req, res) => {
  const { sessionId, pageId } = req.body;
  
  if (!sessionId || !pageId) {
    return res.status(400).json({ error: 'Missing sessionId or pageId' });
  }

  const session = oauthSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  const selectedPage = session.pages.find((p: any) => p.id === pageId);
  if (!selectedPage) {
    return res.status(400).json({ error: 'Invalid page selected' });
  }

  try {
    // Resolve guest user dynamically since we don't have proper user auth wired up
    const guestUser = await prisma.user.findUnique({
      where: { email: 'guest@wedora.local' }
    });

    if (!guestUser) {
      console.error('[AuthRoutes] User validation failed. Guest user not found in the database.');
      return res.status(400).json({ error: 'User does not exist in the database. Please ensure you are logged in.' });
    }

    const resolvedUserId = guestUser.id;

    console.log('[AuthRoutes] ─── Page Selection Details ───');
    console.log(`[AuthRoutes]   resolvedUserId: ${resolvedUserId}`);
    console.log(`[AuthRoutes]   pageId: ${selectedPage.id}`);
    console.log(`[AuthRoutes]   pageName: ${selectedPage.name}`);
    console.log(`[AuthRoutes]   platform: FACEBOOK`);

    // ── Log: Token source verification ──
    const pageToken = selectedPage.access_token || '';
    const userToken = session.userAccessToken || '';
    console.log('[AuthRoutes] ─── Token Source: PAGE_TOKEN ───');
    console.log(`[AuthRoutes]   tokenType: PAGE_TOKEN`);
    console.log(`[AuthRoutes]   Storing PAGE access token (masked): ${pageToken.substring(0, 10)}...${pageToken.substring(pageToken.length - 4)}`);
    console.log(`[AuthRoutes]   User access token (masked):        ${userToken.substring(0, 10)}...${userToken.substring(userToken.length - 4)}`);
    console.log(`[AuthRoutes]   Are they the same token? ${pageToken === userToken ? 'YES ⚠️ WARNING: Same token!' : 'NO ✅ Correct: storing page token, not user token'}`);

    await SocialAccountService.upsertAccount(resolvedUserId, 'FACEBOOK', {
      accessToken: selectedPage.access_token, // Page Access Token
      accountId: selectedPage.id,             // Page ID
      accountName: selectedPage.name,         // Page Name
      accountImage: selectedPage.picture?.data?.url,
      metadata: { 
        userAccessToken: session.userAccessToken, // Store User Access Token for future use
        instagramAccountId: selectedPage.instagram_business_account?.id || null,
        tokenType: 'PAGE_TOKEN', // Explicitly tag the token type
      }
    });
    console.log('[AuthRoutes] ✅ SocialAccount upserted with PAGE_TOKEN');

    // Clear session
    oauthSessions.delete(sessionId);

    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to select page:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to connect page' });
  }
});

// ─── INSTAGRAM ROUTES ───

// GET /api/auth/instagram
router.get('/instagram', (req, res) => {
  try {
    const state = OAuthService.generateState();
    res.cookie('oauth_state', state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 10 * 60 * 1000 });
    const authUrl = OAuthService.getAuthorizationUrl('INSTAGRAM', state);
    res.redirect(authUrl);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/auth/instagram/callback
router.get('/instagram/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('http://localhost:3000/settings?error=oauth_rejected');
  if (!code || typeof code !== 'string') return res.status(400).json({ error: 'Authorization code missing' });
  if (!state || state !== req.cookies.oauth_state) return res.redirect('http://localhost:3000/settings?error=invalid_state');

  try {
    const redirectUri = `${process.env.APP_URL || 'http://localhost:5001'}/api/auth/instagram/callback`;
    const { userAccessToken, pages } = await OAuthService.exchangeFacebookCode(code, redirectUri, 'INSTAGRAM');
    const sessionId = crypto.randomBytes(16).toString('hex');
    oauthSessions.set(sessionId, { userAccessToken, pages });
    setTimeout(() => oauthSessions.delete(sessionId), 10 * 60 * 1000);
    res.clearCookie('oauth_state');
    res.redirect(`http://localhost:3000/settings?ig_session_id=${sessionId}`);
  } catch (err: any) {
    console.error(`Error during Instagram callback:`, err);
    res.redirect('http://localhost:3000/settings?error=callback_failed');
  }
});

// GET /api/auth/instagram/session/:sessionId/pages
router.get('/instagram/session/:sessionId/pages', (req, res) => {
  const { sessionId } = req.params;
  const session = oauthSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  // Only return pages with an instagram_business_account
  const igPages = session.pages.filter((p: any) => p.instagram_business_account);
  res.json({ pages: igPages });
});

// POST /api/auth/instagram/pages/select
router.post('/instagram/pages/select', async (req, res) => {
  const { sessionId, pageId } = req.body;
  if (!sessionId || !pageId) return res.status(400).json({ error: 'Missing sessionId or pageId' });
  const session = oauthSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  const selectedPage = session.pages.find((p: any) => p.id === pageId);
  if (!selectedPage || !selectedPage.instagram_business_account) {
    return res.status(400).json({ error: 'Invalid page selected or no linked Instagram account' });
  }

  try {
    const guestUser = await prisma.user.findUnique({ where: { email: 'guest@wedora.local' } });
    if (!guestUser) return res.status(400).json({ error: 'User does not exist' });

    // Store the INSTAGRAM account
    await SocialAccountService.upsertAccount(guestUser.id, 'INSTAGRAM', {
      accessToken: selectedPage.access_token, // Page access token (required for IG Graph API)
      accountId: selectedPage.instagram_business_account.id, // IG Business Account ID
      accountName: selectedPage.name + ' (Instagram)', // Append label for clarity
      accountImage: selectedPage.picture?.data?.url,
      metadata: { 
        facebookPageId: selectedPage.id, // Store facebook page ID
        tokenType: 'PAGE_TOKEN'
      }
    });

    oauthSessions.delete(sessionId);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to select instagram page:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to connect page' });
  }
});

// GET /api/auth/accounts
router.get('/accounts', async (req, res) => {
  try {
    const guestUser = await prisma.user.findUnique({ where: { email: 'guest@wedora.local' } });
    if (!guestUser) return res.status(400).json({ error: 'Guest user not found' });
    
    const accounts = await SocialAccountService.getConnectedAccounts(guestUser.id);
    
    console.log('[AuthRoutes GET /accounts] Fetched connected accounts:', {
      userId: guestUser.id,
      count: accounts.length,
      platforms: accounts.map(a => a.platform)
    });

    res.json(accounts);
  } catch (err: any) {
    console.error('[AuthRoutes GET /accounts] Error:', err);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// DELETE /api/auth/accounts/:platform
router.delete('/accounts/:platform', async (req, res) => {
  const { platform } = req.params;
  const upperPlatform = platform.toUpperCase() as Platform;
  try {
    const guestUser = await prisma.user.findUnique({ where: { email: 'guest@wedora.local' } });
    if (!guestUser) return res.status(400).json({ error: 'Guest user not found' });

    await SocialAccountService.disconnectAccount(guestUser.id, upperPlatform);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to disconnect account' });
  }
});

// GET /api/auth/pinterest/callback
router.get('/pinterest/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error(`OAuth error for Pinterest:`, error);
    return res.redirect('http://localhost:3000/settings?error=oauth_rejected');
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Authorization code missing' });
  }

  try {
    const redirectUri = `${process.env.APP_URL || 'http://localhost:5001'}/api/auth/pinterest/callback`;
    
    // Exchange code for access token and fetch boards
    const result = await OAuthService.exchangePinterestCode(code, redirectUri);

    // Resolve guest user dynamically
    const guestUser = await prisma.user.findUnique({
      where: { email: 'guest@wedora.local' }
    });

    if (!guestUser) {
      console.error('[AuthRoutes] User validation failed. Guest user not found in the database.');
      return res.redirect('http://localhost:3000/settings?error=user_not_found');
    }

    // Save SocialAccount and store all boards in metadata
    await SocialAccountService.upsertAccount(guestUser.id, 'PINTEREST', {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      accountId: result.accountId,
      accountName: result.accountName,
      accountImage: result.accountImage,
      metadata: { 
        boards: result.boards // Store the boards array directly in metadata
      }
    });

    console.log('[AuthRoutes] ✅ Pinterest SocialAccount upserted successfully.');
    
    // Redirect to frontend settings page with success
    res.redirect('http://localhost:3000/settings?success=1');
  } catch (err: any) {
    console.error(`Error during Pinterest callback:`, err);
    res.redirect('http://localhost:3000/settings?error=callback_failed');
  }
});

// Legacy route for non-Facebook connect points (if any)
router.get('/:platform/connect', (req, res) => {
  const { platform } = req.params;
  const upperPlatform = platform.toUpperCase() as Platform;

  try {
    const state = OAuthService.generateState();
    const authUrl = OAuthService.getAuthorizationUrl(upperPlatform, state);
    res.redirect(authUrl);
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// Legacy route for non-Facebook callbacks (if any)
router.get('/:platform/callback', async (req, res) => {
  const { platform } = req.params;
  
  if (platform.toLowerCase() === 'facebook') {
    return res.status(400).json({ error: 'Facebook uses a different callback flow' });
  }

  // Implementation for other platforms would go here...
  res.redirect('http://localhost:3000/settings?error=unsupported_platform');
});

export default router;
