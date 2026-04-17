const crypto = require("crypto");
const { query, withClient } = require("../db");
const { env } = require("../config/env");

function buildWorkerId() {
  return `publication-worker-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
}

async function reconcilePublicationJobs() {
  const staleMinutes = 15;

  const staleRunningJobs = await query(
    `
      UPDATE publication_jobs
      SET
        status = 'queued',
        available_at = NOW(),
        locked_at = NULL,
        locked_by = NULL,
        last_error = COALESCE(last_error, 'Recovered stale running job'),
        updated_at = NOW()
      WHERE job_type = 'publish'
        AND status = 'running'
        AND locked_at < NOW() - ($1::text || ' minutes')::interval
      RETURNING id, publication_id
    `,
    [staleMinutes]
  );

  if (staleRunningJobs.rows.length) {
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
        WHERE id = ANY($1::bigint[])
          AND status = 'publishing'
      `,
      [staleRunningJobs.rows.map((job) => job.publication_id)]
    );
  }

  const failedPublishing = await query(
    `
      UPDATE publications p
      SET
        status = 'failed',
        status_detail = COALESCE(pj.last_error, p.status_detail, 'Publication job failed'),
        updated_at = NOW()
      FROM publication_jobs pj
      WHERE pj.publication_id = p.id
        AND pj.job_type = 'publish'
        AND pj.status = 'failed'
        AND p.status = 'publishing'
      RETURNING p.id
    `
  );

  return {
    staleRunningJobs: staleRunningJobs.rows.length,
    failedPublishing: failedPublishing.rows.length
  };
}

function resolveJobAvailability(publication) {
  if (publication?.scheduled_for) {
    const when = new Date(publication.scheduled_for);
    if (!Number.isNaN(when.getTime())) {
      return when.toISOString();
    }
  }

  return new Date().toISOString();
}

async function enqueuePublicationJob(publication, options = {}) {
  if (!publication?.id) {
    throw new Error("publication is required");
  }

  const availableAt = options.availableAt || resolveJobAvailability(publication);
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 5));

  const result = await query(
    `
      INSERT INTO publication_jobs (
        publication_id,
        job_type,
        status,
        available_at,
        max_attempts,
        last_error,
        finished_at,
        updated_at
      )
      VALUES ($1, 'publish', 'queued', $2, $3, NULL, NULL, NOW())
      ON CONFLICT (publication_id, job_type)
      DO UPDATE SET
        status = 'queued',
        available_at = EXCLUDED.available_at,
        max_attempts = EXCLUDED.max_attempts,
        last_error = NULL,
        finished_at = NULL,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = NOW()
      RETURNING *
    `,
    [publication.id, availableAt, maxAttempts]
  );

  return result.rows[0];
}

async function claimNextPublicationJob(workerId) {
  return withClient(async (client) => {
    await client.query("BEGIN");

    try {
      const selection = await client.query(
        `
          SELECT pj.*
          FROM publication_jobs pj
          JOIN publications p ON p.id = pj.publication_id
          WHERE pj.job_type = 'publish'
            AND pj.status = 'queued'
            AND pj.available_at <= NOW()
            AND (
              SELECT COUNT(*)
              FROM publication_jobs running_jobs
              JOIN publications running_publications ON running_publications.id = running_jobs.publication_id
              WHERE running_jobs.status = 'running'
                AND running_publications.youtube_account_id = p.youtube_account_id
            ) < $1
          ORDER BY pj.available_at ASC, pj.created_at ASC, pj.id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `,
        [Math.max(1, env.publicationWorkerPerAccountLimit || 1)]
      );

      const job = selection.rows[0];
      if (!job) {
        await client.query("COMMIT");
        return null;
      }

      const claimed = await client.query(
        `
          UPDATE publication_jobs
          SET
            status = 'running',
            locked_at = NOW(),
            locked_by = $2,
            attempts = attempts + 1,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [job.id, workerId]
      );

      await client.query("COMMIT");
      return claimed.rows[0] || null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function markPublicationJobCompleted(jobId) {
  await query(
    `
      UPDATE publication_jobs
      SET
        status = 'completed',
        finished_at = NOW(),
        locked_at = NULL,
        locked_by = NULL,
        last_error = NULL,
        updated_at = NOW()
      WHERE id = $1
    `,
    [jobId]
  );
}

async function markPublicationJobFailed(job, error) {
  const attempts = Number(job.attempts || 1);
  const maxAttempts = Number(job.max_attempts || 5);
  const shouldRetry = attempts < maxAttempts;
  const retryDelayMinutes = Math.min(30, Math.max(2, attempts * 2));

  await query(
    `
      UPDATE publication_jobs
      SET
        status = $2,
        available_at = CASE WHEN $2 = 'queued' THEN NOW() + ($4::text || ' minutes')::interval ELSE available_at END,
        locked_at = NULL,
        locked_by = NULL,
        last_error = $3,
        finished_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE NULL END,
        updated_at = NOW()
      WHERE id = $1
    `,
    [job.id, shouldRetry ? "queued" : "failed", error.message, retryDelayMinutes]
  );
}

async function backfillPublicationJobs() {
  await reconcilePublicationJobs();

  const result = await query(
    `
      SELECT p.*
      FROM publications p
      LEFT JOIN publication_jobs pj
        ON pj.publication_id = p.id
       AND pj.job_type = 'publish'
      WHERE pj.id IS NULL
        AND p.status IN ('scheduled', 'ready')
    `
  );

  for (const publication of result.rows) {
    await enqueuePublicationJob(publication);
  }

  return result.rows.length;
}

async function listPublicationJobs(limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit || 50), 1), 200);
  const jobsResult = await query(
    `
      SELECT
        pj.*,
        p.youtube_account_id,
        p.title AS publication_title,
        p.status AS publication_status,
        p.scheduled_for,
        ya.channel_title
      FROM publication_jobs pj
      JOIN publications p ON p.id = pj.publication_id
      JOIN youtube_accounts ya ON ya.id = p.youtube_account_id
      ORDER BY pj.created_at DESC, pj.id DESC
      LIMIT $1
    `,
    [safeLimit]
  );

  const summaryResult = await query(
    `
      SELECT status, COUNT(*)::int AS count
      FROM publication_jobs
      GROUP BY status
      ORDER BY status
    `
  );

  return {
    items: jobsResult.rows,
    summary: summaryResult.rows
  };
}

async function retryPublicationJob(jobId) {
  const result = await query(
    `
      SELECT
        pj.*,
        p.scheduled_for,
        p.youtube_account_id
      FROM publication_jobs pj
      JOIN publications p ON p.id = pj.publication_id
      WHERE pj.id = $1
    `,
    [jobId]
  );

  const job = result.rows[0];
  if (!job) {
    return null;
  }

  if (job.status === "running") {
    throw new Error("Cannot retry a running job");
  }

  const scheduledFor = job.scheduled_for ? new Date(job.scheduled_for) : null;
  const publicationStatus =
    scheduledFor && !Number.isNaN(scheduledFor.getTime()) && scheduledFor.getTime() > Date.now()
      ? "scheduled"
      : "ready";
  const publicationDetail =
    publicationStatus === "scheduled"
      ? `Scheduled for ${scheduledFor.toLocaleString()}`
      : "Ready to upload through the YouTube API";

  await query(
    `
      UPDATE publications
      SET
        status = $2,
        status_detail = $3,
        updated_at = NOW()
      WHERE id = $1
    `,
    [job.publication_id, publicationStatus, publicationDetail]
  );

  const updatedResult = await query(
    `
      UPDATE publication_jobs
      SET
        status = 'queued',
        available_at = NOW(),
        locked_at = NULL,
        locked_by = NULL,
        last_error = NULL,
        finished_at = NULL,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [jobId]
  );

  return updatedResult.rows[0] || null;
}

async function processPublicationJob(job) {
  const { publishPublication } = require("./publicationService");
  await publishPublication(job.publication_id);
}

async function processPublicationQueue(workerId, limit = 3) {
  const processed = [];

  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextPublicationJob(workerId);
    if (!job) {
      break;
    }

    try {
      await processPublicationJob(job);
      await markPublicationJobCompleted(job.id);
      processed.push({ jobId: job.id, publicationId: job.publication_id, status: "completed" });
    } catch (error) {
      await markPublicationJobFailed(job, error);
      processed.push({ jobId: job.id, publicationId: job.publication_id, status: "failed", error: error.message });
    }
  }

  return processed;
}

module.exports = {
  buildWorkerId,
  enqueuePublicationJob,
  reconcilePublicationJobs,
  backfillPublicationJobs,
  processPublicationQueue,
  listPublicationJobs,
  retryPublicationJob
};
