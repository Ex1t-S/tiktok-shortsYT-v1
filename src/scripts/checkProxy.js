const { chromium } = require("playwright");
const { env } = require("../config/env");
const { getConfiguredProxy } = require("../config/proxy");

async function main() {
  const proxy = getConfiguredProxy();

  if (!proxy) {
    console.error("No proxy configured. Set SCRAPER_PROXY_FILE or SCRAPER_PROXY_SERVER.");
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: env.browserExecutablePath || undefined,
    proxy: {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password
    }
  });

  try {
    const page = await browser.newPage({
      userAgent: env.scraperUserAgent,
      locale: env.scraperLocale,
      timezoneId: env.scraperTimezoneId
    });

    await page.goto("https://api.ipify.org?format=json", {
      waitUntil: "domcontentloaded",
      timeout: env.scraperTimeoutMs
    });
    const ipifyText = await page.locator("body").innerText();
    const ipify = JSON.parse(ipifyText);

    await page.goto("https://www.tiktok.com/@tiktok", {
      waitUntil: "domcontentloaded",
      timeout: env.scraperTimeoutMs
    });
    await page.waitForTimeout(2500);

    const profileInfo = await page.evaluate(() => ({
      title: document.title,
      hasCaptcha: /drag the slider to fit the puzzle/i.test(document.body?.innerText || ""),
      url: location.href
    }));

    console.log(
      JSON.stringify(
        {
          proxySource: proxy.source,
          proxyIndex: proxy.index ?? null,
          proxyServer: proxy.server,
          publicIp: ipify.ip,
          tiktok: profileInfo
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
