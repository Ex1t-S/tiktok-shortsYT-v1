const { query } = require("../db");
const { normalizeUsername, normalizeHashtag } = require("./tiktokScraper");
const { trackProfile } = require("./profileService");

async function listDiscoverySeeds() {
  const result = await query(
    `
      SELECT *
      FROM discovery_seeds
      ORDER BY is_active DESC, updated_at DESC, id DESC
    `
  );

  return result.rows;
}

async function createDiscoverySeed(payload = {}) {
  const seedType = String(payload.seedType || "profile").trim().toLowerCase();
  const rawQuery = String(payload.query || "").trim();
  if (!rawQuery) {
    throw new Error("query is required");
  }

  const queryValue =
    seedType === "profile"
      ? normalizeUsername(rawQuery)
      : seedType === "hashtag"
        ? `#${normalizeHashtag(rawQuery)}`
        : rawQuery;
  const result = await query(
    `
      INSERT INTO discovery_seeds (
        seed_type,
        query,
        label,
        notes,
        is_active,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (seed_type, query)
      DO UPDATE SET
        label = COALESCE(EXCLUDED.label, discovery_seeds.label),
        notes = COALESCE(EXCLUDED.notes, discovery_seeds.notes),
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
      RETURNING *
    `,
    [
      seedType,
      queryValue,
      payload.label ? String(payload.label).trim() : null,
      payload.notes ? String(payload.notes).trim() : null,
      payload.isActive !== false
    ]
  );

  return result.rows[0];
}

async function runDiscoverySeed(seedId) {
  const result = await query(
    `
      SELECT *
      FROM discovery_seeds
      WHERE id = $1
    `,
    [seedId]
  );
  const seed = result.rows[0];

  if (!seed) {
    throw new Error("seed not found");
  }

  await query(
    `
      UPDATE discovery_seeds
      SET
        last_run_at = NOW(),
        last_status = 'running',
        last_error = NULL,
        updated_at = NOW()
      WHERE id = $1
    `,
    [seedId]
  );

  try {
    if (!["profile", "hashtag"].includes(seed.seed_type)) {
      await query(
        `
          UPDATE discovery_seeds
          SET
            last_status = 'partial',
            last_result_count = 0,
            last_error = 'Only profile and hashtag seeds are active in this beta',
            updated_at = NOW()
          WHERE id = $1
        `,
        [seedId]
      );

      return {
        seed,
        supported: false,
        message: "Only profile and hashtag seeds are active in this beta"
      };
    }

    const trackResult = await trackProfile(seed.query, {
      runType: "seed",
      sourceType: seed.seed_type
    });

    await query(
      `
        UPDATE discovery_seeds
        SET
          last_status = 'success',
          last_result_count = $2,
          last_error = NULL,
          updated_at = NOW()
        WHERE id = $1
      `,
      [seedId, trackResult.scrape.detectedCount]
    );

    return {
      seed,
      supported: true,
      result: trackResult
    };
  } catch (error) {
    await query(
      `
        UPDATE discovery_seeds
        SET
          last_status = 'failed',
          last_error = $2,
          updated_at = NOW()
        WHERE id = $1
      `,
      [seedId, error.message]
    ).catch(() => {});
    throw error;
  }
}

module.exports = {
  listDiscoverySeeds,
  createDiscoverySeed,
  runDiscoverySeed
};
