const express = require("express");
const {
  startTrackingJob,
  getTrackingStatus,
  listTrackedProfiles,
  getProfileByUsername,
  listMediaByUsername
} = require("../services/profileService");
const { searchProfiles: searchTikTokProfiles } = require("../services/tiktokScraper");
const {
  listDiscoverySeeds,
  createDiscoverySeed,
  runDiscoverySeed
} = require("../services/discoveryService");
const {
  listCandidates,
  getDashboardSummary,
  updateCandidateReview
} = require("../services/candidateService");
const {
  listYoutubeAccounts,
  createYoutubeAccount,
  createYoutubeAccountsBulk,
  canUseYoutubeOAuth,
  getYoutubeOauthDiagnostics,
  startYoutubeOAuth,
  startYoutubeDirectOAuth,
  handleYoutubeOAuthCallback,
  listYoutubeChannelVideos,
  updateYoutubeChannelVideo,
  generateYoutubeChannelVideoMetadata
} = require("../services/youtubeService");
const { listProfileClones, createProfileClone } = require("../services/cloneService");
const {
  queuePublications,
  autoDistributeLibraryVideos,
  listPublications,
  updatePublicationMetadata,
  generatePublicationMetadata,
  publishPublication,
  syncPublication
} = require("../services/publicationService");
const {
  streamSingleMedia,
  streamSingleMediaInline,
  streamLibraryVideoInline,
  streamProfileZip,
  streamSelectedMediaZip
} = require("../services/downloadService");
const {
  importLibraryZip,
  importLibraryVideo,
  captureTrackedMediaToLibrary,
  listLibraryVideos
} = require("../services/libraryService");
const { listPublicationJobs, retryPublicationJob } = require("../services/publicationQueueService");
const { listWorkerHeartbeats } = require("../services/workerHeartbeatService");

const router = express.Router();

router.use((req, res, next) => {
  if (req.app.locals.databaseReady) {
    return next();
  }

  if (req.path === "/health") {
    return next();
  }

  return res.status(503).json({
    error: "database is not configured",
    missingVariable: "DATABASE_URL"
  });
});

router.get("/health", (req, res) => {
  res.json({
    ok: true,
    databaseReady: Boolean(req.app.locals.databaseReady),
    youtubeOauthReady: canUseYoutubeOAuth(),
    youtubeOauth: getYoutubeOauthDiagnostics()
  });
});

router.get("/dashboard/summary", async (req, res, next) => {
  try {
    const summary = await getDashboardSummary();
    res.json({ summary });
  } catch (error) {
    next(error);
  }
});

router.get("/scraped-profiles", async (req, res, next) => {
  try {
    const items = await listTrackedProfiles({ limit: req.query.limit });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.get("/scraped-profiles/:username", async (req, res, next) => {
  try {
    const profile = await getProfileByUsername(req.params.username);
    if (!profile) {
      return res.status(404).json({ error: "profile not found" });
    }

    const tracking = await getTrackingStatus(req.params.username, req.query.limit);
    res.json(tracking);
  } catch (error) {
    next(error);
  }
});

router.get("/scraped-profiles/:username/videos", async (req, res, next) => {
  try {
    const items = await listMediaByUsername(req.params.username, {
      limit: req.query.limit
    });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.get("/tiktok/search/profiles", async (req, res, next) => {
  try {
    const query = String(req.query.q || "").trim();
    if (!query) {
      return res.status(400).json({ error: "q is required" });
    }

    const result = await searchTikTokProfiles(query, {
      limit: req.query.limit
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/jobs/publications", async (req, res, next) => {
  try {
    const jobs = await listPublicationJobs(req.query.limit);
    res.json(jobs);
  } catch (error) {
    next(error);
  }
});

router.post("/jobs/publications/:id/retry", async (req, res, next) => {
  try {
    const job = await retryPublicationJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "job not found" });
    }

    res.json({ job });
  } catch (error) {
    next(error);
  }
});

router.get("/workers", async (req, res, next) => {
  try {
    const workers = await listWorkerHeartbeats();
    res.json(workers);
  } catch (error) {
    next(error);
  }
});

router.post("/profiles/track", async (req, res, next) => {
  try {
    const username = String(req.body?.username || "").trim();
    const limit = Number(req.body?.limit || 20);

    if (!username) {
      return res.status(400).json({ error: "username is required" });
    }

    const result = await startTrackingJob(username, { limit });
    res.status(result.started ? 202 : 200).json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/profiles/:username/tracking-status", async (req, res, next) => {
  try {
    const payload = await getTrackingStatus(req.params.username, req.query.limit);
    if (!payload.profile && !payload.scrape) {
      return res.status(404).json({ error: "tracking status not found" });
    }

    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get("/discovery/seeds", async (req, res, next) => {
  try {
    const seeds = await listDiscoverySeeds();
    res.json({ seeds });
  } catch (error) {
    next(error);
  }
});

router.post("/discovery/seeds", async (req, res, next) => {
  try {
    const seed = await createDiscoverySeed(req.body);
    res.status(201).json({ seed });
  } catch (error) {
    next(error);
  }
});

router.post("/discovery/seeds/:id/run", async (req, res, next) => {
  try {
    const result = await runDiscoverySeed(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/candidates", async (req, res, next) => {
  try {
    const items = await listCandidates({
      reviewStatus: req.query.reviewStatus,
      editorialCategory: req.query.editorialCategory,
      profileUsername: req.query.profileUsername,
      candidatesOnly: req.query.candidatesOnly !== "false",
      limit: req.query.limit
    });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.patch("/candidates/:id/review", async (req, res, next) => {
  try {
    const item = await updateCandidateReview(req.params.id, req.body);
    if (!item) {
      return res.status(404).json({ error: "candidate not found" });
    }

    res.json({ item });
  } catch (error) {
    next(error);
  }
});

router.get("/youtube/accounts", async (req, res, next) => {
  try {
    const accounts = await listYoutubeAccounts();
    res.json({
      accounts,
      oauth: getYoutubeOauthDiagnostics()
    });
  } catch (error) {
    next(error);
  }
});

router.get("/youtube/oauth/start", async (req, res, next) => {
  try {
    const connectUrl = await startYoutubeDirectOAuth();
    res.redirect(connectUrl);
  } catch (error) {
    next(error);
  }
});

router.get("/library/videos", async (req, res, next) => {
  try {
    const items = await listLibraryVideos();
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.post("/library/import-zip", async (req, res, next) => {
  try {
    const result = await importLibraryZip(req.body);
    let queuedItems = [];

    if (req.body?.youtubeAccountId) {
      queuedItems = await queuePublications({
        libraryVideoIds: result.items.map((item) => item.id),
        youtubeAccountId: req.body.youtubeAccountId,
        title: req.body.title,
        description: req.body.description,
        tags: req.body.tags,
        privacyStatus: req.body.privacyStatus,
        startAt: req.body.startAt,
        scheduleDaily: req.body.scheduleDaily !== false,
        intervalDays: req.body.intervalDays || 1
      });
    }

    res.status(201).json({
      result,
      queuedItems
    });
  } catch (error) {
    next(error);
  }
});

router.post("/library/videos", async (req, res, next) => {
  try {
    const item = await importLibraryVideo(req.body);
    let queuedItems = [];

    if (req.body?.youtubeAccountId) {
      queuedItems = await queuePublications({
        libraryVideoIds: [item.id],
        youtubeAccountId: req.body.youtubeAccountId,
        title: req.body.title,
        description: req.body.description,
        tags: req.body.tags,
        privacyStatus: req.body.privacyStatus,
        startAt: req.body.startAt,
        scheduleDaily: req.body.scheduleDaily !== false,
        intervalDays: req.body.intervalDays || 1
      });
    }

    res.status(201).json({
      item,
      queuedItems
    });
  } catch (error) {
    next(error);
  }
});

router.post("/library/capture-media", async (req, res, next) => {
  try {
    const result = await captureTrackedMediaToLibrary(req.body);
    let queuedItems = [];

    if (req.body?.youtubeAccountId) {
      queuedItems = await queuePublications({
        libraryVideoIds: result.items.map((item) => item.id),
        youtubeAccountId: req.body.youtubeAccountId,
        title: req.body.title,
        description: req.body.description,
        tags: req.body.tags,
        privacyStatus: req.body.privacyStatus,
        startAt: req.body.startAt,
        scheduleDaily: req.body.scheduleDaily !== false,
        intervalDays: req.body.intervalDays || 1
      });
    }

    res.status(201).json({
      result,
      queuedItems
    });
  } catch (error) {
    next(error);
  }
});

router.post("/youtube/accounts", async (req, res, next) => {
  try {
    const account = await createYoutubeAccount(req.body);
    res.status(201).json({
      account,
      oauth: getYoutubeOauthDiagnostics()
    });
  } catch (error) {
    next(error);
  }
});

router.post("/youtube/accounts/bulk", async (req, res, next) => {
  try {
    const accounts = await createYoutubeAccountsBulk(req.body);
    res.status(201).json({
      accounts,
      oauth: getYoutubeOauthDiagnostics()
    });
  } catch (error) {
    next(error);
  }
});

router.get("/youtube/accounts/:id/connect", async (req, res, next) => {
  try {
    const connectUrl = await startYoutubeOAuth(req.params.id);
    res.redirect(connectUrl);
  } catch (error) {
    next(error);
  }
});

router.get("/youtube/accounts/:id/videos", async (req, res, next) => {
  try {
    const result = await listYoutubeChannelVideos(req.params.id, {
      limit: req.query.limit
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch("/youtube/accounts/:id/videos/:videoId", async (req, res, next) => {
  try {
    const item = await updateYoutubeChannelVideo(req.params.id, req.params.videoId, req.body);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

router.post("/youtube/accounts/:id/videos/:videoId/generate-metadata", async (req, res, next) => {
  try {
    const result = await generateYoutubeChannelVideoMetadata(req.params.id, req.params.videoId, req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/youtube/accounts/:id/clones", async (req, res, next) => {
  try {
    const items = await listProfileClones(req.params.id);
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.post("/youtube/accounts/:id/clones", async (req, res, next) => {
  try {
    const result = await createProfileClone(req.params.id, req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/youtube/oauth/callback", async (req, res, next) => {
  try {
    const account = await handleYoutubeOAuthCallback(req.query);
    const redirectTarget = new URL("/", req.app.locals.appBaseUrl || "http://localhost:3000");
    redirectTarget.searchParams.set("youtube_oauth", "success");
    redirectTarget.searchParams.set("account_id", String(account.id));
    res.redirect(redirectTarget.toString());
  } catch (error) {
    const redirectTarget = new URL("/", req.app.locals.appBaseUrl || "http://localhost:3000");
    redirectTarget.searchParams.set("youtube_oauth", "error");
    redirectTarget.searchParams.set("message", error.message);
    res.redirect(redirectTarget.toString());
  }
});

router.get("/publications", async (req, res, next) => {
  try {
    const items = await listPublications();
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.post("/publications", async (req, res, next) => {
  try {
    const items = await queuePublications(req.body);
    res.status(201).json({ items });
  } catch (error) {
    next(error);
  }
});

router.patch("/publications/:id", async (req, res, next) => {
  try {
    const item = await updatePublicationMetadata(req.params.id, req.body);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

router.post("/publications/:id/generate-metadata", async (req, res, next) => {
  try {
    const result = await generatePublicationMetadata(req.params.id, req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/publications/auto-distribute", async (req, res, next) => {
  try {
    const items = await autoDistributeLibraryVideos(req.body);
    res.status(201).json({ items });
  } catch (error) {
    next(error);
  }
});

router.post("/publications/:id/publish", async (req, res, next) => {
  try {
    const item = await publishPublication(req.params.id);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

router.post("/publications/:id/sync", async (req, res, next) => {
  try {
    const item = await syncPublication(req.params.id);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

router.get("/profiles/:username", async (req, res, next) => {
  try {
    const profile = await getProfileByUsername(req.params.username);

    if (!profile) {
      return res.status(404).json({ error: "profile not found" });
    }

    res.json({ profile });
  } catch (error) {
    next(error);
  }
});

router.get("/profiles/:username/media", async (req, res, next) => {
  try {
    const items = await listMediaByUsername(req.params.username, {
      limit: req.query.limit
    });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.get("/media/:id/download", async (req, res, next) => {
  try {
    await streamSingleMedia(req.params.id, res);
  } catch (error) {
    next(error);
  }
});

router.get("/media/:id/stream", async (req, res, next) => {
  try {
    await streamSingleMediaInline(req.params.id, res);
  } catch (error) {
    next(error);
  }
});

router.get("/library/videos/:id/stream", async (req, res, next) => {
  try {
    await streamLibraryVideoInline(req.params.id, res);
  } catch (error) {
    next(error);
  }
});

router.get("/profiles/:username/download.zip", async (req, res, next) => {
  try {
    await streamProfileZip(req.params.username, res);
  } catch (error) {
    next(error);
  }
});

router.post("/media/download-selected.zip", async (req, res, next) => {
  try {
    await streamSelectedMediaZip(req.body?.ids, res);
  } catch (error) {
    next(error);
  }
});

module.exports = {
  apiRouter: router
};
