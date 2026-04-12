const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { env } = require("../config/env");

function parseBooleanSymbol(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "✓" || normalized === "âœ“" || normalized === "true";
}

function parseExpires(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.toLowerCase() === "session") {
    return undefined;
  }

  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  return Math.floor(timestamp / 1000);
}

function inferSameSite(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "none") {
    return "None";
  }

  if (normalized === "strict") {
    return "Strict";
  }

  return "Lax";
}

function normalizeDomain(domain) {
  const value = String(domain || "").trim();
  return value.startsWith(".") ? value.slice(1) : value;
}

function parseCookieLine(line) {
  const parts = line.split("\t");
  if (parts.length < 4) {
    return null;
  }

  const [name, value, domain, cookiePath, expiresAt, , httpOnly, secure, sameSite] = parts;
  if (!name || !domain || !cookiePath) {
    return null;
  }

  return {
    name: String(name).trim(),
    value: String(value || ""),
    domain: normalizeDomain(domain),
    path: String(cookiePath).trim() || "/",
    expires: parseExpires(expiresAt),
    httpOnly: parseBooleanSymbol(httpOnly),
    secure: parseBooleanSymbol(secure),
    sameSite: inferSameSite(sameSite)
  };
}

function readCookiesFile(filePath) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const content = fs.readFileSync(absolutePath, "utf8");

  return content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parseCookieLine)
    .filter(Boolean);
}

async function main() {
  const inputPath = process.argv[2] || "tiktok-cookies.txt";
  const cookies = readCookiesFile(inputPath);

  if (cookies.length === 0) {
    throw new Error(`No cookies were parsed from ${inputPath}`);
  }

  const context = await chromium.launchPersistentContext(env.scraperSessionDir, {
    headless: false,
    executablePath: env.browserExecutablePath || undefined,
    channel: env.scraperBrowserChannel || undefined,
    userAgent: env.scraperUserAgent,
    viewport: { width: 1440, height: 1024 },
    locale: env.scraperLocale,
    timezoneId: env.scraperTimezoneId
  });

  try {
    await context.addCookies(cookies);
    const page = context.pages()[0] || (await context.newPage());
    await page.goto("https://www.tiktok.com", {
      waitUntil: "domcontentloaded",
      timeout: env.scraperTimeoutMs
    });
    await page.waitForTimeout(1500);
    await page.goto("https://www.tiktok.com/@tiktok", {
      waitUntil: "domcontentloaded",
      timeout: env.scraperTimeoutMs
    });
    await page.waitForTimeout(4000);

    const status = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      return {
        url: location.href,
        hasCaptcha: /drag the slider to fit the puzzle/i.test(text),
        hasLoginPrompt: /iniciar sesi[oó]n|log in/i.test(text),
        bodyText: text.slice(0, 1200)
      };
    });

    console.log(
      JSON.stringify(
        {
          importedCookies: cookies.length,
          status
        },
        null,
        2
      )
    );
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
