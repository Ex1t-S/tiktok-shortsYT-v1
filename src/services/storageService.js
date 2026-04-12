const fs = require("fs");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { env } = require("../config/env");

let client = null;

function canUseCloudStorage() {
  return Boolean(
    env.libraryCloudBucket &&
      env.libraryCloudEndpoint &&
      env.libraryCloudAccessKeyId &&
      env.libraryCloudSecretAccessKey
  );
}

function shouldUploadLibraryToCloud() {
  return ["cloud", "hybrid"].includes(String(env.libraryStorageMode || "").toLowerCase()) && canUseCloudStorage();
}

function getS3Client() {
  if (!canUseCloudStorage()) {
    throw new Error("Cloud storage is not configured");
  }

  if (!client) {
    client = new S3Client({
      region: env.libraryCloudRegion || "auto",
      endpoint: env.libraryCloudEndpoint,
      forcePathStyle: env.libraryCloudForcePathStyle,
      credentials: {
        accessKeyId: env.libraryCloudAccessKeyId,
        secretAccessKey: env.libraryCloudSecretAccessKey
      }
    });
  }

  return client;
}

function sanitizeObjectPart(value) {
  return String(value || "file")
    .replace(/[^a-zA-Z0-9-_\.\/]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildLibraryObjectKey(importBatchId, filename) {
  const safeBatchId = sanitizeObjectPart(importBatchId || Date.now());
  const safeFilename = sanitizeObjectPart(filename || "video.mp4");
  return `library/${safeBatchId}/${safeFilename}`;
}

function buildCloudSourceUrl(objectKey) {
  if (env.libraryCloudPublicBaseUrl) {
    return `${env.libraryCloudPublicBaseUrl.replace(/\/+$/, "")}/${String(objectKey || "").replace(/^\/+/, "")}`;
  }

  return null;
}

async function uploadLocalFileToCloud(localPath, options = {}) {
  const s3 = getS3Client();
  const objectKey = options.objectKey || buildLibraryObjectKey(options.importBatchId, path.basename(localPath));

  await s3.send(
    new PutObjectCommand({
      Bucket: env.libraryCloudBucket,
      Key: objectKey,
      Body: fs.createReadStream(localPath),
      ContentType: options.mimeType || "application/octet-stream"
    })
  );

  return {
    bucket: env.libraryCloudBucket,
    objectKey,
    sourceUrl: buildCloudSourceUrl(objectKey),
    storageProvider: env.libraryCloudProvider || "s3-compatible"
  };
}

async function downloadCloudObjectToTemp(libraryVideo) {
  const bucket = libraryVideo.storage_bucket || env.libraryCloudBucket;
  const objectKey = libraryVideo.storage_object_key;
  if (!bucket || !objectKey) {
    throw new Error("Cloud library video is missing bucket or object key");
  }

  const s3 = getS3Client();
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey
    })
  );

  if (!response.Body) {
    throw new Error("Cloud storage returned an empty object body");
  }

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tiktokscrap-cloud-"));
  const filename = path.basename(libraryVideo.original_filename || objectKey || "video.mp4");
  const filePath = path.join(tempDir, filename);
  await pipeline(response.Body, fs.createWriteStream(filePath));

  return {
    filePath,
    tempDir
  };
}

module.exports = {
  canUseCloudStorage,
  shouldUploadLibraryToCloud,
  buildLibraryObjectKey,
  uploadLocalFileToCloud,
  downloadCloudObjectToTemp
};
