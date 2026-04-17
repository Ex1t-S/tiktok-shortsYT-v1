const { query } = require("./index");

async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS tracked_profiles (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      avatar_url TEXT,
      profile_url TEXT NOT NULL,
      total_media_count INTEGER NOT NULL DEFAULT 0,
      video_count INTEGER NOT NULL DEFAULT 0,
      image_count INTEGER NOT NULL DEFAULT 0,
      last_scraped_at TIMESTAMPTZ,
      last_scrape_status TEXT NOT NULL DEFAULT 'idle',
      last_scrape_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS scrape_runs (
      id BIGSERIAL PRIMARY KEY,
      tracked_profile_id BIGINT NOT NULL REFERENCES tracked_profiles(id) ON DELETE CASCADE,
      run_type TEXT NOT NULL DEFAULT 'manual',
      source_type TEXT NOT NULL DEFAULT 'profile',
      query TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      progress_phase TEXT NOT NULL DEFAULT 'queued',
      progress_message TEXT,
      expected_count INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      saved_count INTEGER NOT NULL DEFAULT 0,
      detected_count INTEGER NOT NULL DEFAULT 0,
      new_items_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    );
  `);

  await query(`
    ALTER TABLE scrape_runs
    ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'profile';
  `);

  await query(`
    ALTER TABLE scrape_runs
    ADD COLUMN IF NOT EXISTS query TEXT;
  `);

  await query(`
    ALTER TABLE scrape_runs
    ADD COLUMN IF NOT EXISTS progress_phase TEXT NOT NULL DEFAULT 'queued';
  `);

  await query(`
    ALTER TABLE scrape_runs
    ADD COLUMN IF NOT EXISTS progress_message TEXT;
  `);

  await query(`
    ALTER TABLE scrape_runs
    ADD COLUMN IF NOT EXISTS expected_count INTEGER NOT NULL DEFAULT 0;
  `);

  await query(`
    ALTER TABLE scrape_runs
    ADD COLUMN IF NOT EXISTS processed_count INTEGER NOT NULL DEFAULT 0;
  `);

  await query(`
    ALTER TABLE scrape_runs
    ADD COLUMN IF NOT EXISTS saved_count INTEGER NOT NULL DEFAULT 0;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS media_items (
      id BIGSERIAL PRIMARY KEY,
      tracked_profile_id BIGINT NOT NULL REFERENCES tracked_profiles(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      post_url TEXT NOT NULL,
      media_url TEXT,
      thumbnail_url TEXT,
      media_type TEXT NOT NULL,
      caption TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      view_count BIGINT NOT NULL DEFAULT 0,
      like_count BIGINT NOT NULL DEFAULT 0,
      comment_count BIGINT NOT NULL DEFAULT 0,
      repost_count BIGINT NOT NULL DEFAULT 0,
      save_count BIGINT NOT NULL DEFAULT 0,
      source_type TEXT NOT NULL DEFAULT 'profile',
      discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      score NUMERIC(12, 2) NOT NULL DEFAULT 0,
      score_reason TEXT,
      is_candidate BOOLEAN NOT NULL DEFAULT FALSE,
      review_status TEXT NOT NULL DEFAULT 'pending',
      editorial_category TEXT,
      risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      publication_status TEXT NOT NULL DEFAULT 'idle',
      published_at TIMESTAMPTZ,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tracked_profile_id, external_id)
    );
  `);

  await query(`
    ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 0;
  `);

  await query(`
    ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS view_count BIGINT NOT NULL DEFAULT 0;
  `);

  await query(`
    ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS like_count BIGINT NOT NULL DEFAULT 0;
  `);

  await query(`
    ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS comment_count BIGINT NOT NULL DEFAULT 0;
  `);

  await query(`
    ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS repost_count BIGINT NOT NULL DEFAULT 0;
  `);

  await query(`
    ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS save_count BIGINT NOT NULL DEFAULT 0;
  `);

  await query(`
    ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'profile';
  `);

  await query(`
    ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);

  await query(`
    ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS score NUMERIC(12, 2) NOT NULL DEFAULT 0;
  `);

  await query(`
    ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS score_reason TEXT;
  `);

  await query(`
    ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS is_candidate BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await query(`
    ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending';
  `);

  await query(`
    ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS editorial_category TEXT;
  `);

  await query(`
    ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);

  await query(`
    ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS publication_status TEXT NOT NULL DEFAULT 'idle';
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS discovery_seeds (
      id BIGSERIAL PRIMARY KEY,
      seed_type TEXT NOT NULL,
      query TEXT NOT NULL,
      label TEXT,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_run_at TIMESTAMPTZ,
      last_status TEXT NOT NULL DEFAULT 'idle',
      last_result_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(seed_type, query)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS youtube_accounts (
      id BIGSERIAL PRIMARY KEY,
      channel_id TEXT,
      channel_title TEXT NOT NULL,
      channel_handle TEXT,
      contact_email TEXT,
      oauth_status TEXT NOT NULL DEFAULT 'manual',
      access_token TEXT,
      refresh_token TEXT,
      token_scope TEXT,
      token_expiry TIMESTAMPTZ,
      last_sync_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS library_videos (
      id BIGSERIAL PRIMARY KEY,
      import_batch_id TEXT NOT NULL,
      source_archive_path TEXT NOT NULL,
      source_label TEXT,
      original_filename TEXT NOT NULL,
      stored_path TEXT NOT NULL UNIQUE,
      source_kind TEXT NOT NULL DEFAULT 'zip_import',
      storage_provider TEXT NOT NULL DEFAULT 'local',
      source_url TEXT,
      storage_bucket TEXT,
      storage_object_key TEXT,
      thumbnail_url TEXT,
      title TEXT,
      description TEXT,
      mime_type TEXT,
      file_size_bytes BIGINT NOT NULL DEFAULT 0,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    ALTER TABLE library_videos
    ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'zip_import';
  `);

  await query(`
    ALTER TABLE library_videos
    ADD COLUMN IF NOT EXISTS storage_provider TEXT NOT NULL DEFAULT 'local';
  `);

  await query(`
    ALTER TABLE library_videos
    ADD COLUMN IF NOT EXISTS source_url TEXT;
  `);

  await query(`
    ALTER TABLE library_videos
    ADD COLUMN IF NOT EXISTS storage_bucket TEXT;
  `);

  await query(`
    ALTER TABLE library_videos
    ADD COLUMN IF NOT EXISTS storage_object_key TEXT;
  `);

  await query(`
    ALTER TABLE library_videos
    ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS publications (
      id BIGSERIAL PRIMARY KEY,
      media_item_id BIGINT REFERENCES media_items(id) ON DELETE CASCADE,
      library_video_id BIGINT REFERENCES library_videos(id) ON DELETE CASCADE,
      youtube_account_id BIGINT NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
      source_kind TEXT NOT NULL DEFAULT 'tracked_media',
      title TEXT,
      description TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      privacy_status TEXT NOT NULL DEFAULT 'private',
      status TEXT NOT NULL DEFAULT 'queued',
      status_detail TEXT,
      youtube_video_id TEXT,
      youtube_url TEXT,
      scheduled_for TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS profile_clones (
      id BIGSERIAL PRIMARY KEY,
      youtube_account_id BIGINT NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
      tracked_profile_id BIGINT NOT NULL REFERENCES tracked_profiles(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active',
      daily_limit INTEGER NOT NULL DEFAULT 1,
      total_items_count INTEGER NOT NULL DEFAULT 0,
      queued_items_count INTEGER NOT NULL DEFAULT 0,
      published_items_count INTEGER NOT NULL DEFAULT 0,
      failed_items_count INTEGER NOT NULL DEFAULT 0,
      last_scheduled_for TIMESTAMPTZ,
      last_run_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (youtube_account_id, tracked_profile_id)
    );
  `);

  await query(`
    ALTER TABLE publications
    ALTER COLUMN media_item_id DROP NOT NULL;
  `);

  await query(`
    ALTER TABLE publications
    ADD COLUMN IF NOT EXISTS library_video_id BIGINT REFERENCES library_videos(id) ON DELETE CASCADE;
  `);

  await query(`
    ALTER TABLE publications
    ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'tracked_media';
  `);

  await query(`
    ALTER TABLE publications
    ADD COLUMN IF NOT EXISTS profile_clone_id BIGINT REFERENCES profile_clones(id) ON DELETE SET NULL;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS publication_metrics_snapshots (
      id BIGSERIAL PRIMARY KEY,
      publication_id BIGINT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      view_count BIGINT NOT NULL DEFAULT 0,
      like_count BIGINT NOT NULL DEFAULT 0,
      comment_count BIGINT NOT NULL DEFAULT 0,
      collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS publication_jobs (
      id BIGSERIAL PRIMARY KEY,
      publication_id BIGINT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      job_type TEXT NOT NULL DEFAULT 'publish',
      status TEXT NOT NULL DEFAULT 'queued',
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_at TIMESTAMPTZ,
      locked_by TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      last_error TEXT,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (publication_id, job_type)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS worker_heartbeats (
      worker_id TEXT PRIMARY KEY,
      worker_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'starting',
      pid INTEGER,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      stopped_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS media_items_profile_idx
      ON media_items (tracked_profile_id, created_at DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS media_items_candidates_idx
      ON media_items (is_candidate, review_status, score DESC, published_at DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS publications_status_idx
      ON publications (status, created_at DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS publications_schedule_idx
      ON publications (status, scheduled_for ASC, created_at DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS publication_metrics_publication_idx
      ON publication_metrics_snapshots (publication_id, collected_at DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS publication_jobs_queue_idx
      ON publication_jobs (status, available_at ASC, created_at ASC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS profile_clones_account_idx
      ON profile_clones (youtube_account_id, updated_at DESC, id DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS publications_clone_idx
      ON publications (profile_clone_id, created_at DESC, id DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS library_videos_created_idx
      ON library_videos (created_at DESC, id DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS worker_heartbeats_type_idx
      ON worker_heartbeats (worker_type, last_heartbeat_at DESC);
  `);
}

module.exports = {
  ensureSchema
};
