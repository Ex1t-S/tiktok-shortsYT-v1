const { query } = require("../db");
const { normalizeUsername, normalizeHashtag, scrapeHashtag, scrapeProfile } = require("./tiktokScraper");
const { listProfileVideos } = require("./ytDlpService");
const { computeTrendScore, buildRiskFlags } = require("./candidateService");

const activeTrackingJobs = new Map();

function detectTrackingSource(input, explicitSourceType) {
  if (explicitSourceType) {
    return explicitSourceType;
  }

  return String(input || "").trim().startsWith("#") ? "hashtag" : "profile";
}

function normalizeTrackingKey(input, sourceType) {
  const value = String(input || "").trim().toLowerCase();

  if (sourceType === "hashtag") {
    return value.startsWith("tag-") ? value : `tag-${normalizeHashtag(input)}`;
  }

  return normalizeUsername(value);
}

function buildProfileUrl(username, sourceType) {
  if (sourceType === "hashtag") {
    return `https://www.tiktok.com/tag/${encodeURIComponent(String(username || "").replace(/^tag-/, ""))}`;
  }

  return `https://www.tiktok.com/@${username}`;
}

async function getProfileByUsername(usernameInput) {
  const username = normalizeTrackingKey(
    usernameInput,
    String(usernameInput || "").trim().toLowerCase().startsWith("tag-") ? "hashtag" : "profile"
  );
  const result = await query(
    `
      SELECT *
      FROM tracked_profiles
      WHERE username = $1
    `,
    [username]
  );

  return result.rows[0] || null;
}

async function listTrackedProfiles(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 200), 1), 500);
  const result = await query(
    `
      SELECT
        tp.*,
        (
          SELECT COUNT(*)
          FROM media_items mi
          WHERE mi.tracked_profile_id = tp.id
            AND mi.media_type = 'video'
        )::int AS stored_video_count,
        (
          SELECT COUNT(*)
          FROM media_items mi
          WHERE mi.tracked_profile_id = tp.id
        )::int AS stored_items_count,
        sr.status AS latest_run_status,
        sr.progress_message AS latest_run_message,
        sr.started_at AS latest_run_started_at,
        sr.finished_at AS latest_run_finished_at
      FROM tracked_profiles tp
      LEFT JOIN LATERAL (
        SELECT status, progress_message, started_at, finished_at
        FROM scrape_runs
        WHERE tracked_profile_id = tp.id
        ORDER BY started_at DESC, id DESC
        LIMIT 1
      ) sr ON TRUE
      ORDER BY COALESCE(tp.last_scraped_at, tp.updated_at, tp.created_at) DESC, tp.id DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

async function listMediaByUsername(usernameInput, options = {}) {
  const username = normalizeTrackingKey(
    usernameInput,
    String(usernameInput || "").trim().toLowerCase().startsWith("tag-") ? "hashtag" : "profile"
  );
  const limit = Math.max(1, Number(options.limit || 20));
  const result = await query(
    `
      SELECT
        mi.*,
        tp.username
      FROM media_items mi
      JOIN tracked_profiles tp ON tp.id = mi.tracked_profile_id
      WHERE tp.username = $1
      ORDER BY COALESCE(mi.published_at, mi.created_at) DESC, mi.id DESC
      LIMIT $2
    `,
    [username, limit]
  );

  return result.rows;
}

async function getMediaById(mediaId) {
  const result = await query(
    `
      SELECT
        mi.*,
        tp.username
      FROM media_items mi
      JOIN tracked_profiles tp ON tp.id = mi.tracked_profile_id
      WHERE mi.id = $1
    `,
    [mediaId]
  );

  return result.rows[0] || null;
}

async function ensureTrackedProfile(username, sourceType) {
  const result = await query(
    `
      INSERT INTO tracked_profiles (
        username,
        display_name,
        avatar_url,
        profile_url,
        total_media_count,
        video_count,
        image_count,
        last_scraped_at,
        last_scrape_status,
        last_scrape_error,
        updated_at
      )
      VALUES ($1, $2, NULL, $3, 0, 0, 0, NOW(), 'running', NULL, NOW())
      ON CONFLICT (username)
      DO UPDATE SET
        profile_url = COALESCE(tracked_profiles.profile_url, EXCLUDED.profile_url),
        last_scraped_at = NOW(),
        last_scrape_status = 'running',
        last_scrape_error = NULL,
        updated_at = NOW()
      RETURNING *
    `,
    [username, sourceType === "hashtag" ? `#${username.replace(/^tag-/, "")}` : `@${username}`, buildProfileUrl(username, sourceType)]
  );

  return result.rows[0];
}

async function createScrapeRun(profileId, { runType, sourceType, queryValue }) {
  const result = await query(
    `
      INSERT INTO scrape_runs (
        tracked_profile_id,
        run_type,
        source_type,
        query,
        status,
        progress_phase,
        progress_message
      )
      VALUES ($1, $2, $3, $4, 'running', 'queued', 'Preparando tracking')
      RETURNING *
    `,
    [profileId, runType, sourceType, queryValue]
  );

  return result.rows[0];
}

async function updateScrapeRun(runId, updates = {}) {
  const fields = [];
  const values = [];

  if (updates.status !== undefined) {
    values.push(updates.status);
    fields.push(`status = $${values.length}`);
  }

  if (updates.progressPhase !== undefined) {
    values.push(updates.progressPhase);
    fields.push(`progress_phase = $${values.length}`);
  }

  if (updates.progressMessage !== undefined) {
    values.push(updates.progressMessage);
    fields.push(`progress_message = $${values.length}`);
  }

  if (updates.expectedCount !== undefined) {
    values.push(Number(updates.expectedCount || 0));
    fields.push(`expected_count = $${values.length}`);
  }

  if (updates.processedCount !== undefined) {
    values.push(Number(updates.processedCount || 0));
    fields.push(`processed_count = $${values.length}`);
  }

  if (updates.savedCount !== undefined) {
    values.push(Number(updates.savedCount || 0));
    fields.push(`saved_count = $${values.length}`);
  }

  if (updates.detectedCount !== undefined) {
    values.push(Number(updates.detectedCount || 0));
    fields.push(`detected_count = $${values.length}`);
  }

  if (updates.newItemsCount !== undefined) {
    values.push(Number(updates.newItemsCount || 0));
    fields.push(`new_items_count = $${values.length}`);
  }

  if (updates.errorMessage !== undefined) {
    values.push(updates.errorMessage);
    fields.push(`error_message = $${values.length}`);
  }

  if (updates.finished === true) {
    fields.push("finished_at = NOW()");
  }

  if (fields.length === 0) {
    return null;
  }

  values.push(runId);
  const result = await query(
    `
      UPDATE scrape_runs
      SET ${fields.join(", ")}
      WHERE id = $${values.length}
      RETURNING *
    `,
    values
  );

  return result.rows[0] || null;
}

async function updateTrackedProfile(profileId, updates = {}) {
  const fields = [];
  const values = [];

  if (updates.displayName !== undefined) {
    values.push(updates.displayName);
    fields.push(`display_name = $${values.length}`);
  }

  if (updates.avatarUrl !== undefined) {
    values.push(updates.avatarUrl);
    fields.push(`avatar_url = $${values.length}`);
  }

  if (updates.profileUrl !== undefined) {
    values.push(updates.profileUrl);
    fields.push(`profile_url = $${values.length}`);
  }

  if (updates.totalMediaCount !== undefined) {
    values.push(Number(updates.totalMediaCount || 0));
    fields.push(`total_media_count = $${values.length}`);
  }

  if (updates.videoCount !== undefined) {
    values.push(Number(updates.videoCount || 0));
    fields.push(`video_count = $${values.length}`);
  }

  if (updates.imageCount !== undefined) {
    values.push(Number(updates.imageCount || 0));
    fields.push(`image_count = $${values.length}`);
  }

  if (updates.lastScrapeStatus !== undefined) {
    values.push(updates.lastScrapeStatus);
    fields.push(`last_scrape_status = $${values.length}`);
  }

  if (updates.lastScrapeError !== undefined) {
    values.push(updates.lastScrapeError);
    fields.push(`last_scrape_error = $${values.length}`);
  }

  fields.push("last_scraped_at = NOW()");
  fields.push("updated_at = NOW()");

  values.push(profileId);
  const result = await query(
    `
      UPDATE tracked_profiles
      SET ${fields.join(", ")}
      WHERE id = $${values.length}
      RETURNING *
    `,
    values
  );

  return result.rows[0] || null;
}

async function persistTrackedItem({ profileId, sourceType, item }) {
  const trend = computeTrendScore(item);
  const riskFlags = buildRiskFlags(item.riskFlags);
  const result = await query(
    `
      INSERT INTO media_items (
        tracked_profile_id,
        external_id,
        post_url,
        media_url,
        thumbnail_url,
        media_type,
        caption,
        duration_seconds,
        view_count,
        like_count,
        comment_count,
        repost_count,
        save_count,
        source_type,
        discovered_at,
        score,
        score_reason,
        is_candidate,
        risk_flags,
        published_at,
        raw_payload,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, NOW(), $15, $16, $17, $18::jsonb,
        $19, $20::jsonb, NOW()
      )
      ON CONFLICT (tracked_profile_id, external_id)
      DO UPDATE SET
        post_url = EXCLUDED.post_url,
        media_url = EXCLUDED.media_url,
        thumbnail_url = EXCLUDED.thumbnail_url,
        media_type = EXCLUDED.media_type,
        caption = EXCLUDED.caption,
        duration_seconds = EXCLUDED.duration_seconds,
        view_count = EXCLUDED.view_count,
        like_count = EXCLUDED.like_count,
        comment_count = EXCLUDED.comment_count,
        repost_count = EXCLUDED.repost_count,
        save_count = EXCLUDED.save_count,
        source_type = EXCLUDED.source_type,
        discovered_at = EXCLUDED.discovered_at,
        score = EXCLUDED.score,
        score_reason = EXCLUDED.score_reason,
        is_candidate = EXCLUDED.is_candidate,
        risk_flags = EXCLUDED.risk_flags,
        published_at = EXCLUDED.published_at,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS inserted
    `,
    [
      profileId,
      item.externalId,
      item.postUrl,
      item.mediaUrl,
      item.thumbnailUrl,
      item.mediaType,
      item.title || item.caption,
      item.durationSeconds,
      item.viewCount,
      item.likeCount,
      item.commentCount,
      item.repostCount,
      item.saveCount,
      sourceType,
      trend.score,
      trend.reason,
      trend.isCandidate,
      JSON.stringify(riskFlags),
      item.publishedAt,
      JSON.stringify(item)
    ]
  );

  return {
    id: result.rows[0]?.id || null,
    inserted: Boolean(result.rows[0]?.inserted),
    mediaType: item.mediaType
  };
}

async function getLatestScrapeRun(usernameInput) {
  const username = normalizeTrackingKey(
    usernameInput,
    String(usernameInput || "").trim().toLowerCase().startsWith("tag-") ? "hashtag" : "profile"
  );
  const result = await query(
    `
      SELECT
        sr.*,
        tp.username,
        tp.display_name,
        tp.avatar_url,
        tp.profile_url,
        tp.total_media_count,
        tp.video_count,
        tp.image_count,
        tp.last_scraped_at,
        tp.last_scrape_status,
        tp.last_scrape_error
      FROM scrape_runs sr
      JOIN tracked_profiles tp ON tp.id = sr.tracked_profile_id
      WHERE tp.username = $1
      ORDER BY sr.started_at DESC, sr.id DESC
      LIMIT 1
    `,
    [username]
  );

  return result.rows[0] || null;
}

async function getTrackingStatus(usernameInput, limit = 20) {
  const profile = await getProfileByUsername(usernameInput);
  const scrape = await getLatestScrapeRun(usernameInput);
  const safeLimit = Math.max(1, Number(limit || 20));
  const items = profile ? await listMediaByUsername(usernameInput, { limit: safeLimit }) : [];

  return {
    profile,
    scrape,
    items
  };
}

async function scrapeProfileWithFallbackStreaming(usernameInput, hooks = {}) {
  const normalizedUsername = normalizeUsername(usernameInput);
  const scrapeLimit = Math.max(1, Number(hooks.limit || 20));

  if (!normalizedUsername) {
    throw new Error("El usuario de TikTok no es válido");
  }

  await hooks.onProgress?.({
    phase: "yt_dlp_lookup",
    message: `Consultando @${normalizedUsername} con yt-dlp`
  });

  try {
    const ytDlpResult = await listProfileVideos(normalizedUsername, { limit: scrapeLimit });
    if (Array.isArray(ytDlpResult.mediaItems) && ytDlpResult.mediaItems.length > 0) {
      await hooks.onProgress?.({
        phase: "persisting_items",
        message: `yt-dlp devolvió ${ytDlpResult.mediaItems.length} items. Guardando en la base`,
        expectedCount: ytDlpResult.mediaItems.length,
        processedCount: 0
      });

      for (const [index, item] of ytDlpResult.mediaItems.entries()) {
        await hooks.onItem?.(item, {
          phase: "persisting_items",
          expectedCount: ytDlpResult.mediaItems.length,
          processedCount: index + 1
        });
      }

      return ytDlpResult;
    }
  } catch (ytDlpError) {
    await hooks.onProgress?.({
      phase: "yt_dlp_failed",
      message: `yt-dlp falló. Probando navegador: ${ytDlpError.message}`
    });
  }

  await hooks.onProgress?.({
    phase: "browser_fallback",
    message: `Iniciando fallback con navegador para @${normalizedUsername}`
  });

  return scrapeProfile(normalizedUsername, {
    ...hooks,
    limit: scrapeLimit
  });
}

async function executeTrackingRun({ username, sourceType, runType, profileId, runId }) {
  const scrapeLimit = Math.max(1, Number(runType?.limit || 20));
  const state = {
    savedCount: 0,
    newItemsCount: 0,
    detectedCount: 0,
    videoCount: 0,
    imageCount: 0
  };

  const onProgress = async (progress) => {
    await updateScrapeRun(runId, {
      status: "running",
      progressPhase: progress.phase,
      progressMessage: progress.message,
      expectedCount: progress.expectedCount !== undefined ? progress.expectedCount : undefined,
      processedCount: progress.processedCount !== undefined ? progress.processedCount : undefined,
      savedCount: state.savedCount,
      detectedCount: state.detectedCount,
      newItemsCount: state.newItemsCount
    });
  };

  const onItem = async (item, meta = {}) => {
    const persisted = await persistTrackedItem({ profileId, sourceType, item });
    state.detectedCount += 1;
    state.savedCount += 1;
    if (persisted.inserted) {
      state.newItemsCount += 1;
    }
    if (persisted.mediaType === "video") {
      state.videoCount += 1;
    } else if (persisted.mediaType === "image") {
      state.imageCount += 1;
    }

    await updateTrackedProfile(profileId, {
      totalMediaCount: state.savedCount,
      videoCount: state.videoCount,
      imageCount: state.imageCount,
      lastScrapeStatus: "running",
      lastScrapeError: null
    });

    await updateScrapeRun(runId, {
      status: "running",
      progressPhase: meta.phase || "persisting_items",
      progressMessage:
        meta.message ||
        `Guardando items ${state.savedCount}${meta.expectedCount ? ` de ${meta.expectedCount}` : ""}`,
      expectedCount: meta.expectedCount !== undefined ? meta.expectedCount : undefined,
      processedCount: meta.processedCount !== undefined ? meta.processedCount : state.savedCount,
      savedCount: state.savedCount,
      detectedCount: state.detectedCount,
      newItemsCount: state.newItemsCount
    });
  };

  try {
    const scraped =
      sourceType === "hashtag"
        ? await scrapeHashtag(username.replace(/^tag-/, "#"), { onProgress, onItem, limit: scrapeLimit })
        : await scrapeProfileWithFallbackStreaming(username, { onProgress, onItem, limit: scrapeLimit });

    await updateTrackedProfile(profileId, {
      displayName: scraped.profile.displayName,
      avatarUrl: scraped.profile.avatarUrl,
      profileUrl: scraped.profile.profileUrl,
      totalMediaCount: Math.max(state.savedCount, scraped.mediaItems.length),
      videoCount: state.videoCount,
      imageCount: state.imageCount,
      lastScrapeStatus: "success",
      lastScrapeError: null
    });

    await updateScrapeRun(runId, {
      status: "success",
      progressPhase: "completed",
      progressMessage: `Tracking finalizado. ${state.savedCount} items guardados`,
      expectedCount: Math.max(state.savedCount, scraped.mediaItems.length),
      processedCount: Math.max(state.savedCount, scraped.mediaItems.length),
      savedCount: state.savedCount,
      detectedCount: Math.max(state.detectedCount, scraped.mediaItems.length),
      newItemsCount: state.newItemsCount,
      finished: true
    });
  } catch (error) {
    await updateTrackedProfile(profileId, {
      lastScrapeStatus: "failed",
      lastScrapeError: error.message
    }).catch(() => {});

    await updateScrapeRun(runId, {
      status: "failed",
      progressPhase: "failed",
      progressMessage: error.message,
      savedCount: state.savedCount,
      detectedCount: state.detectedCount,
      newItemsCount: state.newItemsCount,
      errorMessage: error.message,
      finished: true
    }).catch(() => {});
  } finally {
    activeTrackingJobs.delete(username);
  }
}

async function startTrackingJob(usernameInput, options = {}) {
  const sourceType = detectTrackingSource(usernameInput, options.sourceType);
  const username = normalizeTrackingKey(usernameInput, sourceType);
  const requestedLimit = Math.max(1, Number(options.limit || 20));
  const runType = {
    type: options.runType || "manual",
    limit: requestedLimit
  };

  if (!username || username === "tag-") {
    throw new Error(sourceType === "hashtag" ? "El hashtag no es válido" : "El usuario de TikTok no es válido");
  }

  const existingJob = activeTrackingJobs.get(username);
  if (existingJob) {
    return {
      profile: await getProfileByUsername(username),
      scrape: await getLatestScrapeRun(username),
      started: false,
      alreadyRunning: true
    };
  }

  const profile = await ensureTrackedProfile(username, sourceType);
  const scrape = await createScrapeRun(profile.id, {
    runType: runType.type,
    sourceType,
    queryValue: usernameInput
  });

  const jobPromise = executeTrackingRun({
    username,
    sourceType,
    runType,
    profileId: profile.id,
    runId: scrape.id
  }).catch(() => {});

  activeTrackingJobs.set(username, {
    runId: scrape.id,
    promise: jobPromise
  });

  return {
    profile,
    scrape,
    started: true,
    alreadyRunning: false
  };
}

module.exports = {
  startTrackingJob,
  getTrackingStatus,
  listTrackedProfiles,
  getProfileByUsername,
  listMediaByUsername,
  getMediaById
};
