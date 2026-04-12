const { chromium } = require("playwright");
const { env } = require("../config/env");
const { getConfiguredProxy } = require("../config/proxy");

class TikTokScraperError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "TikTokScraperError";
    this.code = options.code || "TIKTOK_SCRAPER_ERROR";
    this.statusCode = options.statusCode || 502;
    this.details = options.details || null;
  }
}

function normalizeUsername(username) {
  const raw = String(username || "").trim();
  const fromUrlMatch = raw.match(/tiktok\.com\/@([^/?#]+)/i);
  const candidate = (fromUrlMatch?.[1] || raw)
    .replace(/^@+/, "")
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?]+$/g, "")
    .replace(/^["'`([{<\s]+|["'`\])}>.,;:!?\s]+$/g, "");

  return candidate.replace(/[^a-z0-9._-]/g, "");
}

function normalizeHashtag(tag) {
  const raw = String(tag || "").trim();
  return raw
    .replace(/^#+/, "")
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?]+$/g, "")
    .replace(/^["'`([{<\s]+|["'`\])}>.,;:!?\s]+$/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractProfileMetaFromUniversalData(data) {
  const scope = data?.["__DEFAULT_SCOPE__"] || {};
  const users = scope.webapp?.user?.users || {};
  const userStats = scope.webapp?.user?.stats || {};
  const firstUser = Object.values(users)[0];
  const firstStats = Object.values(userStats)[0];
  const userDetail = scope["webapp.user-detail"]?.userInfo || {};
  const detailUser = userDetail.user || null;
  const detailStats = userDetail.stats || userDetail.statsV2 || null;

  return {
    displayName: firstUser?.nickname || detailUser?.nickname || null,
    avatarUrl:
      firstUser?.avatarLarger ||
      firstUser?.avatarMedium ||
      detailUser?.avatarLarger ||
      detailUser?.avatarMedium ||
      null,
    profileUrl:
      (firstUser?.uniqueId && `https://www.tiktok.com/@${firstUser.uniqueId}`) ||
      (detailUser?.uniqueId && `https://www.tiktok.com/@${detailUser.uniqueId}`) ||
      null,
    totalFromStats: Number(firstStats?.videoCount || detailStats?.videoCount || 0),
    secUid: detailUser?.secUid || null,
    itemList: Array.isArray(userDetail.itemList) ? userDetail.itemList : []
  };
}

function extractMediaFromItemStruct(item) {
  if (!item) {
    return null;
  }

  const imageList = item.imagePost?.images || [];
  const imageUrl =
    imageList[0]?.imageURL?.urlList?.[0] ||
    imageList[0]?.displayImage?.urlList?.[0] ||
    item.imagePost?.cover?.imageURL?.urlList?.[0] ||
    null;
  const videoUrl =
    item.video?.downloadAddr ||
    item.video?.playAddr ||
    item.video?.bitrateInfo?.[0]?.PlayAddr?.UrlList?.[0] ||
    null;
  const mediaType = videoUrl ? "video" : imageUrl ? "image" : null;

  if (!mediaType) {
    return null;
  }

  return {
    externalId: String(item.id || item.video?.id || item.createTime || Math.random()),
    mediaType,
    mediaUrl: videoUrl || imageUrl,
    thumbnailUrl:
      item.video?.cover ||
      item.video?.dynamicCover ||
      item.video?.originCover ||
      item.video?.cover?.urlList?.[0] ||
      item.video?.dynamicCover?.urlList?.[0] ||
      item.video?.originCover?.urlList?.[0] ||
      imageUrl ||
      item.imagePost?.cover?.imageURL?.urlList?.[0] ||
      null,
    caption: item.desc || "",
    publishedAt: item.createTime ? new Date(Number(item.createTime) * 1000).toISOString() : null
  };
}

function extractItemEntries({ universalData, sigiState }) {
  const profileMeta = extractProfileMetaFromUniversalData(universalData);
  const universalItems = profileMeta.itemList
    .map((item) => ({
      postUrl: item.shareInfo?.shareUrl || item.shareInfo?.shareUrlV2 || null,
      item
    }))
    .filter((entry) => entry.postUrl);

  const itemModule = sigiState?.ItemModule || {};
  const stateItems = Object.values(itemModule)
    .map((item) => ({
      postUrl: item.shareInfo?.shareUrl || item.shareInfo?.shareUrlV2 || null,
      item
    }))
    .filter((entry) => entry.postUrl);

  return [...universalItems, ...stateItems];
}

function hasCaptchaText(text) {
  return /drag the slider to fit the puzzle/i.test(text || "");
}

async function readPostListApiResult(page, timeoutMs) {
  try {
    const response = await page.waitForResponse(
      (candidate) => candidate.url().includes("/api/post/item_list/"),
      { timeout: timeoutMs }
    );

    await response.finished().catch(() => {});

    const headers = response.headers();
    const contentLength = Number(headers["content-length"] || "0");
    const blocked = Boolean(headers["bdturing-verify"] || headers["x-vc-bdturing-parameters"]);
    const bodyText = contentLength > 0 ? await response.text().catch(() => "") : "";
    const body = bodyText ? parseJsonSafe(bodyText) : null;

    return {
      blocked,
      status: response.status(),
      headers,
      body
    };
  } catch {
    return null;
  }
}

async function collectPostLinks(page, username) {
  const profileUrl = `https://www.tiktok.com/@${username}`;
  return collectPostLinksFromPage(page, profileUrl, {
    sourceType: "profile",
    entityName: username
  });
}

async function collectPostLinksFromPage(page, pageUrl, options = {}) {
  const postListResponsePromise = readPostListApiResult(page, Math.min(env.scraperTimeoutMs, 8000));
  await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: env.scraperTimeoutMs });
  await page.waitForTimeout(2500);

  await page.evaluate(async () => {
    for (let step = 0; step < 3; step += 1) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(600);

  const pageData = await page.evaluate(() => {
    return {
      universalDataText:
        document.querySelector("#__UNIVERSAL_DATA_FOR_REHYDRATION__")?.textContent || null,
      sigiStateText: document.querySelector("#SIGI_STATE")?.textContent || null,
      anchors: Array.from(document.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]'))
        .map((anchor) => anchor.href)
        .filter(Boolean),
      bodyText: document.body?.innerText || ""
    };
  });

  const universalData = parseJsonSafe(pageData.universalDataText);
  const sigiState = parseJsonSafe(pageData.sigiStateText);
  const postListApi = await postListResponsePromise;
  const profileMeta = extractProfileMetaFromUniversalData(universalData);
  const itemEntries = extractItemEntries({ universalData, sigiState });
  const apiItems = Array.isArray(postListApi?.body?.itemList) ? postListApi.body.itemList : [];
  for (const item of apiItems) {
    const postUrl = item.shareInfo?.shareUrl || item.shareInfo?.shareUrlV2 || null;
    if (postUrl) {
      itemEntries.push({ postUrl, item });
    }
  }

  const linkSet = new Set(pageData.anchors);
  for (const entry of itemEntries) {
    linkSet.add(entry.postUrl);
  }

  const challengeDetected = hasCaptchaText(pageData.bodyText) || Boolean(postListApi?.blocked);

  return {
    profile: {
      username: options.entityName,
      displayName:
        profileMeta.displayName ||
        sigiState?.UserModule?.users?.[options.entityName]?.nickname ||
        options.entityName,
      avatarUrl:
        profileMeta.avatarUrl || sigiState?.UserModule?.users?.[options.entityName]?.avatarLarger || null,
      profileUrl: pageUrl,
      totalFromStats:
        profileMeta.totalFromStats ||
        Number(sigiState?.UserModule?.stats?.[options.entityName]?.videoCount || linkSet.size)
    },
    directItems: itemEntries
      .map((entry) => {
        const media = extractMediaFromItemStruct(entry.item);
        if (!media) {
          return null;
        }

        return {
          ...media,
          postUrl: entry.postUrl
        };
      })
      .filter(Boolean),
    postLinks: Array.from(linkSet),
    challengeDetected
  };
}

async function collectHashtagLinks(page, tag) {
  const tagUrl = `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`;
  const result = await collectPostLinksFromPage(page, tagUrl, {
    sourceType: "hashtag",
    entityName: tag
  });

  return {
    ...result,
    profile: {
      username: `tag-${tag}`,
      displayName: `#${tag}`,
      avatarUrl: null,
      profileUrl: tagUrl,
      totalFromStats: result.postLinks.length
    }
  };
}

async function extractMediaFromPostPage(page, postUrl) {
  await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: env.scraperTimeoutMs });
  await page.waitForTimeout(1200);

  const postData = await page.evaluate(() => {
    return {
      universalDataText:
        document.querySelector("#__UNIVERSAL_DATA_FOR_REHYDRATION__")?.textContent || null,
      sigiStateText: document.querySelector("#SIGI_STATE")?.textContent || null
    };
  });

  const universalData = parseJsonSafe(postData.universalDataText);
  const sigiState = parseJsonSafe(postData.sigiStateText);

  const itemStruct =
    universalData?.["__DEFAULT_SCOPE__"]?.webapp?.video?.detail?.itemInfo?.itemStruct ||
    Object.values(sigiState?.ItemModule || {})[0] ||
    null;

  const media = extractMediaFromItemStruct(itemStruct);
  if (!media) {
    return null;
  }

  return {
    ...media,
    postUrl
  };
}

async function notifyProgress(callback, payload) {
  if (typeof callback === "function") {
    await callback(payload);
  }
}

async function notifyItem(callback, item, meta = {}) {
  if (typeof callback === "function") {
    await callback(item, meta);
  }
}

async function scrapeProfile(usernameInput, options = {}) {
  const username = normalizeUsername(usernameInput);
  const itemLimit = Math.max(1, Number(options.limit || env.ytDlpProfileLimit || 20));
  const launchOptions = {
    headless: env.scraperHeadless
  };

  const proxy = getConfiguredProxy();
  if (proxy) {
    launchOptions.proxy = {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password
    };
  }

  if (env.browserExecutablePath) {
    launchOptions.executablePath = env.browserExecutablePath;
  }
  if (env.scraperBrowserChannel) {
    launchOptions.channel = env.scraperBrowserChannel;
  }

  let browser = null;
  let context = null;

  try {
    const contextOptions = {
      userAgent: env.scraperUserAgent,
      viewport: { width: 1440, height: 1024 },
      locale: env.scraperLocale,
      timezoneId: env.scraperTimezoneId
    };

    if (env.scraperSessionDir) {
      context = await chromium.launchPersistentContext(env.scraperSessionDir, {
        ...launchOptions,
        ...contextOptions
      });
    } else {
      browser = await chromium.launch(launchOptions);
      context = await browser.newContext(contextOptions);
    }

    const page = context.pages()[0] || (await context.newPage());
    await notifyProgress(options.onProgress, {
      phase: "loading_profile",
      message: `Abriendo perfil @${username} en TikTok`
    });

    const profileData = await collectPostLinks(page, username);
    const mediaByPostUrl = new Map();
    const limitedPostLinks = profileData.postLinks.slice(0, itemLimit);
    const limitedDirectItems = profileData.directItems.filter((item) => limitedPostLinks.includes(item.postUrl));
    await notifyProgress(options.onProgress, {
      phase: "collecting_links",
      message: `Perfil cargado. ${limitedPostLinks.length} enlaces detectados`,
      expectedCount: limitedPostLinks.length,
      processedCount: 0
    });

    for (const item of limitedDirectItems) {
      mediaByPostUrl.set(item.postUrl, item);
      await notifyItem(options.onItem, item, {
        phase: "saving_direct_items",
        expectedCount: limitedPostLinks.length,
        processedCount: mediaByPostUrl.size
      });
    }

    const unresolvedLinks = limitedPostLinks.filter((postUrl) => !mediaByPostUrl.has(postUrl));
    let resolvedCount = mediaByPostUrl.size;
    for (const postUrl of unresolvedLinks) {
      await notifyProgress(options.onProgress, {
        phase: "resolving_posts",
        message: `Extrayendo post ${resolvedCount + 1} de ${limitedPostLinks.length}`,
        expectedCount: limitedPostLinks.length,
        processedCount: resolvedCount
      });
      const media = await extractMediaFromPostPage(page, postUrl);
      if (media) {
        mediaByPostUrl.set(postUrl, media);
        resolvedCount += 1;
        await notifyItem(options.onItem, media, {
          phase: "resolving_posts",
          expectedCount: limitedPostLinks.length,
          processedCount: resolvedCount
        });
      }
    }

    const mediaItems = Array.from(mediaByPostUrl.values());
    if (mediaItems.length === 0) {
      if (profileData.challengeDetected) {
        throw new TikTokScraperError(
          "TikTok bloqueó temporalmente la extracción con un challenge anti-bot. Reintentá más tarde o desde un entorno con menos restricciones.",
          {
            code: "TIKTOK_CHALLENGE",
            statusCode: 503,
            details: {
              username
            }
          }
        );
      }

      throw new TikTokScraperError("No se pudo extraer contenido multimedia del perfil", {
        code: "NO_MEDIA_EXTRACTED",
        statusCode: 502,
        details: {
          username
        }
      });
    }

    return {
      profile: {
        ...profileData.profile,
        totalMediaCount: mediaItems.length
      },
      mediaItems
    };
  } finally {
    await context?.close();
    await browser?.close();
  }
}

async function scrapeHashtag(tagInput, options = {}) {
  const tag = normalizeHashtag(tagInput);
  const itemLimit = Math.max(1, Number(options.limit || env.ytDlpProfileLimit || 20));
  if (!tag) {
    throw new TikTokScraperError("hashtag is required", {
      code: "INVALID_HASHTAG",
      statusCode: 400
    });
  }

  const launchOptions = {
    headless: env.scraperHeadless
  };

  const proxy = getConfiguredProxy();
  if (proxy) {
    launchOptions.proxy = {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password
    };
  }

  if (env.browserExecutablePath) {
    launchOptions.executablePath = env.browserExecutablePath;
  }
  if (env.scraperBrowserChannel) {
    launchOptions.channel = env.scraperBrowserChannel;
  }

  let browser = null;
  let context = null;

  try {
    const contextOptions = {
      userAgent: env.scraperUserAgent,
      viewport: { width: 1440, height: 1024 },
      locale: env.scraperLocale,
      timezoneId: env.scraperTimezoneId
    };

    if (env.scraperSessionDir) {
      context = await chromium.launchPersistentContext(env.scraperSessionDir, {
        ...launchOptions,
        ...contextOptions
      });
    } else {
      browser = await chromium.launch(launchOptions);
      context = await browser.newContext(contextOptions);
    }

    const page = context.pages()[0] || (await context.newPage());
    await notifyProgress(options.onProgress, {
      phase: "loading_hashtag",
      message: `Abriendo hashtag #${tag} en TikTok`
    });
    const hashtagData = await collectHashtagLinks(page, tag);
    const mediaByPostUrl = new Map();
    const expectedCount = Math.min(hashtagData.postLinks.length, itemLimit);
    await notifyProgress(options.onProgress, {
      phase: "collecting_links",
      message: `Hashtag cargado. ${expectedCount} enlaces detectados`,
      expectedCount,
      processedCount: 0
    });

    let resolvedCount = 0;
    for (const postUrl of hashtagData.postLinks.slice(0, itemLimit)) {
      await notifyProgress(options.onProgress, {
        phase: "resolving_posts",
        message: `Extrayendo post ${resolvedCount + 1} de ${expectedCount}`,
        expectedCount,
        processedCount: resolvedCount
      });
      const media = await extractMediaFromPostPage(page, postUrl);
      if (media) {
        mediaByPostUrl.set(postUrl, media);
        resolvedCount += 1;
        await notifyItem(options.onItem, media, {
          phase: "resolving_posts",
          expectedCount,
          processedCount: resolvedCount
        });
      }
    }

    const mediaItems = Array.from(mediaByPostUrl.values());
    if (mediaItems.length === 0) {
      if (hashtagData.challengeDetected) {
        throw new TikTokScraperError(
          "TikTok bloqueó temporalmente la extracción del hashtag con un challenge anti-bot.",
          {
            code: "TIKTOK_CHALLENGE",
            statusCode: 503,
            details: { hashtag: tag }
          }
        );
      }

      throw new TikTokScraperError("No se pudo extraer contenido multimedia del hashtag", {
        code: "NO_MEDIA_EXTRACTED",
        statusCode: 502,
        details: { hashtag: tag }
      });
    }

    return {
      profile: {
        ...hashtagData.profile,
        totalMediaCount: mediaItems.length
      },
      mediaItems
    };
  } finally {
    await context?.close();
    await browser?.close();
  }
}

module.exports = {
  scrapeProfile,
  scrapeHashtag,
  normalizeUsername,
  normalizeHashtag,
  TikTokScraperError
};
