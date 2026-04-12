const fs = require("fs");
const path = require("path");
const { env } = require("./env");

function parseProxyLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(":");
  if (parts.length < 2) {
    return null;
  }

  const [host, port, username = "", password = ""] = parts;
  if (!host || !port) {
    return null;
  }

  return {
    host,
    port,
    username,
    password
  };
}

function getProxyListFromFile(filePath) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const content = fs.readFileSync(absolutePath, "utf8");

  return content
    .split(/\r?\n/)
    .map(parseProxyLine)
    .filter(Boolean);
}

function getConfiguredProxy() {
  if (env.scraperProxyServer) {
    return {
      server: `${env.scraperProxyProtocol}://${env.scraperProxyServer}`,
      username: env.scraperProxyUsername || undefined,
      password: env.scraperProxyPassword || undefined,
      source: "env"
    };
  }

  if (!env.scraperProxyFile) {
    return null;
  }

  const proxies = getProxyListFromFile(env.scraperProxyFile);
  if (proxies.length === 0) {
    throw new Error(`No proxies found in ${env.scraperProxyFile}`);
  }

  const safeIndex = Math.max(0, Math.min(env.scraperProxyIndex, proxies.length - 1));
  const selected = proxies[safeIndex];

  return {
    server: `${env.scraperProxyProtocol}://${selected.host}:${selected.port}`,
    username: selected.username || undefined,
    password: selected.password || undefined,
    source: "file",
    index: safeIndex
  };
}

module.exports = {
  getConfiguredProxy,
  parseProxyLine
};
