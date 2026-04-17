const fs = require("fs");
const { query } = require("../db");
const { env } = require("../config/env");
const { youtubeApiRequest } = require("./youtubeService");
const { downloadPostToTemp, cleanupTempDir } = require("./ytDlpService");
const { getLibraryVideoById, getVideoMimeType, resolveLibraryVideoFile } = require("./libraryService");
const { enqueuePublicationJob } = require("./publicationQueueService");

const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const YOUTUBE_VIDEO_URL = "https://www.googleapis.com/youtube/v3/videos";

function normalizeTags(input) {
  if (!input) {
    return [];
  }

  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim()).filter(Boolean);
  }

  return String(input)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function sanitizeMetadataText(value, maxLength) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E\n\r\t]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeMetadataTags(tags) {
  return normalizeTags(tags)
    .map((tag) => sanitizeMetadataText(tag, 30).replace(/^#+/, "").replace(/\s+/g, ""))
    .filter(Boolean)
    .slice(0, 20);
}

function trimText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function stripHashtags(value) {
  return String(value || "")
    .replace(/(^|\s)#[^\s#]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildDefaultTitle(mediaItem) {
  const baseCandidate =
    stripHashtags(mediaItem.title || "") ||
    stripHashtags(mediaItem.caption || "") ||
    stripHashtags(mediaItem.description || "") ||
    mediaItem.original_filename ||
    `Short from @${mediaItem.username || mediaItem.source_label || "library"}`;
  const base = baseCandidate || mediaItem.original_filename || `Short from @${mediaItem.username || mediaItem.source_label || "library"}`;
  return trimText(base, 100);
}

function buildDefaultDescription(mediaItem) {
  const parts = [
    sanitizeMetadataText(mediaItem.description || mediaItem.caption || "", 4500),
    mediaItem.post_url ? `Source: ${mediaItem.post_url}` : "",
    "#shorts"
  ].filter(Boolean);

  return sanitizeMetadataText(parts.join("\n\n"), 5000);
}

function parseYoutubeError(data, fallback) {
  return data?.error?.message || data?.error_description || fallback;
}

async function getPublicationById(publicationId) {
  const result = await query(
    `
      SELECT
        p.*,
        ya.channel_title,
        ya.channel_handle,
        ya.oauth_status,
        pc.tracked_profile_id AS clone_tracked_profile_id,
        clone_profile.username AS clone_username,
        clone_profile.display_name AS clone_display_name,
        COALESCE(mi.caption, lv.description) AS caption,
        COALESCE(mi.thumbnail_url, lv.thumbnail_url) AS thumbnail_url,
        mi.post_url,
        mi.score,
        mi.external_id,
        tp.username,
        lv.original_filename,
        lv.stored_path,
        lv.source_url,
        lv.storage_provider,
        lv.mime_type,
        lv.source_label,
        lv.title AS library_title,
        lv.thumbnail_url AS library_thumbnail_url
      FROM publications p
      JOIN youtube_accounts ya ON ya.id = p.youtube_account_id
      LEFT JOIN profile_clones pc ON pc.id = p.profile_clone_id
      LEFT JOIN tracked_profiles clone_profile ON clone_profile.id = pc.tracked_profile_id
      LEFT JOIN media_items mi ON mi.id = p.media_item_id
      LEFT JOIN tracked_profiles tp ON tp.id = mi.tracked_profile_id
      LEFT JOIN library_videos lv ON lv.id = p.library_video_id
      WHERE p.id = $1
    `,
    [publicationId]
  );

  return result.rows[0] || null;
}

function buildScheduleDates(count, payload = {}) {
  const scheduleDaily = payload.scheduleDaily === true;
  const intervalDays = Math.max(1, Number(payload.intervalDays || 1));
  const startAt = payload.startAt ? new Date(payload.startAt) : null;
  const baseDate = startAt && !Number.isNaN(startAt.getTime()) ? startAt : new Date();

  return Array.from({ length: count }, (_, index) => {
    if (!scheduleDaily) {
      return payload.startAt ? baseDate.toISOString() : null;
    }

    const scheduledAt = new Date(baseDate.getTime() + index * intervalDays * 24 * 60 * 60 * 1000);
    return scheduledAt.toISOString();
  });
}

function resolvePublicationState(account, scheduledFor) {
  if (account.oauth_status !== "connected") {
    return {
      status: "awaiting_oauth",
      statusDetail: "Connect OAuth credentials before publishing"
    };
  }

  if (scheduledFor && new Date(scheduledFor).getTime() > Date.now()) {
    return {
      status: "scheduled",
      statusDetail: `Scheduled for ${new Date(scheduledFor).toLocaleString()}`
    };
  }

  return {
    status: "ready",
    statusDetail: "Ready to upload through the YouTube API"
  };
}

async function findExistingActivePublication({ mediaItemId, libraryVideoId, youtubeAccountId }) {
  const result = await query(
    `
      SELECT *
      FROM publications
      WHERE youtube_account_id = $1
        AND (
          ($2::bigint IS NOT NULL AND media_item_id = $2)
          OR ($3::bigint IS NOT NULL AND library_video_id = $3)
        )
        AND status IN ('awaiting_oauth', 'scheduled', 'ready', 'publishing')
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [youtubeAccountId, mediaItemId || null, libraryVideoId || null]
  );

  return result.rows[0] || null;
}

async function findExistingPublication({ mediaItemId, libraryVideoId, youtubeAccountId, profileCloneId }) {
  const result = await query(
    `
      SELECT *
      FROM publications
      WHERE youtube_account_id = $1
        AND (
          ($2::bigint IS NOT NULL AND media_item_id = $2)
          OR ($3::bigint IS NOT NULL AND library_video_id = $3)
        )
        AND ($4::bigint IS NULL OR profile_clone_id = $4 OR profile_clone_id IS NULL)
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [youtubeAccountId, mediaItemId || null, libraryVideoId || null, profileCloneId || null]
  );

  return result.rows[0] || null;
}

async function queuePublications(payload = {}) {
  const mediaIds = Array.isArray(payload.mediaIds)
    ? payload.mediaIds.map((value) => Number(value)).filter(Number.isFinite)
    : [];
  const libraryVideoIds = Array.isArray(payload.libraryVideoIds)
    ? payload.libraryVideoIds.map((value) => Number(value)).filter(Number.isFinite)
    : [];
  const youtubeAccountId = Number(payload.youtubeAccountId);

  if (mediaIds.length === 0 && libraryVideoIds.length === 0) {
    throw new Error("mediaIds or libraryVideoIds are required");
  }

  if (!Number.isFinite(youtubeAccountId)) {
    throw new Error("youtubeAccountId is required");
  }

  const accountResult = await query(
    `
      SELECT *
      FROM youtube_accounts
      WHERE id = $1
    `,
    [youtubeAccountId]
  );

  const account = accountResult.rows[0];
  if (!account) {
    throw new Error("YouTube account not found");
  }

  const mediaResult = await query(
    `
      SELECT
        mi.*,
        tp.username
      FROM media_items mi
      JOIN tracked_profiles tp ON tp.id = mi.tracked_profile_id
      WHERE mi.id = ANY($1::bigint[])
      ORDER BY array_position($1::bigint[], mi.id), mi.id DESC
    `,
    [mediaIds]
  );

  const libraryVideos = libraryVideoIds.length
    ? (
        await query(
          `
            SELECT *
            FROM library_videos
            WHERE id = ANY($1::bigint[])
            ORDER BY created_at ASC, id ASC
          `,
          [libraryVideoIds]
        )
      ).rows
    : [];

  const trackedScheduleDates = buildScheduleDates(mediaResult.rows.length, payload);
  const libraryScheduleDates = buildScheduleDates(libraryVideos.length, payload);
  const explicitScheduleDates = Array.isArray(payload.scheduleDates) ? payload.scheduleDates : [];

  const created = [];
  for (const [index, mediaItem] of mediaResult.rows.entries()) {
    const existing = await findExistingPublication({
      mediaItemId: mediaItem.id,
      libraryVideoId: null,
      youtubeAccountId,
      profileCloneId: payload.profileCloneId
    });
    if (existing) {
      created.push(existing);
      continue;
    }

    const title = sanitizeMetadataText(payload.title || buildDefaultTitle(mediaItem), 100);
    const description = sanitizeMetadataText(payload.description || buildDefaultDescription(mediaItem), 5000);
    const tags = sanitizeMetadataTags(payload.tags || [mediaItem.editorial_category, "shorts"]);
    const scheduledFor = explicitScheduleDates[index] || trackedScheduleDates[index];
    const publicationState = resolvePublicationState(account, scheduledFor);

    const insertResult = await query(
      `
        INSERT INTO publications (
          media_item_id,
          youtube_account_id,
          profile_clone_id,
          source_kind,
          title,
          description,
          tags,
          privacy_status,
          status,
          status_detail,
          scheduled_for,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, NOW())
        RETURNING *
      `,
      [
        mediaItem.id,
        youtubeAccountId,
        payload.profileCloneId || null,
        payload.sourceKind || "tracked_media",
        title,
        description,
        JSON.stringify(tags),
        payload.privacyStatus || env.youtubeDefaultPrivacyStatus,
        publicationState.status,
        publicationState.statusDetail,
        scheduledFor
      ]
    );

    await query(
      `
        UPDATE media_items
        SET publication_status = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [mediaItem.id, publicationState.status]
    );

    created.push(insertResult.rows[0]);
    await enqueuePublicationJob(insertResult.rows[0]);
  }

  for (const [index, libraryVideo] of libraryVideos.entries()) {
    const existing = await findExistingPublication({
      mediaItemId: null,
      libraryVideoId: libraryVideo.id,
      youtubeAccountId,
      profileCloneId: null
    });
    if (existing) {
      created.push(existing);
      continue;
    }

    const title = sanitizeMetadataText(payload.title || buildDefaultTitle(libraryVideo), 100);
    const description = sanitizeMetadataText(payload.description || buildDefaultDescription(libraryVideo), 5000);
    const tags = sanitizeMetadataTags(payload.tags || [libraryVideo.source_label, "shorts"]);
    const scheduledFor = libraryScheduleDates[index];
    const publicationState = resolvePublicationState(account, scheduledFor);

    const insertResult = await query(
      `
        INSERT INTO publications (
          library_video_id,
          youtube_account_id,
          source_kind,
          title,
          description,
          tags,
          privacy_status,
          status,
          status_detail,
          scheduled_for,
          updated_at
        )
        VALUES ($1, $2, 'library_video', $3, $4, $5::jsonb, $6, $7, $8, $9, NOW())
        RETURNING *
      `,
      [
        libraryVideo.id,
        youtubeAccountId,
        title,
        description,
        JSON.stringify(tags),
        payload.privacyStatus || env.youtubeDefaultPrivacyStatus,
        publicationState.status,
        publicationState.statusDetail,
        scheduledFor
      ]
    );

    created.push(insertResult.rows[0]);
    await enqueuePublicationJob(insertResult.rows[0]);
  }

  return created;
}

async function autoDistributeLibraryVideos(payload = {}) {
  const libraryVideoIds = Array.isArray(payload.libraryVideoIds)
    ? payload.libraryVideoIds.map((value) => Number(value)).filter(Number.isFinite)
    : [];
  const youtubeAccountIds = Array.isArray(payload.youtubeAccountIds)
    ? payload.youtubeAccountIds.map((value) => Number(value)).filter(Number.isFinite)
    : [];
  const intervalHours = Math.max(1, Number(payload.intervalHours || 24));
  const startAt = payload.startAt ? new Date(payload.startAt) : new Date();

  if (libraryVideoIds.length === 0) {
    throw new Error("libraryVideoIds are required");
  }

  if (youtubeAccountIds.length === 0) {
    throw new Error("youtubeAccountIds are required");
  }

  if (Number.isNaN(startAt.getTime())) {
    throw new Error("startAt is invalid");
  }

  const created = [];

  for (const [index, libraryVideoId] of libraryVideoIds.entries()) {
    const youtubeAccountId = youtubeAccountIds[index % youtubeAccountIds.length];
    const scheduledAt = new Date(startAt.getTime() + index * intervalHours * 60 * 60 * 1000);

    const queuedItems = await queuePublications({
      libraryVideoIds: [libraryVideoId],
      youtubeAccountId,
      title: payload.title,
      description: payload.description,
      tags: payload.tags,
      privacyStatus: payload.privacyStatus,
      startAt: scheduledAt.toISOString(),
      scheduleDaily: false,
      intervalDays: 1
    });

    created.push(...queuedItems);
  }

  return created;
}

async function listPublications() {
  const result = await query(
    `
      SELECT
        p.*,
        ya.channel_title,
        ya.channel_handle,
        ya.oauth_status,
        pc.tracked_profile_id AS clone_tracked_profile_id,
        clone_profile.username AS clone_username,
        clone_profile.display_name AS clone_display_name,
        COALESCE(mi.caption, lv.description) AS caption,
        COALESCE(mi.thumbnail_url, lv.thumbnail_url) AS thumbnail_url,
        mi.post_url,
        mi.score,
        tp.username,
        lv.original_filename,
        lv.source_label,
        lv.source_url,
        lv.storage_provider,
        lv.thumbnail_url AS library_thumbnail_url
      FROM publications p
      JOIN youtube_accounts ya ON ya.id = p.youtube_account_id
      LEFT JOIN profile_clones pc ON pc.id = p.profile_clone_id
      LEFT JOIN tracked_profiles clone_profile ON clone_profile.id = pc.tracked_profile_id
      LEFT JOIN media_items mi ON mi.id = p.media_item_id
      LEFT JOIN tracked_profiles tp ON tp.id = mi.tracked_profile_id
      LEFT JOIN library_videos lv ON lv.id = p.library_video_id
      ORDER BY p.created_at DESC, p.id DESC
    `
  );

  return result.rows;
}

async function updatePublicationMetadata(publicationId, payload = {}) {
  const publication = await getPublicationById(publicationId);
  if (!publication) {
    throw new Error("publication not found");
  }

  const nextTitle =
    payload.title !== undefined
      ? sanitizeMetadataText(payload.title, 100) || buildDefaultTitle(publication)
      : sanitizeMetadataText(publication.title || buildDefaultTitle(publication), 100);
  const nextDescription =
    payload.description !== undefined
      ? sanitizeMetadataText(payload.description, 5000)
      : sanitizeMetadataText(publication.description || "", 5000);

  await query(
    `
      UPDATE publications
      SET
        title = $2,
        description = $3,
        updated_at = NOW()
      WHERE id = $1
    `,
    [publicationId, nextTitle, nextDescription]
  );

  return getPublicationById(publicationId);
}

async function createUploadSession(publication, filePath) {
  const fileStat = await fs.promises.stat(filePath);
  const response = await youtubeApiRequest(publication.youtube_account_id, YOUTUBE_UPLOAD_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(fileStat.size),
      "X-Upload-Content-Type": publication.mime_type || getVideoMimeType(filePath)
    },
    body: JSON.stringify({
      snippet: {
        title: sanitizeMetadataText(publication.title || buildDefaultTitle(publication), 100),
        description: sanitizeMetadataText(publication.description || buildDefaultDescription(publication), 5000),
        tags: sanitizeMetadataTags(publication.tags),
        categoryId: "22"
      },
      status: {
        privacyStatus: publication.privacy_status || env.youtubeDefaultPrivacyStatus,
        selfDeclaredMadeForKids: false
      }
    })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(parseYoutubeError(data, "Failed to create YouTube upload session"));
  }

  const sessionUrl = response.headers.get("location");
  if (!sessionUrl) {
    throw new Error("YouTube did not return a resumable upload URL");
  }

  return sessionUrl;
}

async function uploadVideoBytes(publication, sessionUrl, filePath) {
  const fileBuffer = await fs.promises.readFile(filePath);
  const response = await youtubeApiRequest(publication.youtube_account_id, sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": publication.mime_type || getVideoMimeType(filePath),
      "Content-Length": String(fileBuffer.length)
    },
    body: fileBuffer
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(parseYoutubeError(data, "Failed to upload video bytes to YouTube"));
  }

  return data;
}

async function publishPublication(publicationId) {
  const publication = await getPublicationById(publicationId);
  if (!publication) {
    throw new Error("publication not found");
  }

  if (!publication.post_url && !publication.stored_path && !publication.source_url) {
    throw new Error("The source video is missing both local and remote references");
  }

  if (publication.oauth_status !== "connected") {
    throw new Error("Connect the YouTube account before publishing");
  }

  await query(
    `
      UPDATE publications
      SET
        status = 'publishing',
        status_detail = 'Downloading source video and uploading to YouTube',
        updated_at = NOW()
      WHERE id = $1
    `,
    [publicationId]
  );

  let tempDir = null;

  try {
    const libraryVideo = publication.library_video_id
      ? await getLibraryVideoById(publication.library_video_id)
      : null;
    const librarySource = libraryVideo ? await resolveLibraryVideoFile(libraryVideo) : null;
    const download = publication.post_url ? await downloadPostToTemp(publication.post_url) : null;
    const filePath = librarySource?.filePath || download?.filePath;
    tempDir = librarySource?.tempDir || download?.tempDir || null;

    if (!filePath) {
      throw new Error("The source video file is not available");
    }

    const sessionUrl = await createUploadSession(publication, filePath);
    const uploadResult = await uploadVideoBytes(publication, sessionUrl, filePath);
    const youtubeVideoId = uploadResult.id;
    const youtubeUrl = youtubeVideoId ? `https://www.youtube.com/watch?v=${youtubeVideoId}` : null;

    await query(
      `
        UPDATE publications
        SET
          status = 'published',
          status_detail = 'Video uploaded successfully',
          youtube_video_id = $2,
          youtube_url = $3,
          published_at = NOW(),
          last_synced_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
      [publicationId, youtubeVideoId, youtubeUrl]
    );

    await query(
      `
        UPDATE media_items
        SET publication_status = 'published', updated_at = NOW()
        WHERE id = $1
      `,
      [publication.media_item_id]
    ).catch(() => {});

    if (publication.profile_clone_id) {
      const { syncCloneCounters } = require("./cloneService");
      await syncCloneCounters(publication.profile_clone_id).catch(() => {});
    }

    return getPublicationById(publicationId);
  } catch (error) {
    await query(
      `
        UPDATE publications
        SET
          status = 'failed',
          status_detail = $2,
          updated_at = NOW()
        WHERE id = $1
      `,
      [publicationId, error.message]
    ).catch(() => {});

    await query(
      `
        UPDATE media_items
        SET publication_status = 'failed', updated_at = NOW()
        WHERE id = $1
      `,
      [publication.media_item_id]
    ).catch(() => {});

    if (publication.profile_clone_id) {
      const { syncCloneCounters } = require("./cloneService");
      await syncCloneCounters(publication.profile_clone_id).catch(() => {});
    }

    throw error;
  } finally {
    await cleanupTempDir(tempDir);
  }
}

async function syncPublication(publicationId) {
  const publication = await getPublicationById(publicationId);
  if (!publication) {
    throw new Error("publication not found");
  }

  if (!publication.youtube_video_id) {
    return publication;
  }

  const params = new URLSearchParams({
    part: "statistics,status,snippet",
    id: publication.youtube_video_id
  });
  const response = await youtubeApiRequest(
    publication.youtube_account_id,
    `${YOUTUBE_VIDEO_URL}?${params.toString()}`,
    {
      method: "GET"
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(parseYoutubeError(data, "Failed to read YouTube publication metrics"));
  }

  const video = data.items?.[0];
  if (!video) {
    throw new Error("The YouTube video was not found");
  }

  const stats = video.statistics || {};
  await query(
    `
      UPDATE publications
      SET
        status = 'published',
        status_detail = 'Metrics synced from YouTube',
        youtube_url = COALESCE($2, youtube_url),
        last_synced_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [publicationId, publication.youtube_url || `https://www.youtube.com/watch?v=${publication.youtube_video_id}`]
  );

  await query(
    `
      INSERT INTO publication_metrics_snapshots (
        publication_id,
        view_count,
        like_count,
        comment_count
      )
      VALUES ($1, $2, $3, $4)
    `,
    [
      publicationId,
      Number(stats.viewCount || 0),
      Number(stats.likeCount || 0),
      Number(stats.commentCount || 0)
    ]
  );

  return getPublicationById(publicationId);
}

module.exports = {
  queuePublications,
  autoDistributeLibraryVideos,
  listPublications,
  getPublicationById,
  updatePublicationMetadata,
  publishPublication,
  syncPublication
};
