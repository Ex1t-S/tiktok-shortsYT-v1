const { Pool } = require("pg");
const { env } = require("../config/env");

let pool = null;

function getPool() {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  if (!pool) {
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
