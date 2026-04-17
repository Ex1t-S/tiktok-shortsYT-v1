export function translateStatus(value) {
  const labels = {
    idle: "inactivo",
    success: "ok",
    failed: "fallo",
    running: "corriendo",
    pending: "pendiente",
    approved: "aprobado",
    rejected: "rechazado",
    ready: "listo",
    scheduled: "programado",
    publishing: "publicando",
    published: "publicado",
    awaiting_oauth: "esperando oauth",
    manual: "manual",
    connected: "conectado",
    ready_for_oauth: "listo para oauth",
    oauth_pending: "oauth pendiente",
    active: "activo",
    private: "privado",
    public: "publico",
    unlisted: "oculto"
  };

  return labels[String(value || "").toLowerCase()] || String(value || "-");
}

export function translateSeedType(value) {
  const labels = {
    profile: "perfil",
    hashtag: "hashtag",
    keyword: "keyword"
  };

  return labels[String(value || "").toLowerCase()] || String(value || "-");
}

export function translateSourceKind(value) {
  const labels = {
    tracked_media: "video encontrado",
    library_video: "video de biblioteca",
    clone: "clonación"
  };

  return labels[String(value || "").toLowerCase()] || String(value || "-");
}

export function translateStorageProvider(value) {
  const labels = {
    local: "local",
    remote_url: "url remota",
    "s3-compatible": "s3 / r2",
    zip_import: "zip",
    tracked_capture: "captura",
    direct_upload: "archivo local",
    cloud_reference: "cloud"
  };

  return labels[String(value || "").toLowerCase()] || String(value || "-");
}

export function translateWorkerType(value) {
  const labels = {
    publication: "publicacion",
    discovery: "descubrimiento"
  };

  return labels[String(value || "").toLowerCase()] || String(value || "-");
}

export function translateWorkerHealth(value) {
  const labels = {
    online: "online",
    offline: "offline",
    stale: "sin heartbeat"
  };

  return labels[String(value || "").toLowerCase()] || String(value || "-");
}

export function translateStatusDetail(value) {
  const detail = String(value || "");
  const labels = {
    "Connect OAuth credentials before publishing": "Conecta OAuth antes de publicar.",
    "Ready to upload through the YouTube API": "Listo para subir por la API de YouTube.",
    "Downloading source video and uploading to YouTube": "Descargando video origen y subiendolo a YouTube.",
    "Video uploaded successfully": "Video subido correctamente.",
    "Metrics synced from YouTube": "Metricas sincronizadas desde YouTube."
  };

  return labels[detail] || detail;
}

export function parseBulkYoutubeAccounts(rawValue) {
  return String(rawValue || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [channelTitle, channelHandle = "", channelId = "", contactEmail = ""] = line
        .split("|")
        .map((part) => part.trim());
      return { channelTitle, channelHandle, channelId, contactEmail };
    })
    .filter((item) => item.channelTitle);
}

export function isHashtagQuery(value) {
  return String(value || "").trim().startsWith("#");
}

export function summarizeTrackingRun(scrape) {
  if (!scrape) {
    return "";
  }

  const savedCount = Number(scrape.saved_count || 0);
  const expectedCount = Number(scrape.expected_count || 0);
  const progressBits = [];

  if (savedCount > 0) {
    progressBits.push(`${savedCount} guardados`);
  }

  if (expectedCount > 0) {
    progressBits.push(`objetivo ${expectedCount}`);
  }

  if (scrape.new_items_count) {
    progressBits.push(`${scrape.new_items_count} nuevos`);
  }

  return progressBits.join(" | ");
}

export function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("es-AR");
}

export function formatDuration(seconds) {
  const total = Number(seconds || 0);
  if (!total) {
    return "";
  }

  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function formatMetric(value) {
  const numeric = Number(value || 0);
  if (numeric >= 1000000000) {
    return `${(numeric / 1000000000).toFixed(1)}B`;
  }

  if (numeric >= 1000000) {
    return `${(numeric / 1000000).toFixed(1)}M`;
  }

  if (numeric >= 1000) {
    return `${(numeric / 1000).toFixed(1)}K`;
  }

  return String(numeric);
}

export function formatIsoDuration(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(String(value || ""));
  if (!match) {
    return "";
  }

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const totalMinutes = hours * 60 + minutes;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${totalMinutes}:${String(seconds).padStart(2, "0")}`;
}

export function extractVideoTitle(...values) {
  for (const value of values) {
    const raw = String(value || "").trim();
    if (!raw) continue;

    const cleaned = raw
      .replace(/(^|\s)#[^\s#]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (cleaned) {
      return cleaned;
    }
  }

  return "";
}

export async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "La solicitud fallo");
  }

  return data;
}

export async function postJson(url, payload, method = "POST") {
  return fetchJson(url, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export async function postBlob(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "La descarga fallo");
  }

  return {
    blob: await response.blob(),
    filename: getFilenameFromDisposition(response.headers.get("content-disposition"))
  };
}

export function getFilenameFromDisposition(header) {
  const match = /filename="([^"]+)"/i.exec(header || "");
  return match ? match[1] : "videos-tiktok-seleccionados.zip";
}

export function triggerBlobDownload(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function pathFromArchive(value) {
  const parts = String(value || "").split(/[/\\]+/);
  return parts[parts.length - 1] || "";
}
