// Single shared Postgres connection pool + a tiny query helper.
// Every other file talks to the database through this one module.
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// Usage: const { rows } = await query("SELECT * FROM articles WHERE id = $1", [id]);
export function query(text, params) {
  return pool.query(text, params);
}

export default pool;
