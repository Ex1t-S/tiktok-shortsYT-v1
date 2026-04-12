const path = require("path");
const express = require("express");
const { env, hasDatabaseUrl } = require("./config/env");
const { ensureSchema } = require("./db/schema");
const { apiRouter } = require("./routes/api");
const { backfillCandidateSignals } = require("./services/candidateService");
const { backfillPublicationJobs } = require("./services/publicationQueueService");

async function createApp() {
  const databaseReady = hasDatabaseUrl();

  if (databaseReady) {
    await ensureSchema();
    await backfillCandidateSignals();
    await backfillPublicationJobs();
  } else {
    console.warn("DATABASE_URL is missing. API endpoints that require PostgreSQL will return 503.");
  }

  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.locals.databaseReady = databaseReady;
  app.locals.appBaseUrl = env.appBaseUrl;
  app.use("/api", apiRouter);
  app.use(express.static(path.join(process.cwd(), "public")));

  app.get("*", (req, res) => {
    res.sendFile(path.join(process.cwd(), "public", "index.html"));
  });

  app.use((error, req, res, next) => {
    console.error(error);

    if (res.headersSent) {
      return next(error);
    }

    res.status(Number(error.statusCode) || 500).json({
      error: error.message || "Internal server error",
      code: error.code || "INTERNAL_ERROR"
    });
  });

  return app;
}

module.exports = {
  createApp
};
