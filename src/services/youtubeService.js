const crypto = require("crypto");
const { query } = require("../db");
const { env } = require("../config/env");

const oauthStateStore = new Map();
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_CHANNELS_URL =
  "https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&mine=true";
const YOUTUBE_PLAYLIST_ITEMS_URL = "https://www.googleapis.com/youtube/v3/playlistItems";
const YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

function buildLocalOauthCallbackUrl() {
  return `http://localhost:${env.port}/api/youtube/oauth/callback`;
}

function canUseYoutubeOAuth() {
  return Boolean(env.googleClientId && env.googleClientSecret && env.googleRedirectUri);
}

function getYoutubeOauthDiagnostics() {
  const missingVariables = [
    ["GOOGLE_CLIENT_ID", env.googleClientId],
    ["GOOGLE_CLIENT_SECRET", env.googleClientSecret],
    ["GOOGLE_REDIRECT_URI", env.googleRedirectUri]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  const configured = missingVariables.length === 0;
  const expectedLocalRedirectUri = buildLocalOauthCallbackUrl();

  return {
    ready: configured,
    missingVariables,
    redirectUri: env.googleRedirectUri || null,
    expectedLocalRedirectUri,
    matchesExpectedLocalRedirectUri:
      Boolean(env.googleRedirectUri) && env.googleRedirectUri === expectedLocalRedirectUri,
    connectPathTemplate: "/api/youtube/accounts/:id/connect"
  };
}

function maskToken(value) {
  if (!value) {
    return null;
  }

  return `${String(value).slice(0, 6)}...${String(value).slice(-4)}`;
}

function sanitizeYoutubeAccount(account) {
  if (!account) {
    return null;
  }

  return {
    ...account,
    access_token: undefined,
    refresh_token: undefined,
    accessTokenPreview: maskToken(account.access_token),
    refreshTokenPreview: maskToken(account.refresh_token)
  };
}

function buildOauthState(accountId) {
  const state = crypto.randomUUID();
  oauthStateStore.set(state, {
    accountId: Number(accountId),
    createdAt: Date.now()
  });

  return state;
}

function consumeOauthState(state) {
  const stored = oauthStateStore.get(state);
  oauthStateStore.delete(state);

  if (!stored) {
    return null;
  }

  if (Date.now() - stored.createdAt > 15 * 60 * 1000) {
    return null;
  }

  return stored;
}

async function getYoutubeAccountById(accountId) {
  const result = await query(
    `
      SELECT *
      FROM youtube_accounts
      WHERE id = $1
    `,
    [accountId]
  );

  return result.rows[0] || null;
}

function buildYoutubeConnectUrl(accountId) {
  if (!canUseYoutubeOAuth()) {
    return null;
  }

  const state = buildOauthState(accountId);
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: env.googleRedirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    state
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function listYoutubeAccounts() {
  const result = await query(
    `
      SELECT *
      FROM youtube_accounts
      ORDER BY updated_at DESC, id DESC
    `
  );

  return result.rows.map(sanitizeYoutubeAccount);
}

async function createYoutubeAccount(payload = {}) {
  const channelTitle = String(payload.channelTitle || "").trim();
  if (!channelTitle) {
    throw new Error("channelTitle is required");
  }

  const result = await query(
    `
      INSERT INTO youtube_accounts (
        channel_id,
        channel_title,
        channel_handle,
        contact_email,
        oauth_status,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `,
    [
      payload.channelId ? String(payload.channelId).trim() : null,
      channelTitle,
      payload.channelHandle ? String(payload.channelHandle).trim() : null,
      payload.contactEmail ? String(payload.contactEmail).trim() : null,
      canUseYoutubeOAuth() ? "ready_for_oauth" : "manual"
    ]
  );

  return sanitizeYoutubeAccount(result.rows[0]);
}

async function createYoutubeAccountsBulk(payload = {}) {
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  if (accounts.length === 0) {
    throw new Error("accounts are required");
  }

  const created = [];
  for (const account of accounts) {
    created.push(await createYoutubeAccount(account));
  }

  return created;
}

async function exchangeAuthCodeForTokens(code) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: env.googleRedirectUri,
      grant_type: "authorization_code"
    }).toString()
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Failed to exchange Google auth code");
  }

  return data;
}

async function refreshAccessToken(account) {
  if (!account.refresh_token) {
    throw new Error("This YouTube account does not have a refresh token");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token"
    }).toString()
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Failed to refresh Google access token");
  }

  const expiryDate = new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString();
  await query(
    `
      UPDATE youtube_accounts
      SET
        access_token = $2,
        token_scope = COALESCE($3, token_scope),
        token_expiry = $4,
        oauth_status = 'connected',
        last_error = NULL,
        updated_at = NOW()
      WHERE id = $1
    `,
    [account.id, data.access_token, data.scope || null, expiryDate]
  );

  return {
    ...account,
    access_token: data.access_token,
    token_scope: data.scope || account.token_scope,
    token_expiry: expiryDate,
    oauth_status: "connected"
  };
}

async function getValidAccessToken(accountId) {
  let account = await getYoutubeAccountById(accountId);
  if (!account) {
    throw new Error("YouTube account not found");
  }

  const expiresAt = account.token_expiry ? new Date(account.token_expiry).getTime() : 0;
  const shouldRefresh = !account.access_token || !expiresAt || expiresAt - Date.now() < 60 * 1000;

  if (shouldRefresh) {
    account = await refreshAccessToken(account);
  }

  return {
    account,
    accessToken: account.access_token
  };
}

async function fetchYoutubeChannel(accessToken) {
  const response = await fetch(YOUTUBE_CHANNELS_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Failed to read YouTube channel information");
  }

  return data.items?.[0] || null;
}

async function listYoutubeChannelVideos(accountId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 12), 1), 25);
  const channelResponse = await youtubeApiRequest(accountId, YOUTUBE_CHANNELS_URL, { method: "GET" });
  const channelData = await channelResponse.json().catch(() => ({}));
  if (!channelResponse.ok) {
    throw new Error(channelData.error?.message || "Failed to read YouTube channel information");
  }

  const channel = channelData.items?.[0];
  const uploadsPlaylistId = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    return {
      channel,
      items: []
    };
  }

  const playlistParams = new URLSearchParams({
    part: "snippet,contentDetails,status",
    playlistId: uploadsPlaylistId,
    maxResults: String(limit)
  });
  const playlistResponse = await youtubeApiRequest(
    accountId,
    `${YOUTUBE_PLAYLIST_ITEMS_URL}?${playlistParams.toString()}`,
    { method: "GET" }
  );
  const playlistData = await playlistResponse.json().catch(() => ({}));
  if (!playlistResponse.ok) {
    throw new Error(playlistData.error?.message || "Failed to read YouTube uploads playlist");
  }

  const playlistItems = Array.isArray(playlistData.items) ? playlistData.items : [];
  const videoIds = playlistItems
    .map((item) => item.contentDetails?.videoId)
    .filter(Boolean);

  if (videoIds.length === 0) {
    return {
      channel,
      items: []
    };
  }

  const videoParams = new URLSearchParams({
    part: "snippet,statistics,status,contentDetails",
    id: videoIds.join(",")
  });
  const videosResponse = await youtubeApiRequest(accountId, `${YOUTUBE_VIDEOS_URL}?${videoParams.toString()}`, {
    method: "GET"
  });
  const videosData = await videosResponse.json().catch(() => ({}));
  if (!videosResponse.ok) {
    throw new Error(videosData.error?.message || "Failed to read YouTube video metrics");
  }

  const videosById = new Map((videosData.items || []).map((item) => [item.id, item]));

  return {
    channel,
    items: playlistItems.map((playlistItem) => {
      const videoId = playlistItem.contentDetails?.videoId;
      const video = videosById.get(videoId) || {};
      return {
        id: videoId,
        title: video.snippet?.title || playlistItem.snippet?.title || "Untitled video",
        description: video.snippet?.description || "",
        publishedAt: video.snippet?.publishedAt || playlistItem.contentDetails?.videoPublishedAt || null,
        privacyStatus: video.status?.privacyStatus || null,
        thumbnails: video.snippet?.thumbnails || playlistItem.snippet?.thumbnails || {},
        duration: video.contentDetails?.duration || null,
        viewCount: Number(video.statistics?.viewCount || 0),
        likeCount: Number(video.statistics?.likeCount || 0),
        commentCount: Number(video.statistics?.commentCount || 0),
        url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null
      };
    })
  };
}

async function startYoutubeOAuth(accountId) {
  const account = await getYoutubeAccountById(accountId);
  if (!account) {
    throw new Error("YouTube account not found");
  }

  const connectUrl = buildYoutubeConnectUrl(accountId);
  if (!connectUrl) {
    throw new Error("Google OAuth credentials are not configured");
  }

  await query(
    `
      UPDATE youtube_accounts
      SET
        oauth_status = 'oauth_pending',
        updated_at = NOW()
      WHERE id = $1
    `,
    [accountId]
  );

  return connectUrl;
}

async function handleYoutubeOAuthCallback(params = {}) {
  if (params.error) {
    throw new Error(String(params.error));
  }

  const storedState = consumeOauthState(params.state);
  if (!storedState?.accountId) {
    throw new Error("Invalid or expired OAuth state");
  }

  const tokens = await exchangeAuthCodeForTokens(params.code);
  const expiryDate = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString();
  const channel = await fetchYoutubeChannel(tokens.access_token);

  await query(
    `
      UPDATE youtube_accounts
      SET
        channel_id = COALESCE($2, channel_id),
        channel_title = COALESCE($3, channel_title),
        channel_handle = COALESCE($4, channel_handle),
        access_token = $5,
        refresh_token = COALESCE($6, refresh_token),
        token_scope = $7,
        token_expiry = $8,
        oauth_status = 'connected',
        last_sync_at = NOW(),
        last_error = NULL,
        updated_at = NOW()
      WHERE id = $1
    `,
    [
      storedState.accountId,
      channel?.id || null,
      channel?.snippet?.title || null,
      channel?.snippet?.customUrl || null,
      tokens.access_token,
      tokens.refresh_token || null,
      tokens.scope || null,
      expiryDate
    ]
  );

  await query(
    `
      UPDATE publications
      SET
        status = CASE
          WHEN scheduled_for IS NOT NULL AND scheduled_for > NOW() THEN 'scheduled'
          ELSE 'ready'
        END,
        status_detail = CASE
          WHEN scheduled_for IS NOT NULL AND scheduled_for > NOW()
            THEN CONCAT('Scheduled for ', TO_CHAR(scheduled_for AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), ' UTC')
          ELSE 'Ready to upload through the YouTube API'
        END,
        updated_at = NOW()
      WHERE youtube_account_id = $1
        AND status = 'awaiting_oauth'
    `,
    [storedState.accountId]
  );

  await query(
    `
      UPDATE media_items
      SET publication_status = 'ready', updated_at = NOW()
      WHERE id IN (
        SELECT media_item_id
        FROM publications
        WHERE youtube_account_id = $1
          AND status IN ('ready', 'scheduled')
      )
    `,
    [storedState.accountId]
  );

  const account = await getYoutubeAccountById(storedState.accountId);
  return sanitizeYoutubeAccount(account);
}

async function youtubeApiRequest(accountId, url, options = {}, attempt = 0) {
  const { account, accessToken } = await getValidAccessToken(accountId);
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${accessToken}`
  };
  const response = await fetch(url, {
    ...options,
    headers
  });

  if (response.status === 401 && attempt === 0) {
    await refreshAccessToken(account);
    return youtubeApiRequest(accountId, url, options, attempt + 1);
  }

  return response;
}

module.exports = {
  canUseYoutubeOAuth,
  getYoutubeOauthDiagnostics,
  listYoutubeAccounts,
  createYoutubeAccount,
  createYoutubeAccountsBulk,
  getYoutubeAccountById,
  startYoutubeOAuth,
  handleYoutubeOAuthCallback,
  youtubeApiRequest,
  getValidAccessToken,
  listYoutubeChannelVideos
};
