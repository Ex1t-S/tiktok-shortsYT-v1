const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { promisify } = require("util");
const { execFile } = require("child_process");
const { query } = require("../db");
const { getMediaById } = require("./profileService");
const { downloadPostToTemp, cleanupTempDir } = require("./ytDlpService");
const { env } = require("../config/env");
const {
  shouldUploadLibraryToCloud,
  buildLibraryObjectKey,
  uploadLocalFileToCloud,
  downloadCloudObjectToTemp
} = require("./storageService");

const execFileAsync = promisify(execFile);
const LIBRARY_ROOT = path.join(process.cwd(), ".storage", "library");
const ALLOWED_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi"]);

function sanitizeFilePart(value) {
  return String(value || "file")
    .replace(/[^a-zA-Z0-9-_\.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildImportBatchId() {
  return `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function stripHashtags(value) {
  return String(value || "")
    .replace(/(^|\s)#[^\s#]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getVideoMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".mp4" || extension === ".m4v") {
    return "video/mp4";
  }
  if (extension === ".mov") {
    return "video/quicktime";
  }
  if (extension === ".webm") {
    return "video/webm";
  }
  if (extension === ".avi") {
    return "video/x-msvideo";
  }

  return "application/octet-stream";
}

async function ensureLibraryRoot() {
  await fs.promises.mkdir(LIBRARY_ROOT, { recursive: true });
}

async function listFilesRecursive(dirPath) {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(absolutePath)));
      continue;
    }

    files.push(absolutePath);
  }

  return files;
}

function buildStoredFilename(index, originalFilename) {
  const parsed = path.parse(originalFilename);
  const basename = sanitizeFilePart(parsed.name || `video-${index + 1}`) || `video-${index + 1}`;
  const extension = parsed.ext || ".mp4";
  return `${String(index + 1).padStart(3, "0")}-${basename}${extension.toLowerCase()}`;
}

function inferFilenameFromUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return path.basename(parsed.pathname) || "video.mp4";
  } catch (error) {
    return "video.mp4";
  }
}

async function extractZipArchive(zipPath, destinationDir) {
  if (process.platform === "win32") {
    const command = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`;
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], {
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 32
    });
    return;
  }

  await execFileAsync("python3", ["-m", "zipfile", "-e", zipPath, destinationDir], {
    timeout: 10 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 32
  });
}

async function persistLibraryVideoRecord(input) {
  const result = await query(
    `
      INSERT INTO library_videos (
        import_batch_id,
        source_archive_path,
        source_label,
        original_filename,
        stored_path,
        source_kind,
      storage_provider,
      source_url,
      storage_bucket,
      storage_object_key,
      thumbnail_url,
      title,
      description,
      mime_type,
        file_size_bytes,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
      RETURNING *
    `,
    [
      input.importBatchId,
      input.sourceArchivePath,
      input.sourceLabel,
      input.originalFilename,
      input.storedPath,
      input.sourceKind,
      input.storageProvider,
      input.sourceUrl || null,
      input.storageBucket || null,
      input.storageObjectKey || null,
      input.thumbnailUrl || null,
      input.title || null,
      input.description || null,
      input.mimeType || null,
      input.fileSizeBytes || 0
    ]
  );

  return result.rows[0];
}

async function maybeUploadStoredFileToCloud(storedPath, options = {}) {
  if (!shouldUploadLibraryToCloud()) {
    return {
      storedPath,
      storageProvider: "local",
      sourceUrl: null,
      storageBucket: null,
      storageObjectKey: null
    };
  }

  const objectKey = buildLibraryObjectKey(options.importBatchId, path.basename(storedPath));
  const uploaded = await uploadLocalFileToCloud(storedPath, {
    importBatchId: options.importBatchId,
    objectKey,
    mimeType: options.mimeType
  });

  const keepLocal = env.libraryKeepLocalCopy;
  if (!keepLocal) {
    await fs.promises.rm(storedPath, { force: true }).catch(() => {});
  }

  return {
    storedPath: keepLocal ? storedPath : uploaded.sourceUrl || `s3://${uploaded.bucket}/${uploaded.objectKey}`,
    storageProvider: uploaded.storageProvider,
    sourceUrl: uploaded.sourceUrl,
    storageBucket: uploaded.bucket,
    storageObjectKey: uploaded.objectKey
  };
}

async function importLibraryZip(payload = {}) {
  const zipPath = path.resolve(process.cwd(), String(payload.zipPath || "").trim());
  const sourceLabel = String(payload.label || path.parse(zipPath).name || "").trim() || null;

  if (!zipPath.toLowerCase().endsWith(".zip")) {
    throw new Error("zipPath must point to a .zip archive");
  }

  const stat = await fs.promises.stat(zipPath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error("ZIP archive not found");
  }

  await ensureLibraryRoot();

  const importBatchId = buildImportBatchId();
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tiktokscrap-library-"));
  const finalDir = path.join(LIBRARY_ROOT, importBatchId);
  await fs.promises.mkdir(finalDir, { recursive: true });

  try {
    await extractZipArchive(zipPath, tempDir);
    const extractedFiles = await listFilesRecursive(tempDir);
    const videoFiles = extractedFiles.filter((filePath) =>
      ALLOWED_VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())
    );

    if (videoFiles.length === 0) {
      throw new Error("The ZIP archive does not contain supported video files");
    }

    const created = [];
    for (const [index, sourceFile] of videoFiles.sort().entries()) {
      const originalFilename = path.basename(sourceFile);
      const storedFilename = buildStoredFilename(index, originalFilename);
      const storedPath = path.join(finalDir, storedFilename);
      await fs.promises.copyFile(sourceFile, storedPath);
      const fileStat = await fs.promises.stat(storedPath);

      const cloudStorage = await maybeUploadStoredFileToCloud(storedPath, {
        importBatchId,
        mimeType: getVideoMimeType(storedPath)
      });
      const result = await persistLibraryVideoRecord({
        importBatchId,
        sourceArchivePath: zipPath,
        sourceLabel,
        originalFilename,
        storedPath: cloudStorage.storedPath,
        sourceKind: "zip_import",
        storageProvider: cloudStorage.storageProvider,
        sourceUrl: cloudStorage.sourceUrl,
        storageBucket: cloudStorage.storageBucket,
        storageObjectKey: cloudStorage.storageObjectKey,
        thumbnailUrl: null,
        title: path.parse(originalFilename).name,
        description: payload.description ? String(payload.description).trim() : null,
        mimeType: getVideoMimeType(storedPath),
        fileSizeBytes: fileStat.size
      });

      created.push(result);
    }

    return {
      importBatchId,
      sourceArchivePath: zipPath,
      sourceLabel,
      createdCount: created.length,
      items: created
    };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function importLibraryVideo(payload = {}) {
  const sourceLabel = String(payload.label || "").trim() || null;
  const title = String(payload.title || "").trim() || null;
  const description = String(payload.description || "").trim() || null;
  const mimeType = String(payload.mimeType || "").trim() || null;
  const filePathInput = String(payload.filePath || "").trim();
  const sourceUrl = String(payload.sourceUrl || "").trim();
  const storageProvider = String(payload.storageProvider || (sourceUrl ? "remote_url" : "local")).trim() || "local";
  const importBatchId = buildImportBatchId();

  if (!filePathInput && !sourceUrl) {
    throw new Error("filePath or sourceUrl is required");
  }

  await ensureLibraryRoot();

  if (filePathInput) {
    const absolutePath = path.resolve(process.cwd(), filePathInput);
    const stat = await fs.promises.stat(absolutePath).catch(() => null);
    if (!stat?.isFile()) {
      throw new Error("Source video file was not found");
    }

    if (!ALLOWED_VIDEO_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) {
      throw new Error("Unsupported video format");
    }

    const originalFilename = path.basename(absolutePath);
    const finalDir = path.join(LIBRARY_ROOT, importBatchId);
    await fs.promises.mkdir(finalDir, { recursive: true });
    const storedFilename = buildStoredFilename(0, originalFilename);
    const storedPath = path.join(finalDir, storedFilename);
    await fs.promises.copyFile(absolutePath, storedPath);
    const fileStat = await fs.promises.stat(storedPath);

    const cloudStorage = await maybeUploadStoredFileToCloud(storedPath, {
      importBatchId,
      mimeType: mimeType || getVideoMimeType(storedPath)
    });
    const result = await persistLibraryVideoRecord({
      importBatchId,
      sourceArchivePath: absolutePath,
      sourceLabel,
      originalFilename,
      storedPath: cloudStorage.storedPath,
      sourceKind: "direct_upload",
      storageProvider: cloudStorage.storageProvider,
      sourceUrl: cloudStorage.sourceUrl,
      storageBucket: cloudStorage.storageBucket,
      storageObjectKey: cloudStorage.storageObjectKey,
      thumbnailUrl: null,
      title: title || path.parse(originalFilename).name,
      description,
      mimeType: mimeType || getVideoMimeType(storedPath),
      fileSizeBytes: fileStat.size
    });

    return result;
  }

  const originalFilename = inferFilenameFromUrl(sourceUrl);
  return persistLibraryVideoRecord({
    importBatchId,
    sourceArchivePath: sourceUrl,
    sourceLabel,
    originalFilename,
    storedPath: sourceUrl,
    sourceKind: "cloud_reference",
    storageProvider,
    sourceUrl,
    storageBucket: payload.storageBucket ? String(payload.storageBucket).trim() : null,
    storageObjectKey: payload.storageObjectKey ? String(payload.storageObjectKey).trim() : null,
    thumbnailUrl: null,
    title: title || path.parse(originalFilename).name,
    description,
    mimeType: mimeType || getVideoMimeType(originalFilename),
    fileSizeBytes: 0
  });
}

async function captureTrackedMediaToLibrary(payload = {}) {
  const mediaIds = Array.isArray(payload.mediaIds)
    ? payload.mediaIds.map((value) => Number(value)).filter(Number.isFinite)
    : [];

  if (mediaIds.length === 0) {
    throw new Error("mediaIds are required");
  }

  await ensureLibraryRoot();

  const importBatchId = buildImportBatchId();
  const finalDir = path.join(LIBRARY_ROOT, importBatchId);
  await fs.promises.mkdir(finalDir, { recursive: true });

  const created = [];
  for (const [index, mediaId] of mediaIds.entries()) {
    const mediaItem = await getMediaById(mediaId);
    if (!mediaItem?.post_url) {
      continue;
    }

    const download = await downloadPostToTemp(mediaItem.post_url);
    try {
      const originalFilename = path.basename(download.filePath);
      const storedFilename = buildStoredFilename(index, originalFilename);
      const storedPath = path.join(finalDir, storedFilename);
      await fs.promises.copyFile(download.filePath, storedPath);
      const fileStat = await fs.promises.stat(storedPath);

      const cloudStorage = await maybeUploadStoredFileToCloud(storedPath, {
        importBatchId,
        mimeType: getVideoMimeType(storedPath)
      });
      const result = await persistLibraryVideoRecord({
        importBatchId,
        sourceArchivePath: mediaItem.post_url,
        sourceLabel: payload.label ? String(payload.label).trim() : mediaItem.username,
        originalFilename,
        storedPath: cloudStorage.storedPath,
        sourceKind: "tracked_capture",
        storageProvider: cloudStorage.storageProvider,
        sourceUrl: cloudStorage.sourceUrl,
        storageBucket: cloudStorage.storageBucket,
        storageObjectKey: cloudStorage.storageObjectKey,
        thumbnailUrl: mediaItem.thumbnail_url || null,
        title: stripHashtags(mediaItem.caption || "").slice(0, 120) || path.parse(originalFilename).name,
        description: mediaItem.caption ? String(mediaItem.caption).trim() : null,
        mimeType: getVideoMimeType(storedPath),
        fileSizeBytes: fileStat.size
      });

      created.push(result);
    } finally {
      await cleanupTempDir(download.tempDir);
    }
  }

  return {
    importBatchId,
    createdCount: created.length,
    items: created
  };
}

async function downloadLibrarySourceToTemp(libraryVideo) {
  if (!libraryVideo?.source_url) {
    throw new Error("The library video does not have a remote source URL");
  }

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tiktokscrap-library-fetch-"));
  const originalFilename = libraryVideo.original_filename || inferFilenameFromUrl(libraryVideo.source_url);
  const targetPath = path.join(tempDir, sanitizeFilePart(originalFilename) || "video.mp4");
  const response = await fetch(libraryVideo.source_url);
  if (!response.ok) {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Failed to download remote library video (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.promises.writeFile(targetPath, Buffer.from(arrayBuffer));

  return {
    filePath: targetPath,
    tempDir
  };
}

async function resolveLibraryVideoFile(libraryVideo) {
  if (!libraryVideo) {
    throw new Error("library video not found");
  }

  if (libraryVideo.storage_object_key) {
    return downloadCloudObjectToTemp(libraryVideo);
  }

  if (libraryVideo.storage_provider === "local" && libraryVideo.stored_path) {
    const stat = await fs.promises.stat(libraryVideo.stored_path).catch(() => null);
    if (!stat?.isFile()) {
      throw new Error("Stored local library file was not found");
    }

    return {
      filePath: libraryVideo.stored_path,
      tempDir: null
    };
  }

  if (libraryVideo.source_url) {
    return downloadLibrarySourceToTemp(libraryVideo);
  }

  throw new Error("The library video source cannot be resolved");
}

async function listLibraryVideos() {
  const result = await query(
    `
      SELECT
        lv.*,
        p.id AS publication_id,
        p.status AS publication_status,
        p.scheduled_for,
        p.youtube_account_id,
        ya.channel_title
      FROM library_videos lv
      LEFT JOIN LATERAL (
        SELECT *
        FROM publications
        WHERE library_video_id = lv.id
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) p ON TRUE
      LEFT JOIN youtube_accounts ya ON ya.id = p.youtube_account_id
      ORDER BY lv.created_at DESC, lv.id DESC
    `
  );

  return result.rows;
}

async function getLibraryVideoById(libraryVideoId) {
  const result = await query(
    `
      SELECT *
      FROM library_videos
      WHERE id = $1
    `,
    [libraryVideoId]
  );

  return result.rows[0] || null;
}

module.exports = {
  importLibraryZip,
  importLibraryVideo,
  captureTrackedMediaToLibrary,
  listLibraryVideos,
  getLibraryVideoById,
  resolveLibraryVideoFile,
  getVideoMimeType
};
