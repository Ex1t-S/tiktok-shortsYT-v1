const { env, hasDatabaseUrl } = require("../config/env");
const { ensureSchema } = require("../db/schema");
const { listDiscoverySeeds, runDiscoverySeed } = require("../services/discoveryService");
const { upsertWorkerHeartbeat, markWorkerStopped } = require("../services/workerHeartbeatService");

let timer = null;
let running = false;
const workerId = `discovery-worker-${process.pid}`;

function shouldRunSeed(seed) {
  if (!seed?.is_active) {
    return false;
  }

  if (!seed.last_run_at) {
    return true;
  }

  const lastRun = new Date(seed.last_run_at).getTime();
  const intervalMs = Math.max(1, env.discoveryWorkerIntervalMinutes || 30) * 60 * 1000;
  return Date.now() - lastRun >= intervalMs;
}

async function tickDiscoveryWorker() {
  if (running) {
    return;
  }

  running = true;
  try {
    await upsertWorkerHeartbeat({
      workerId,
      workerType: "discovery",
      status: "running",
      metadata: {
        intervalMinutes: env.discoveryWorkerIntervalMinutes,
        seedLimit: env.discoveryWorkerSeedLimit
      }
    });

    const seeds = await listDiscoverySeeds();
    const selected = seeds.filter(shouldRunSeed).slice(0, Math.max(1, env.discoveryWorkerSeedLimit || 5));

    for (const seed of selected) {
      try {
        await runDiscoverySeed(seed.id);
        console.log(`[discovery-worker] seed ${seed.id} processed`);
      } catch (error) {
        console.error(`[discovery-worker] seed ${seed.id} failed`, error.message);
      }
    }
  } catch (error) {
    await upsertWorkerHeartbeat({
      workerId,
      workerType: "discovery",
      status: "error",
      metadata: {
        error: error.message,
        intervalMinutes: env.discoveryWorkerIntervalMinutes,
        seedLimit: env.discoveryWorkerSeedLimit
      }
    }).catch(() => {});
    console.error("[discovery-worker] tick failed", error);
  } finally {
    running = false;
  }
}

async function startDiscoveryWorker() {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL is required to start the discovery worker");
  }

  await ensureSchema();
  await upsertWorkerHeartbeat({
    workerId,
    workerType: "discovery",
    status: "starting",
    metadata: {
      intervalMinutes: env.discoveryWorkerIntervalMinutes,
      seedLimit: env.discoveryWorkerSeedLimit
    }
  });
  console.log("[discovery-worker] started");

  timer = setInterval(() => {
    void tickDiscoveryWorker();
  }, Math.max(1, env.discoveryWorkerIntervalMinutes || 30) * 60 * 1000);

  await tickDiscoveryWorker();
}

async function stopDiscoveryWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  await markWorkerStopped(workerId, {
    intervalMinutes: env.discoveryWorkerIntervalMinutes,
    seedLimit: env.discoveryWorkerSeedLimit
  }).catch(() => {});
}

if (require.main === module) {
  startDiscoveryWorker().catch((error) => {
    console.error("Failed to start discovery worker", error);
    process.exit(1);
  });

  const shutdown = async () => {
    await stopDiscoveryWorker();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = {
  startDiscoveryWorker,
  stopDiscoveryWorker
};
