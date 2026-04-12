const dotenv = require("dotenv");

dotenv.config();

function getDefaultYtDlpPath() {
  return process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
}

function cleanEnvValue(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  const quotedWithDouble = trimmed.startsWith("\"") && trimmed.endsWith("\"");
  const quotedWithSingle = trimmed.startsWith("'") && trimmed.endsWith("'");

  if (quotedWithDouble || quotedWithSingle) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function readEnv(name, fallback = "") {
  const value = cleanEnvValue(process.env[name]);
  return value === undefined || value === "" ? fallback : value;
}

const env = {
  port: Number(readEnv("PORT", "3000")),
  databaseUrl: readEnv("DATABASE_URL", ""),
  nodeEnv: readEnv("NODE_ENV", "development"),
  appBaseUrl: readEnv("APP_BASE_URL", ""),
  scraperUserAgent:
    readEnv("SCRAPER_USER_AGENT", "") ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  scraperHeadless: readEnv("SCRAPER_HEADLESS", "true") !== "false",
  scraperTimeoutMs: Number(readEnv("SCRAPER_TIMEOUT_MS", "45000")),
  browserExecutablePath: readEnv("PLAYWRIGHT_EXECUTABLE_PATH", ""),
  scraperProxyProtocol: readEnv("SCRAPER_PROXY_PROTOCOL", "http"),
  scraperProxyServer: readEnv("SCRAPER_PROXY_SERVER", ""),
  scraperProxyUsername: readEnv("SCRAPER_PROXY_USERNAME", ""),
  scraperProxyPassword: readEnv("SCRAPER_PROXY_PASSWORD", ""),
  scraperProxyFile: readEnv("SCRAPER_PROXY_FILE", ""),
  scraperProxyIndex: Number(readEnv("SCRAPER_PROXY_INDEX", "0")),
  scraperSessionDir: readEnv("SCRAPER_SESSION_DIR", ".playwright-tiktok-session"),
  scraperBrowserChannel: readEnv("SCRAPER_BROWSER_CHANNEL", ""),
  scraperLocale: readEnv("SCRAPER_LOCALE", "en-US"),
  scraperTimezoneId: readEnv("SCRAPER_TIMEZONE_ID", "UTC"),
  scraperLoginUseProxy: readEnv("SCRAPER_LOGIN_USE_PROXY", "false") === "true",
  ytDlpPath: readEnv("YT_DLP_PATH", getDefaultYtDlpPath()),
  ytDlpProfileLimit: Number(readEnv("YT_DLP_PROFILE_LIMIT", "120")),
  googleClientId: readEnv("GOOGLE_CLIENT_ID", ""),
  googleClientSecret: readEnv("GOOGLE_CLIENT_SECRET", ""),
  googleRedirectUri: readEnv("GOOGLE_REDIRECT_URI", ""),
  youtubeDefaultPrivacyStatus: readEnv("YOUTUBE_DEFAULT_PRIVACY_STATUS", "private"),
  libraryStorageMode: readEnv("LIBRARY_STORAGE_MODE", "local"),
  libraryCloudProvider: readEnv("LIBRARY_CLOUD_PROVIDER", "s3-compatible"),
  libraryCloudPublicBaseUrl: readEnv("LIBRARY_CLOUD_PUBLIC_BASE_URL", ""),
  libraryCloudBucket: readEnv("LIBRARY_CLOUD_BUCKET", ""),
  libraryCloudRegion: readEnv("LIBRARY_CLOUD_REGION", "auto"),
  libraryCloudEndpoint: readEnv("LIBRARY_CLOUD_ENDPOINT", ""),
  libraryCloudAccessKeyId: readEnv("LIBRARY_CLOUD_ACCESS_KEY_ID", ""),
  libraryCloudSecretAccessKey: readEnv("LIBRARY_CLOUD_SECRET_ACCESS_KEY", ""),
  libraryCloudForcePathStyle: readEnv("LIBRARY_CLOUD_FORCE_PATH_STYLE", "false") === "true",
  libraryKeepLocalCopy: readEnv("LIBRARY_KEEP_LOCAL_COPY", "true") !== "false",
  publicationWorkerBatchSize: Number(readEnv("PUBLICATION_WORKER_BATCH_SIZE", "5")),
  publicationWorkerPerAccountLimit: Number(readEnv("PUBLICATION_WORKER_PER_ACCOUNT_LIMIT", "1")),
  discoveryWorkerSeedLimit: Number(readEnv("DISCOVERY_WORKER_SEED_LIMIT", "5")),
  discoveryWorkerIntervalMinutes: Number(readEnv("DISCOVERY_WORKER_INTERVAL_MINUTES", "30"))
};

function hasDatabaseUrl() {
  return Boolean(String(env.databaseUrl || "").trim());
}

module.exports = {
  env,
  hasDatabaseUrl
};
