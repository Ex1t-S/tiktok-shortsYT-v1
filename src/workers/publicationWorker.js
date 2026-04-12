const { env, hasDatabaseUrl } = require("../config/env");
const { ensureSchema } = require("../db/schema");
const { backfillCandidateSignals } = require("../services/candidateService");
const {
  buildWorkerId,
  backfillPublicationJobs,
  processPublicationQueue
} = require("../services/publicationQueueService");
const { upsertWorkerHeartbeat, markWorkerStopped } = require("../services/workerHeartbeatService");

const workerId = buildWorkerId();
const pollIntervalMs = 15 * 1000;
let timer = null;
let running = false;

async function tickWorker() {
  if (running) {
    return;
  }

  running = true;
  try {
    await upsertWorkerHeartbeat({
      workerId,
      workerType: "publication",
      status: "running",
      metadata: {
        batchSize: env.publicationWorkerBatchSize,
        pollIntervalMs
      }
    });

    const processed = await processPublicationQueue(workerId, env.publicationWorkerBatchSize || 5);
    if (processed.length > 0) {
      console.log(`[${workerId}] processed ${processed.length} publication job(s)`);
    }
  } catch (error) {
    await upsertWorkerHeartbeat({
      workerId,
      workerType: "publication",
      status: "error",
      metadata: {
        error: error.message,
        batchSize: env.publicationWorkerBatchSize,
        pollIntervalMs
      }
    }).catch(() => {});
    console.error(`[${workerId}] publication worker tick failed`, error);
  } finally {
    running = false;
  }
}

async function startPublicationWorker() {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL is required to start the publication worker");
  }

  await ensureSchema();
  await backfillCandidateSignals();
  await backfillPublicationJobs();
  await upsertWorkerHeartbeat({
    workerId,
    workerType: "publication",
    status: "starting",
    metadata: {
      batchSize: env.publicationWorkerBatchSize,
      pollIntervalMs
    }
  });

  console.log(`[${workerId}] publication worker started in ${env.nodeEnv} mode`);
  timer = setInterval(() => {
    void tickWorker();
  }, pollIntervalMs);

  await tickWorker();
}

async function stopPublicationWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  await markWorkerStopped(workerId, {
    batchSize: env.publicationWorkerBatchSize,
    pollIntervalMs
  }).catch(() => {});
}

if (require.main === module) {
  startPublicationWorker().catch((error) => {
    console.error("Failed to start publication worker", error);
    process.exit(1);
  });

  const shutdown = async () => {
    await stopPublicationWorker();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = {
  startPublicationWorker,
  stopPublicationWorker
};
