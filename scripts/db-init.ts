/**
 * Applies drizzle/migrations/0000_init.sql directly via pg.
 * Run with:  npm run db:init
 */
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env");
  process.exit(1);
}

const sqlPath = path.join(__dirname, "../drizzle/migrations/0000_init.sql");
const sql = fs.readFileSync(sqlPath, "utf-8");

const pool = new Pool({ connectionString: DATABASE_URL });

async function run(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log("Applying 0000_init.sql...");
    await client.query(sql);
    console.log("✓ Migration applied successfully.");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
