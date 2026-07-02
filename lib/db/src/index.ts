/**
 * lib/db/src/index.ts — Database module export that initializes the drizzle ORM instance with connection pooling and re-exports schema definitions.
 * Author: Pasquale Marzaioli
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// max=10 per istanza Vercel. Con max_connections=429 sul Postgres B2s,
// reggiamo ~40 istanze concorrenti prima di toccare il limite. Quando il
// traffico cresce, valutare upgrade tier a General Purpose + PgBouncer
// (PgBouncer non e' disponibile su Burstable).
// idleTimeoutMillis basso (10s) perche' le Vercel function instances
// muoiono in fretta — non vogliamo connessioni morte appese.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("sslmode=") ? undefined : { rejectUnauthorized: true },
  max: 10,
  idleTimeoutMillis: 10_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
