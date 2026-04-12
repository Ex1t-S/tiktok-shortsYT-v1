const { query } = require("../db");

const STALE_AFTER_SECONDS = 90;

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return metadata;
}

async function upsertWorkerHeartbeat({ workerId, workerType, status = "running", pid = process.pid, metadata = {} }) {
  if (!workerId) {
    throw new Error("workerId is required");
  }

  if (!workerType) {
    throw new Error("workerType is required");
  }

  const result = await query(
    `
      INSERT INTO worker_heartbeats (
        worker_id,
        worker_type,
        status,
        pid,
        metadata,
        started_at,
        last_heartbeat_at,
        stopped_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW(), NULL, NOW())
      ON CONFLICT (worker_id)
      DO UPDATE SET
        worker_type = EXCLUDED.worker_type,
        status = EXCLUDED.status,
        pid = EXCLUDED.pid,
        metadata = EXCLUDED.metadata,
        last_heartbeat_at = NOW(),
        stopped_at = NULL,
        updated_at = NOW()
      RETURNING *
    `,
    [workerId, workerType, status, Number(pid) || null, JSON.stringify(normalizeMetadata(metadata))]
  );

  return result.rows[0];
}

async function markWorkerStopped(workerId, metadata = {}) {
  if (!workerId) {
    return null;
  }

  const result = await query(
    `
      UPDATE worker_heartbeats
      SET
        status = 'stopped',
        metadata = $2::jsonb,
        stopped_at = NOW(),
        updated_at = NOW()
      WHERE worker_id = $1
      RETURNING *
    `,
    [workerId, JSON.stringify(normalizeMetadata(metadata))]
  );

  return result.rows[0] || null;
}

async function listWorkerHeartbeats() {
  const itemsResult = await query(
    `
      SELECT
        worker_id,
        worker_type,
        status,
        pid,
        metadata,
        started_at,
        last_heartbeat_at,
        stopped_at,
        updated_at,
        CASE
          WHEN status = 'stopped' THEN 'offline'
          WHEN last_heartbeat_at >= NOW() - ($1::text || ' seconds')::interval THEN 'online'
          ELSE 'stale'
        END AS health
      FROM worker_heartbeats
      ORDER BY worker_type ASC, last_heartbeat_at DESC, worker_id ASC
    `,
    [STALE_AFTER_SECONDS]
  );

  const summaryResult = await query(
    `
      SELECT
        worker_type,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status <> 'stopped' AND last_heartbeat_at >= NOW() - ($1::text || ' seconds')::interval)::int AS online,
        COUNT(*) FILTER (WHERE status = 'stopped')::int AS offline,
        COUNT(*) FILTER (WHERE status <> 'stopped' AND last_heartbeat_at < NOW() - ($1::text || ' seconds')::interval)::int AS stale
      FROM worker_heartbeats
      GROUP BY worker_type
      ORDER BY worker_type ASC
    `,
    [STALE_AFTER_SECONDS]
  );

  return {
    items: itemsResult.rows,
    summary: summaryResult.rows,
    staleAfterSeconds: STALE_AFTER_SECONDS
  };
}

module.exports = {
  upsertWorkerHeartbeat,
  markWorkerStopped,
  listWorkerHeartbeats
};
