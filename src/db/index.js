const { Pool } = require("pg");
const { env } = require("../config/env");

let pool = null;

function parseDatabaseUrl(connectionString) {
  try {
    return new URL(connectionString);
  } catch (error) {
    throw new Error("DATABASE_URL is not a valid PostgreSQL connection string");
  }
}

function validateDatabaseUrl(connectionString) {
  const parsed = parseDatabaseUrl(connectionString);
  const databaseName = parsed.pathname.replace(/^\/+/, "").trim();
  const username = decodeURIComponent(parsed.username || "").trim() || "(missing)";
  const hostname = parsed.hostname || "(missing)";

  if (!databaseName) {
    throw new Error(
      `DATABASE_URL is missing a database name. Expected .../${username !== "(missing)" ? "<database>" : "database"}; received host=${hostname} user=${username}`
    );
  }
}

function getPool() {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  if (!pool) {
    validateDatabaseUrl(env.databaseUrl);

    pool = new Pool({
      connectionString: env.databaseUrl,
      ssl:
        env.databaseUrl.includes("localhost") || env.databaseUrl.includes("127.0.0.1")
          ? false
          : { rejectUnauthorized: false }
    });
  }

  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function withClient(callback) {
  const client = await getPool().connect();

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

module.exports = {
  getPool,
  query,
  withClient
};
