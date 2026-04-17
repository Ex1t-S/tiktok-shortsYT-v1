const crypto = require("crypto");
const { query } = require("../db");
const { env } = require("../config/env");
const { sanitizeTitle, sanitizeDescription, sanitizeMetadataTags, buildEnhancedMetadata } = require("./metadataService");

const oauthStateStore = new Map();
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_CHANNELS_URL =
  "https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&mine=true";
const YOUTUBE_PLAYLIST_ITEMS_URL = "https://www.googleapis.com/youtube/v3/playlistItems";
const YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl"
];

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
    accountId: Number.isFinite(Number(accountId)) ? Number(accountId) : null,
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

async function getYoutubeAccountByChannelId(channelId) {
  const result = await query(
    `
      SELECT *
      FROM youtube_accounts
      WHERE channel_id = $1
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `,
    [channelId]
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
    scope: YOUTUBE_OAUTH_SCOPES.join(" "),
    state
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

function buildYoutubeDirectOauthUrl() {
  if (!canUseYoutubeOAuth()) {
    return null;
  }

  const state = buildOauthState(null);
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: env.googleRedirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: YOUTUBE_OAUTH_SCOPES.join(" "),
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
        categoryId: video.snippet?.categoryId || null,
        tags: Array.isArray(video.snippet?.tags) ? video.snippet.tags : [],
        defaultLanguage: video.snippet?.defaultLanguage || null,
        publishedAt: video.snippet?.publishedAt || playlistItem.contentDetails?.videoPublishedAt || null,
        privacyStatus: video.status?.privacyStatus || null,
        embeddable: video.status?.embeddable ?? null,
        license: video.status?.license || null,
        publicStatsViewable: video.status?.publicStatsViewable ?? null,
        selfDeclaredMadeForKids: video.status?.selfDeclaredMadeForKids ?? null,
        containsSyntheticMedia: video.status?.containsSyntheticMedia ?? null,
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

async function getYoutubeVideoResource(accountId, videoId) {
  const safeVideoId = String(videoId || "").trim();
  if (!safeVideoId) {
    throw new Error("videoId is required");
  }

  const readParams = new URLSearchParams({
    part: "snippet,status",
    id: safeVideoId
  });
  const readResponse = await youtubeApiRequest(accountId, `${YOUTUBE_VIDEOS_URL}?${readParams.toString()}`, {
    method: "GET"
  });
  const readData = await readResponse.json().catch(() => ({}));
  if (!readResponse.ok) {
    throw new Error(readData.error?.message || "Failed to read YouTube video metadata");
  }

  const currentVideo = Array.isArray(readData.items) ? readData.items[0] : null;
  if (!currentVideo) {
    throw new Error("YouTube video not found");
  }

  return currentVideo;
}

async function updateYoutubeChannelVideo(accountId, videoId, payload = {}) {
  const safeVideoId = String(videoId || "").trim();
  const currentVideo = await getYoutubeVideoResource(accountId, safeVideoId);

  const currentSnippet = currentVideo.snippet || {};
  const currentStatus = currentVideo.status || {};
  const nextTitle = sanitizeTitle(
    payload.title !== undefined ? payload.title : currentSnippet.title || "",
    sanitizeTitle(currentSnippet.title || "", "Video sin titulo")
  );
  if (!nextTitle) {
    throw new Error("title is required");
  }

  const nextDescription = sanitizeDescription(
    payload.description !== undefined ? payload.description : currentSnippet.description || ""
  );
  const nextPrivacyStatus = String(
    payload.privacyStatus !== undefined ? payload.privacyStatus : currentStatus.privacyStatus || "private"
  ).trim().toLowerCase();
  if (!["private", "public", "unlisted"].includes(nextPrivacyStatus)) {
    throw new Error("privacyStatus is invalid");
  }
  const nextTags = sanitizeMetadataTags(
    payload.tags !== undefined ? payload.tags : Array.isArray(currentSnippet.tags) ? currentSnippet.tags : []
  );

  const updateResource = {
    id: safeVideoId,
    snippet: {
      title: nextTitle,
      description: nextDescription,
      categoryId: currentSnippet.categoryId || "22"
    },
    status: {
      privacyStatus: nextPrivacyStatus
    }
  };

  if (nextTags.length) {
    updateResource.snippet.tags = nextTags;
  }
  if (currentSnippet.defaultLanguage) {
    updateResource.snippet.defaultLanguage = currentSnippet.defaultLanguage;
  }
  if (typeof currentStatus.embeddable === "boolean") {
    updateResource.status.embeddable = currentStatus.embeddable;
  }
  if (currentStatus.license) {
    updateResource.status.license = currentStatus.license;
  }
  if (typeof currentStatus.publicStatsViewable === "boolean") {
    updateResource.status.publicStatsViewable = currentStatus.publicStatsViewable;
  }
  if (typeof currentStatus.selfDeclaredMadeForKids === "boolean") {
    updateResource.status.selfDeclaredMadeForKids = currentStatus.selfDeclaredMadeForKids;
  }
  if (typeof currentStatus.containsSyntheticMedia === "boolean") {
    updateResource.status.containsSyntheticMedia = currentStatus.containsSyntheticMedia;
  }
  if (nextPrivacyStatus === "private" && currentStatus.publishAt) {
    updateResource.status.publishAt = currentStatus.publishAt;
  }

  const updateParams = new URLSearchParams({
    part: "snippet,status"
  });
  const updateResponse = await youtubeApiRequest(accountId, `${YOUTUBE_VIDEOS_URL}?${updateParams.toString()}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json; charset=UTF-8"
    },
    body: JSON.stringify(updateResource)
  });
  const updateData = await updateResponse.json().catch(() => ({}));
  if (!updateResponse.ok) {
    throw new Error(updateData.error?.message || "Failed to update YouTube video");
  }

  const updatedVideo = updateData || {};
  return {
    id: updatedVideo.id || safeVideoId,
    title: updatedVideo.snippet?.title || nextTitle,
    description: updatedVideo.snippet?.description || nextDescription,
    categoryId: updatedVideo.snippet?.categoryId || updateResource.snippet.categoryId,
    tags: Array.isArray(updatedVideo.snippet?.tags) ? updatedVideo.snippet.tags : updateResource.snippet.tags || [],
    defaultLanguage: updatedVideo.snippet?.defaultLanguage || updateResource.snippet.defaultLanguage || null,
    privacyStatus: updatedVideo.status?.privacyStatus || nextPrivacyStatus,
    embeddable: updatedVideo.status?.embeddable ?? updateResource.status.embeddable ?? null,
    license: updatedVideo.status?.license || updateResource.status.license || null,
    publicStatsViewable: updatedVideo.status?.publicStatsViewable ?? updateResource.status.publicStatsViewable ?? null,
    selfDeclaredMadeForKids:
      updatedVideo.status?.selfDeclaredMadeForKids ?? updateResource.status.selfDeclaredMadeForKids ?? null,
    containsSyntheticMedia:
      updatedVideo.status?.containsSyntheticMedia ?? updateResource.status.containsSyntheticMedia ?? null
  };
}

async function generateYoutubeChannelVideoMetadata(accountId, videoId) {
  const currentVideo = await getYoutubeVideoResource(accountId, videoId);
  const generated = await buildEnhancedMetadata({
    title: currentVideo.snippet?.title || "",
    description: currentVideo.snippet?.description || "",
    tags: currentVideo.snippet?.tags || [],
    source_label: "youtube_video"
  });
  const item = await updateYoutubeChannelVideo(accountId, videoId, generated);

  return {
    item,
    metadata: generated
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

async function startYoutubeDirectOAuth() {
  const connectUrl = buildYoutubeDirectOauthUrl();
  if (!connectUrl) {
    throw new Error("Google OAuth credentials are not configured");
  }

  return connectUrl;
}

async function handleYoutubeOAuthCallback(params = {}) {
  if (params.error) {
    throw new Error(String(params.error));
  }

  const storedState = consumeOauthState(params.state);
  if (!storedState) {
    throw new Error("Invalid or expired OAuth state");
  }

  const tokens = await exchangeAuthCodeForTokens(params.code);
  const expiryDate = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString();
  const channel = await fetchYoutubeChannel(tokens.access_token);
  const channelId = channel?.id || null;
  const channelTitle = channel?.snippet?.title || "YouTube channel";
  const channelHandle = channel?.snippet?.customUrl || null;
  const account =
    (storedState.accountId ? await getYoutubeAccountById(storedState.accountId) : null) ||
    (channelId ? await getYoutubeAccountByChannelId(channelId) : null);
  const contactEmail = account?.contact_email || null;

  let persistedAccountId = account?.id || null;

  if (!persistedAccountId) {
    const insertResult = await query(
      `
        INSERT INTO youtube_accounts (
          channel_id,
          channel_title,
          channel_handle,
          contact_email,
          access_token,
          refresh_token,
          token_scope,
          token_expiry,
          oauth_status,
          last_sync_at,
          last_error,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'connected', NOW(), NULL, NOW())
        RETURNING id
      `,
      [
        channelId,
        channelTitle,
        channelHandle,
        contactEmail,
        tokens.access_token,
        tokens.refresh_token || null,
        tokens.scope || null,
        expiryDate
      ]
    );
    persistedAccountId = insertResult.rows[0].id;
  }

  await query(
    `
      UPDATE youtube_accounts
      SET
        channel_id = COALESCE($2, channel_id),
        channel_title = COALESCE($3, channel_title),
        channel_handle = COALESCE($4, channel_handle),
        contact_email = COALESCE($5, contact_email),
        access_token = $6,
        refresh_token = COALESCE($7, refresh_token),
        token_scope = $8,
        token_expiry = $9,
        oauth_status = 'connected',
        last_sync_at = NOW(),
        last_error = NULL,
        updated_at = NOW()
      WHERE id = $1
    `,
    [
      persistedAccountId,
      channelId,
      channelTitle,
      channelHandle,
      contactEmail,
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
    [persistedAccountId]
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
    [persistedAccountId]
  );

  const persistedAccount = await getYoutubeAccountById(persistedAccountId);
  return sanitizeYoutubeAccount(persistedAccount);
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
  getYoutubeAccountByChannelId,
  startYoutubeOAuth,
  startYoutubeDirectOAuth,
  handleYoutubeOAuthCallback,
  youtubeApiRequest,
  getValidAccessToken,
  listYoutubeChannelVideos,
  updateYoutubeChannelVideo,
  generateYoutubeChannelVideoMetadata
};
