const { env } = require("../config/env");

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const BLOCKED_TAGS = new Set([
  "tiktok",
  "tiktoker",
  "tik",
  "tok",
  "fyp",
  "foryou",
  "foryoupage",
  "viral",
  "parati",
  "para_ti",
  "xyzbca",
  "trend",
  "trending"
]);
const BLOCKED_TEXT_PATTERNS = [
  /https?:\/\/\S+/gi,
  /\b(?:tiktok|tik tok)\b/gi,
  /@\s*tiktok\b/gi,
  /#\s*tiktok\b/gi,
  /#\s*fyp\b/gi,
  /#\s*foryou(?:page)?\b/gi,
  /#\s*viral\b/gi,
  /#\s*parati\b/gi
];

function normalizeWhitespace(value, keepLineBreaks = false) {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E\n\r\t]/g, "")
    .replace(/\r\n/g, "\n");

  if (keepLineBreaks) {
    return normalized
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return normalized
    .replace(/\s+/g, " ")
    .trim();
}

function finalizeText(value, { keepLineBreaks = false, trimConnectorTail = false } = {}) {
  let cleaned = String(value || "")
    .replace(/\s+#(?=\s|$)/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+([,.:;!?])/g, "$1");

  cleaned = normalizeWhitespace(cleaned, keepLineBreaks);

  if (trimConnectorTail) {
    cleaned = cleaned.replace(/\b(?:en|de|con|por|para|y|o)$/i, "").trim();
  }

  return cleaned;
}

function removeBlockedText(value, { stripHashtags = false } = {}) {
  let cleaned = String(value || "");

  for (const pattern of BLOCKED_TEXT_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }

  cleaned = cleaned.replace(/(^|\s)(#[^\s#]+)/g, stripHashtags ? " " : (match, prefix, hashTag) => {
    const rawTag = String(hashTag || "").replace(/^#/, "").trim();
    const normalizedTag = rawTag.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!normalizedTag || BLOCKED_TAGS.has(normalizedTag)) {
      return " ";
    }

    return `${prefix}${rawTag.replace(/[_-]+/g, " ")}`;
  });

  cleaned = cleaned.replace(/\b(?:follow(?: me)?|credit:?|original sound)\b/gi, " ");
  return finalizeText(cleaned, { keepLineBreaks: true, trimConnectorTail: true });
}

function sanitizeMetadataText(value, maxLength, options = {}) {
  return finalizeText(removeBlockedText(value, options).slice(0, maxLength).trim(), {
    keepLineBreaks: true,
    trimConnectorTail: true
  });
}

function sanitizeTitle(value, fallback = "Short sin titulo") {
  return sanitizeMetadataText(value, 100, { stripHashtags: true }) || fallback;
}

function sanitizeDescription(value) {
  return sanitizeMetadataText(value, 5000, { stripHashtags: true });
}

function normalizeTags(input) {
  if (!input) {
    return [];
  }

  if (Array.isArray(input)) {
    return input.map((value) => String(value || "").trim()).filter(Boolean);
  }

  return String(input || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function extractHashtags(...values) {
  const tags = [];
  for (const value of values) {
    const matches = String(value || "").match(/(^|\s)#[^\s#]+/g) || [];
    for (const match of matches) {
      tags.push(String(match).replace(/(^|\s)#/, "").trim());
    }
  }
  return tags;
}

function sanitizeMetadataTags(input) {
  const tags = normalizeTags(input)
    .flatMap((value) => String(value).split(/\s+/))
    .map((value) => value.replace(/^#+/, "").trim())
    .map((value) => normalizeWhitespace(value))
    .map((value) => value.replace(/\s+/g, ""))
    .filter(Boolean)
    .filter((value) => !BLOCKED_TAGS.has(value.toLowerCase()))
    .slice(0, 12);

  return Array.from(new Set(tags));
}

function buildSourceFallbackTitle(source = {}) {
  const username = source.username || source.source_label || source.channel_title || "canal";
  return `Short de @${String(username).replace(/^@+/, "")}`;
}

function buildDefaultMetadata(source = {}) {
  const rawTitle =
    source.title ||
    source.library_title ||
    source.caption ||
    source.description ||
    source.original_filename ||
    buildSourceFallbackTitle(source);
  const title = sanitizeTitle(rawTitle, buildSourceFallbackTitle(source));

  const descriptionParts = [
    sanitizeDescription(source.description || source.caption || ""),
    sanitizeDescription(source.status_detail || "")
  ].filter(Boolean);

  const descriptionBase = descriptionParts.join("\n\n");
  const description = sanitizeDescription(descriptionBase) || `${title}\n\n#shorts`;

  const tags = sanitizeMetadataTags([
    ...(Array.isArray(source.tags) ? source.tags : []),
    ...extractHashtags(source.title, source.caption, source.description),
    source.editorial_category,
    source.source_label,
    "shorts"
  ]);

  return {
    title,
    description,
    tags: tags.length ? tags : ["shorts"],
    generator: "clean"
  };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function generateMetadataWithGemini(source = {}) {
  const fallback = buildDefaultMetadata(source);
  if (!env.geminiApiKey) {
    return fallback;
  }

  const promptPayload = {
    target: "youtube shorts",
    instructions: [
      "Escribe metadata clara y breve para YouTube.",
      "No menciones TikTok ni la palabra TikTok.",
      "No uses hashtags basura como fyp, viral o similares.",
      "Devuelve un titulo limpio, una descripcion util y tags concretos.",
      "Mantene el idioma original del contenido si se entiende."
    ],
    source: {
      title: String(source.title || source.library_title || source.caption || "").slice(0, 500),
      description: String(source.description || source.caption || "").slice(0, 2000),
      username: source.username || null,
      sourceLabel: source.source_label || source.channel_title || null,
      existingTags: sanitizeMetadataTags(source.tags || [])
    },
    fallback
  };

  const response = await fetch(`${GEMINI_API_BASE_URL}/${encodeURIComponent(env.geminiModel)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.geminiApiKey
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [
          {
            text:
              "Sos un editor de YouTube Shorts. Responde solo JSON con {\"title\":\"...\",\"description\":\"...\",\"tags\":[\"...\"]}. Nunca nombres TikTok y nunca devuelvas hashtags de TikTok."
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: JSON.stringify(promptPayload)
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "Gemini metadata generation failed");
  }

  const rawText = (data.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => part?.text || "")
    .join("")
    .trim();
  const parsed = safeJsonParse(rawText);

  return {
    title: sanitizeTitle(parsed?.title || fallback.title, fallback.title),
    description: sanitizeDescription(parsed?.description || fallback.description) || fallback.description,
    tags: sanitizeMetadataTags(parsed?.tags || fallback.tags),
    generator: "gemini"
  };
}

async function buildEnhancedMetadata(source = {}) {
  try {
    const generated = await generateMetadataWithGemini(source);
    if (generated.tags.length === 0) {
      generated.tags = ["shorts"];
    }
    return generated;
  } catch {
    return buildDefaultMetadata(source);
  }
}

module.exports = {
  sanitizeMetadataText,
  sanitizeTitle,
  sanitizeDescription,
  sanitizeMetadataTags,
  buildDefaultMetadata,
  buildEnhancedMetadata
};
