const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const { execFile } = require("child_process");
const { env } = require("../config/env");
const { normalizeUsername } = require("./tiktokScraper");

const execFileAsync = promisify(execFile);

function resolveYtDlpPath() {
  const value = String(env.ytDlpPath || "").trim();

  if (!value) {
    return process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  }

  if (path.isAbsolute(value)) {
    return value;
  }

  if (!value.includes("/") && !value.includes("\\")) {
    return value;
  }

  return path.resolve(process.cwd(), value);
}

async function runYtDlp(args, options = {}) {
  const ytDlpPath = resolveYtDlpPath();
  const command = /\.(cmd|bat)$/i.test(ytDlpPath) ? "cmd.exe" : ytDlpPath;
  const commandArgs = /\.(cmd|bat)$/i.test(ytDlpPath) ? ["/c", ytDlpPath, ...args] : args;
  try {
    return await execFileAsync(command, commandArgs, {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 64,
      timeout: options.timeoutMs || 10 * 60 * 1000,
      windowsHide: true
    });
  } catch (error) {
    if (options.acceptPartialOutput && error.stdout) {
      return {
        stdout: error.stdout,
        stderr: error.stderr || ""
      };
    }

    throw error;
  }
}

function createProfileUrl(usernameInput) {
  const username = normalizeUsername(usernameInput);
  return `https://www.tiktok.com/@${username}`;
}

function pickThumbnail(entry) {
  return entry.thumbnail || entry.thumbnails?.[0]?.url || null;
}

function normalizeProfileEntry(entry) {
  const uploader = entry.uploader || "";
  const username = normalizeUsername(uploader || entry.playlist || "");
  const postUrl = entry.webpage_url || entry.original_url || null;
  const watermarkedFormat = Array.isArray(entry.formats)
    ? entry.formats.find((format) => String(format.format_note || "").toLowerCase().includes("watermark"))
    : null;

  return {
    externalId: String(entry.id),
    postUrl,
    mediaType: "video",
    mediaUrl: entry.url || null,
    thumbnailUrl: pickThumbnail(entry),
    caption: entry.description || entry.title || "",
    title: entry.title || "",
    publishedAt: entry.timestamp ? new Date(entry.timestamp * 1000).toISOString() : null,
    durationSeconds: Number(entry.duration || 0),
    viewCount: Number(entry.view_count || 0),
    likeCount: Number(entry.like_count || 0),
    commentCount: Number(entry.comment_count || 0),
    repostCount: Number(entry.repost_count || 0),
    saveCount: Number(entry.save_count || 0),
    uploader: uploader || username,
    riskFlags: [
      ...(watermarkedFormat ? ["watermark_format_available"] : []),
      ...(String(entry.channel_url || "").includes("MS4wLjAB") ? ["channel_id_profile_url"] : [])
    ],
    profile: {
      username,
      displayName: uploader || username,
      avatarUrl: null,
      profileUrl: username ? `https://www.tiktok.com/@${username}` : null
    },
    raw: entry
  };
}

async function listProfileVideos(usernameInput, options = {}) {
  const username = normalizeUsername(usernameInput);
  if (!username) {
    throw new Error("Invalid TikTok username");
  }

  const profileLimit = Math.max(1, Number(options.limit || env.ytDlpProfileLimit || 20));

  const profileUrl = createProfileUrl(username);
  const { stdout } = await runYtDlp([
    "--dump-single-json",
    "--ignore-errors",
    "--no-abort-on-error",
    "--playlist-end",
    String(profileLimit),
    profileUrl
  ], { acceptPartialOutput: true });

  if (!String(stdout || "").trim()) {
    throw new Error("yt-dlp returned an empty response");
  }

  let payload = null;
  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    throw new Error("yt-dlp returned invalid JSON");
  }

  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const normalizedEntries = entries
    .filter((entry) => entry && entry.id && (entry.webpage_url || entry.original_url))
    .map(normalizeProfileEntry);

  const first = normalizedEntries[0] || null;
  return {
    profile: {
      username,
      displayName: first?.profile.displayName || payload.title || username,
      avatarUrl: null,
      profileUrl: profileUrl,
      totalMediaCount: normalizedEntries.length
    },
    mediaItems: normalizedEntries
  };
}

async function downloadPostToFile(postUrl, outputTemplate) {
  await runYtDlp([
    "-o",
    outputTemplate,
    "--no-playlist",
    postUrl
  ]);
}

async function downloadPostToTemp(postUrl) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tiktokscrap-"));
  const outputTemplate = path.join(tempDir, "%(uploader)s-%(id)s.%(ext)s");
  await downloadPostToFile(postUrl, outputTemplate);
  const files = await fs.promises.readdir(tempDir);
  const absoluteFiles = files.map((file) => path.join(tempDir, file));

  if (absoluteFiles.length === 0) {
    throw new Error("yt-dlp did not produce any download file");
  }

  return {
    tempDir,
    filePath: absoluteFiles[0]
  };
}

async function cleanupTempDir(tempDir) {
  if (!tempDir) {
    return;
  }

  await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
}

module.exports = {
  listProfileVideos,
  downloadPostToTemp,
  cleanupTempDir,
  normalizeProfileEntry
};
