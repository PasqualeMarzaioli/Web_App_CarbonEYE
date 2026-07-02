#!/usr/bin/env node
/**
 * lib/db/scripts/migrate.cjs — Idempotent SQL migration runner for production Postgres that tracks applied migrations in a journal table and supports baseline and deploy modes.
 * Author: Pasquale Marzaioli
 */
// Idempotent SQL migration runner for the production Postgres.
//
// Why this exists: the migrations under ../migrations are hand-written SQL with no
// drizzle journal, and the early ones (0001-0003) are NOT idempotent (plain ADD
// CONSTRAINT / ADD COLUMN). `drizzle-kit push` diffs the schema and can propose
// destructive changes; `drizzle-kit migrate` needs a meta journal we don't have. This
// runner records each applied file in a `_schema_migrations` table and only ever runs
// files it hasn't run before, each in its own transaction.
//
// Modes:
//   (default)     apply every pending migration in order.
//   --baseline    record every pending migration as applied WITHOUT running it. Use
//                 exactly once, to adopt this runner on a database whose schema already
//                 matches the code (e.g. prod after a manual `drizzle-kit push`).
//   --deploy      same as default, but self-skips on non-production Vercel builds and
//                 when DATABASE_URL is unset, so it can run safely from the Vercel build
//                 command (preview builds and local builds become no-ops).

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const TABLE = "_schema_migrations";
// Fixed key so concurrent runners (e.g. two production builds at once) serialize on a
// Postgres advisory lock instead of racing to apply the same migration twice.
const LOCK_KEY = 4915231;

const isBaseline = process.argv.includes("--baseline");
const isDeploy = process.argv.includes("--deploy");

// In --deploy mode the script is invoked from the Vercel build. Only production should
// touch the production database, and a build without a DATABASE_URL (preview/local) must
// not fail the deploy — it simply has nothing to migrate.
if (isDeploy) {
  if (process.env.VERCEL && process.env.VERCEL_ENV !== "production") {
    console.log(`[migrate] Skipping: VERCEL_ENV=${process.env.VERCEL_ENV || "(unset)"} is not production.`);
    process.exit(0);
  }
  if (!process.env.DATABASE_URL) {
    console.log("[migrate] Skipping: DATABASE_URL is not set.");
    process.exit(0);
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is required.");
  process.exit(1);
}

async function main() {
  // rejectUnauthorized:false: this is an operator-run migration tool connecting to the
  // managed Azure Postgres over TLS. The connection is encrypted; we skip CA chain
  // verification so the tool works regardless of the URL's sslmode.
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      const applied = new Set(
        (await client.query(`SELECT name FROM ${TABLE}`)).rows.map((r) => r.name),
      );
      const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      const pending = files.filter((f) => !applied.has(f));

      if (pending.length === 0) {
        console.log("[migrate] Up to date — no pending migrations.");
        return;
      }

      if (isBaseline) {
        for (const f of pending) {
          await client.query(`INSERT INTO ${TABLE}(name) VALUES ($1) ON CONFLICT DO NOTHING`, [f]);
        }
        console.log(`[migrate] Baselined ${pending.length} migration(s) as already applied:`);
        for (const f of pending) console.log(`  - ${f}`);
        return;
      }

      for (const f of pending) {
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
        process.stdout.write(`[migrate] Applying ${f} ... `);
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query(`INSERT INTO ${TABLE}(name) VALUES ($1)`, [f]);
          await client.query("COMMIT");
          console.log("done");
        } catch (err) {
          await client.query("ROLLBACK");
          console.log("FAILED");
          throw new Error(`${f}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      console.log(`[migrate] Applied ${pending.length} migration(s).`);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[migrate] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
