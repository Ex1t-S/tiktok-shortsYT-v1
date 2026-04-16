const { query } = require("../db");
const { queuePublications } = require("./publicationService");
const { getYoutubeAccountById } = require("./youtubeService");
const { getProfileByUsername } = require("./profileService");

function resolveCloneScheduleDates(count, dailyLimit, startAt) {
  const safeDailyLimit = Math.max(1, Number(dailyLimit || 1));
  const baseDate = startAt ? new Date(startAt) : new Date();
  const safeBaseDate = Number.isNaN(baseDate.getTime()) ? new Date() : baseDate;

  return Array.from({ length: count }, (_, index) => {
    const dayOffset = Math.floor(index / safeDailyLimit);
    const scheduledAt = new Date(safeBaseDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    return scheduledAt.toISOString();
  });
}

async function syncCloneCounters(cloneId) {
  const result = await query(
    `
      UPDATE profile_clones pc
      SET
        total_items_count = stats.total_items_count,
        queued_items_count = stats.queued_items_count,
        published_items_count = stats.published_items_count,
        failed_items_count = stats.failed_items_count,
        updated_at = NOW()
      FROM (
        SELECT
          pc_inner.id,
          COUNT(p.id)::int AS total_items_count,
          COUNT(*) FILTER (
            WHERE p.status IN ('awaiting_oauth', 'ready', 'scheduled', 'publishing', 'queued')
          )::int AS queued_items_count,
          COUNT(*) FILTER (WHERE p.status = 'published')::int AS published_items_count,
          COUNT(*) FILTER (WHERE p.status = 'failed')::int AS failed_items_count
        FROM profile_clones pc_inner
        LEFT JOIN publications p ON p.profile_clone_id = pc_inner.id
        WHERE pc_inner.id = $1
        GROUP BY pc_inner.id
      ) stats
      WHERE pc.id = stats.id
      RETURNING pc.*
    `,
    [cloneId]
  );

  return result.rows[0] || null;
}

async function listProfileClones(youtubeAccountId) {
  const result = await query(
    `
      SELECT
        pc.*,
        COALESCE(stats.total_items_count, pc.total_items_count, 0) AS total_items_count,
        COALESCE(stats.queued_items_count, pc.queued_items_count, 0) AS queued_items_count,
        COALESCE(stats.published_items_count, pc.published_items_count, 0) AS published_items_count,
        COALESCE(stats.failed_items_count, pc.failed_items_count, 0) AS failed_items_count,
        tp.username,
        tp.display_name,
        tp.avatar_url,
        tp.total_media_count,
        tp.video_count,
        tp.last_scraped_at,
        tp.last_scrape_status
      FROM profile_clones pc
      JOIN tracked_profiles tp ON tp.id = pc.tracked_profile_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(p.id)::int AS total_items_count,
          COUNT(*) FILTER (
            WHERE p.status IN ('awaiting_oauth', 'ready', 'scheduled', 'publishing', 'queued')
          )::int AS queued_items_count,
          COUNT(*) FILTER (WHERE p.status = 'published')::int AS published_items_count,
          COUNT(*) FILTER (WHERE p.status = 'failed')::int AS failed_items_count
        FROM publications p
        WHERE p.profile_clone_id = pc.id
      ) stats ON TRUE
      WHERE pc.youtube_account_id = $1
      ORDER BY pc.updated_at DESC, pc.id DESC
    `,
    [youtubeAccountId]
  );

  return result.rows;
}

async function createProfileClone(youtubeAccountId, payload = {}) {
  const account = await getYoutubeAccountById(youtubeAccountId);
  if (!account) {
    throw new Error("YouTube account not found");
  }

  const trackedProfileId = Number(payload.trackedProfileId);
  const dailyLimit = Math.max(1, Number(payload.dailyLimit || 1));
  const startAt = payload.startAt ? new Date(payload.startAt) : new Date();
  if (!Number.isFinite(trackedProfileId)) {
    throw new Error("trackedProfileId is required");
  }
  if (Number.isNaN(startAt.getTime())) {
    throw new Error("startAt is invalid");
  }

  const trackedProfileResult = await query(
    `
      SELECT *
      FROM tracked_profiles
      WHERE id = $1
    `,
    [trackedProfileId]
  );
  const trackedProfile = trackedProfileResult.rows[0] || null;
  if (!trackedProfile) {
    throw new Error("Tracked profile not found");
  }

  const mediaItemsResult = await query(
    `
      SELECT id
      FROM media_items
      WHERE tracked_profile_id = $1
        AND media_type = 'video'
      ORDER BY COALESCE(published_at, discovered_at, created_at) DESC, id DESC
    `,
    [trackedProfileId]
  );
  const mediaIds = mediaItemsResult.rows.map((row) => row.id);
  if (mediaIds.length === 0) {
    throw new Error("The tracked profile does not have scraped videos");
  }

  const cloneResult = await query(
    `
      INSERT INTO profile_clones (
        youtube_account_id,
        tracked_profile_id,
        status,
        daily_limit,
        updated_at
      )
      VALUES ($1, $2, 'active', $3, NOW())
      ON CONFLICT (youtube_account_id, tracked_profile_id)
      DO UPDATE SET
        status = 'active',
        daily_limit = EXCLUDED.daily_limit,
        updated_at = NOW()
      RETURNING *
    `,
    [youtubeAccountId, trackedProfileId, dailyLimit]
  );
  const clone = cloneResult.rows[0];
  const scheduleDates = resolveCloneScheduleDates(mediaIds.length, dailyLimit, startAt);
  const publications = await queuePublications({
    mediaIds,
    youtubeAccountId,
    scheduleDates,
    profileCloneId: clone.id,
    sourceKind: "clone"
  });

  const lastScheduledFor = publications
    .map((item) => item.scheduled_for)
    .filter(Boolean)
    .sort()
    .at(-1);

  await query(
    `
      UPDATE profile_clones
      SET
        total_items_count = $2,
        last_scheduled_for = $3,
        last_run_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [clone.id, mediaIds.length, lastScheduledFor || startAt.toISOString()]
  );

  const synced = await syncCloneCounters(clone.id);
  return {
    clone: {
      ...synced,
      username: trackedProfile.username,
      display_name: trackedProfile.display_name,
      avatar_url: trackedProfile.avatar_url,
      total_media_count: trackedProfile.total_media_count,
      video_count: trackedProfile.video_count,
      last_scraped_at: trackedProfile.last_scraped_at,
      last_scrape_status: trackedProfile.last_scrape_status
    },
    queuedItems: publications
  };
}

async function getClonePreviewByUsername(username, dailyLimit, startAt) {
  const profile = await getProfileByUsername(username);
  if (!profile) {
    return null;
  }

  const totalVideosResult = await query(
    `
      SELECT COUNT(*)::int AS total_videos
      FROM media_items
      WHERE tracked_profile_id = $1
        AND media_type = 'video'
    `,
    [profile.id]
  );

  const totalVideos = Number(totalVideosResult.rows[0]?.total_videos || 0);
  return {
    profileId: profile.id,
    username: profile.username,
    totalVideos,
    dailyLimit: Math.max(1, Number(dailyLimit || 1)),
    scheduleDates: resolveCloneScheduleDates(Math.min(totalVideos, 6), dailyLimit, startAt)
  };
}

module.exports = {
  listProfileClones,
  createProfileClone,
  getClonePreviewByUsername,
  resolveCloneScheduleDates,
  syncCloneCounters
};
