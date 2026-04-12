const fs = require("fs");
const path = require("path");
const stream = require("stream");
const archiver = require("archiver");
const { getMediaById, getProfileByUsername, listMediaByUsername } = require("./profileService");
const { downloadPostToTemp, cleanupTempDir } = require("./ytDlpService");

function sanitizeFilePart(value) {
  return String(value || "file")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function guessExtensionFromFile(filePath) {
  return path.extname(filePath).replace(/^\./, "") || "mp4";
}

async function cleanupTempDirs(tempDirs) {
  await Promise.all(tempDirs.map((dir) => cleanupTempDir(dir)));
}

async function streamZipArchive(mediaItems, zipFilename, res) {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  const tempDirs = [];
  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    await cleanupTempDirs(tempDirs);
  };

  archive.on("error", (error) => {
    void cleanup().finally(() => {
      if (!res.destroyed) {
        res.destroy(error);
      }
    });
  });
  res.on("close", () => {
    void cleanup();
  });
  res.on("error", () => {
    void cleanup();
  });
  archive.pipe(res);

  try {
    for (const item of mediaItems) {
      if (!item.post_url) {
        continue;
      }

      const { tempDir, filePath } = await downloadPostToTemp(item.post_url);
      tempDirs.push(tempDir);
      const extension = guessExtensionFromFile(filePath);
      const filename = `${sanitizeFilePart(item.username)}-${sanitizeFilePart(item.external_id)}.${extension}`;
      archive.file(filePath, { name: filename });
    }

    await archive.finalize();
    await stream.promises.finished(res);
  } finally {
    await cleanup();
  }
}

async function streamSingleMedia(mediaId, res) {
  const item = await getMediaById(mediaId);
  if (!item || !item.post_url) {
    const error = new Error("Media not found");
    error.statusCode = 404;
    throw error;
  }

  const { tempDir, filePath } = await downloadPostToTemp(item.post_url);
  const extension = guessExtensionFromFile(filePath);
  const filename = `${sanitizeFilePart(item.username)}-${sanitizeFilePart(item.external_id)}.${extension}`;

  try {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await stream.promises.pipeline(fs.createReadStream(filePath), res);
  } finally {
    await cleanupTempDir(tempDir);
  }
}

async function streamProfileZip(username, res) {
  const profile = await getProfileByUsername(username);
  if (!profile) {
    const error = new Error("Profile not found");
    error.statusCode = 404;
    throw error;
  }

  const mediaItems = await listMediaByUsername(username);
  if (mediaItems.length === 0) {
    const error = new Error("No media available");
    error.statusCode = 404;
    throw error;
  }

  await streamZipArchive(mediaItems, `${sanitizeFilePart(profile.username)}-media.zip`, res);
}

async function streamSelectedMediaZip(mediaIds, res) {
  const uniqueIds = Array.from(new Set((mediaIds || []).map((id) => String(id).trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    const error = new Error("No media selected");
    error.statusCode = 400;
    throw error;
  }

  const mediaItems = [];
  for (const mediaId of uniqueIds) {
    const item = await getMediaById(mediaId);
    if (item?.post_url) {
      mediaItems.push(item);
    }
  }

  if (mediaItems.length === 0) {
    const error = new Error("Selected media not found");
    error.statusCode = 404;
    throw error;
  }

  await streamZipArchive(mediaItems, "selected-tiktok-videos.zip", res);
}

module.exports = {
  streamSingleMedia,
  streamProfileZip,
  streamSelectedMediaZip
};
