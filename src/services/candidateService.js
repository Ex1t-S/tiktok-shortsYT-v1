const { query } = require("../db");

function buildRiskFlags(input) {
  if (!input) {
    return [];
  }

  if (Array.isArray(input)) {
    return input.filter(Boolean);
  }

  if (typeof input === "string") {
    return input
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return [];
}

function computeTrendScore(item) {
  const views = Number(item.viewCount || item.view_count || 0);
  const likes = Number(item.likeCount || item.like_count || 0);
  const comments = Number(item.commentCount || item.comment_count || 0);
  const reposts = Number(item.repostCount || item.repost_count || 0);
  const saves = Number(item.saveCount || item.save_count || 0);
  const publishedAt = item.publishedAt || item.published_at || null;
  const ageHours = publishedAt
    ? Math.max(1, (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60))
    : 24 * 14;
  const recencyBoost = Math.max(0, 96 - ageHours) * 20;
  const engagement = likes * 1.2 + comments * 3 + reposts * 4 + saves * 2;
  const score = views + engagement + recencyBoost;
  const reasonParts = [];

  if (views >= 100000) {
    reasonParts.push("viral views");
  } else if (views >= 10000) {
    reasonParts.push("strong views");
  } else if (views >= 1000) {
    reasonParts.push("healthy views");
  }

  if (ageHours <= 24) {
    reasonParts.push("fresh in the last day");
  } else if (ageHours <= 72) {
    reasonParts.push("recent in the last 3 days");
  }

  if (engagement >= 1000) {
    reasonParts.push("engagement spike");
  }

  return {
    score: Number(score.toFixed(2)),
    reason: reasonParts.join(" + ") || "baseline candidate",
    isCandidate: score >= 1500
  };
}

async function listCandidates(filters = {}) {
  const values = [];
  const conditions = [];

  if (filters.reviewStatus) {
    values.push(filters.reviewStatus);
    conditions.push(`mi.review_status = $${values.length}`);
  }

  if (filters.editorialCategory) {
    values.push(filters.editorialCategory);
    conditions.push(`mi.editorial_category = $${values.length}`);
  }

  if (filters.profileUsername) {
    values.push(filters.profileUsername.replace(/^@+/, "").trim());
    conditions.push(`tp.username = $${values.length}`);
  }

  if (filters.candidatesOnly !== false) {
    conditions.push("mi.is_candidate = TRUE");
  }

  const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 200);
  values.push(limit);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await query(
    `
      SELECT
        mi.*,
        tp.username,
        tp.display_name,
        tp.profile_url
      FROM media_items mi
      JOIN tracked_profiles tp ON tp.id = mi.tracked_profile_id
      ${where}
      ORDER BY mi.score DESC, COALESCE(mi.published_at, mi.created_at) DESC, mi.id DESC
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows;
}

async function getDashboardSummary() {
  const result = await query(
    `
      SELECT
        (SELECT COUNT(*) FROM tracked_profiles) AS tracked_profiles,
        (SELECT COUNT(*) FROM media_items) AS media_items,
        (SELECT COUNT(*) FROM media_items WHERE is_candidate = TRUE) AS candidate_items,
        (SELECT COUNT(*) FROM publications WHERE status IN ('queued', 'ready', 'publishing')) AS queued_publications,
        (SELECT COUNT(*) FROM publications WHERE status = 'scheduled') AS scheduled_publications,
        (SELECT COUNT(*) FROM youtube_accounts) AS youtube_accounts,
        (SELECT COUNT(*) FROM library_videos) AS library_videos,
        (SELECT COUNT(*) FROM tracked_profiles WHERE last_scrape_status = 'success') AS successful_scrapes,
        (SELECT COUNT(*) FROM tracked_profiles WHERE last_scrape_status = 'failed') AS failed_scrapes,
        (SELECT COUNT(*) FROM media_items WHERE review_status = 'approved') AS approved_candidates,
        (SELECT COUNT(*) FROM media_items WHERE publication_status = 'published') AS published_media,
        (SELECT COUNT(*) FROM scrape_runs WHERE started_at >= NOW() - INTERVAL '24 hours') AS recent_scrape_runs,
        COALESCE((
          SELECT json_agg(row_to_json(recent_profiles_row))
          FROM (
            SELECT
              username,
              display_name,
              total_media_count,
              video_count,
              image_count,
              last_scraped_at,
              last_scrape_status,
              last_scrape_error
            FROM tracked_profiles
            ORDER BY COALESCE(last_scraped_at, created_at) DESC, id DESC
            LIMIT 5
          ) recent_profiles_row
        ), '[]'::json) AS recent_profiles,
        COALESCE((
          SELECT json_agg(row_to_json(recent_publications_row))
          FROM (
            SELECT
              p.id,
              p.status,
              p.title,
              p.created_at,
              tp.username
            FROM publications p
            JOIN media_items mi ON mi.id = p.media_item_id
            JOIN tracked_profiles tp ON tp.id = mi.tracked_profile_id
            ORDER BY p.created_at DESC, p.id DESC
            LIMIT 5
          ) recent_publications_row
        ), '[]'::json) AS recent_publications
    `
  );

  return result.rows[0];
}

async function updateCandidateReview(mediaId, payload = {}) {
  const riskFlags = buildRiskFlags(payload.riskFlags);
  const result = await query(
    `
      UPDATE media_items
      SET
        review_status = COALESCE($2, review_status),
        editorial_category = COALESCE($3, editorial_category),
        risk_flags = CASE WHEN $4::jsonb = '[]'::jsonb THEN risk_flags ELSE $4::jsonb END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [mediaId, payload.reviewStatus || null, payload.editorialCategory || null, JSON.stringify(riskFlags)]
  );

  return result.rows[0] || null;
}

async function backfillCandidateSignals() {
  const result = await query(
    `
      SELECT
        id,
        published_at,
        raw_payload
      FROM media_items
      WHERE score = 0
         OR score_reason IS NULL
         OR review_status IS NULL
      ORDER BY id ASC
    `
  );

  for (const row of result.rows) {
    const rawPayload = row.raw_payload?.raw || row.raw_payload || {};
    const trend = computeTrendScore({
      viewCount: rawPayload.view_count,
      likeCount: rawPayload.like_count,
      commentCount: rawPayload.comment_count,
      repostCount: rawPayload.repost_count,
      saveCount: rawPayload.save_count,
      publishedAt: row.published_at || (rawPayload.timestamp ? new Date(rawPayload.timestamp * 1000).toISOString() : null)
    });
    const riskFlags = buildRiskFlags([
      ...(Array.isArray(rawPayload.formats) &&
      rawPayload.formats.some((format) => String(format.format_note || "").toLowerCase().includes("watermark"))
        ? ["watermark_format_available"]
        : []),
      ...(String(rawPayload.channel_url || "").includes("MS4wLjAB") ? ["channel_id_profile_url"] : [])
    ]);

    await query(
      `
        UPDATE media_items
        SET
          view_count = COALESCE(NULLIF(view_count, 0), $2),
          like_count = COALESCE(NULLIF(like_count, 0), $3),
          comment_count = COALESCE(NULLIF(comment_count, 0), $4),
          repost_count = COALESCE(NULLIF(repost_count, 0), $5),
          save_count = COALESCE(NULLIF(save_count, 0), $6),
          score = $7,
          score_reason = $8,
          is_candidate = $9,
          risk_flags = CASE WHEN risk_flags = '[]'::jsonb THEN $10::jsonb ELSE risk_flags END,
          review_status = COALESCE(review_status, 'pending'),
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        row.id,
        Number(rawPayload.view_count || 0),
        Number(rawPayload.like_count || 0),
        Number(rawPayload.comment_count || 0),
        Number(rawPayload.repost_count || 0),
        Number(rawPayload.save_count || 0),
        trend.score,
        trend.reason,
        trend.isCandidate,
        JSON.stringify(riskFlags)
      ]
    );
  }

  return result.rows.length;
}

module.exports = {
  computeTrendScore,
  listCandidates,
  getDashboardSummary,
  updateCandidateReview,
  buildRiskFlags,
  backfillCandidateSignals
};
