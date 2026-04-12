const { chromium } = require("playwright");
const { env } = require("../config/env");
const { getConfiguredProxy } = require("../config/proxy");

async function waitForLogin(page, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      const hasCaptcha = /drag the slider to fit the puzzle/i.test(text);
      const hasLoginPrompt = /iniciar sesi[oó]n|log in|use phone \/ email \/ username/i.test(text);
      const loggedInHints =
        /for you|following|profile|edit profile|view profile|upload/i.test(text) ||
        document.cookie.includes("sessionid") ||
        document.cookie.includes("sid_tt");

      return {
        href: location.href,
        hasCaptcha,
        hasLoginPrompt,
        loggedInHints
      };
    });

    if (state.loggedInHints && !state.hasLoginPrompt) {
      return state;
    }

    await page.waitForTimeout(1500);
  }

  throw new Error("Login was not detected within the allotted time");
}

async function main() {
  const launchOptions = {
    headless: false,
    executablePath: env.browserExecutablePath || undefined,
    channel: env.scraperBrowserChannel || undefined
  };

  const proxy = env.scraperLoginUseProxy ? getConfiguredProxy() : null;
  if (proxy) {
    launchOptions.proxy = {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password
    };
  }

  const context = await chromium.launchPersistentContext(env.scraperSessionDir, {
    ...launchOptions,
    userAgent: env.scraperUserAgent,
    viewport: { width: 1440, height: 1024 },
    locale: env.scraperLocale,
    timezoneId: env.scraperTimezoneId
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto("https://www.tiktok.com/login", {
      waitUntil: "domcontentloaded",
      timeout: env.scraperTimeoutMs
    });

    console.log(`Session directory: ${env.scraperSessionDir}`);
    console.log("Log in manually in the opened browser window.");
    console.log("The browser will stay open while I wait for TikTok to show a logged-in session.");

    const state = await waitForLogin(page, 10 * 60 * 1000);
    console.log(`Login detected at ${state.href}`);
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
