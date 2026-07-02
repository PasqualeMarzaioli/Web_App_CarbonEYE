/**
 * artifacts/api-server/src/index.ts — Server entry point that starts the Express app on a configured port and optionally runs breach log backfill on startup.
 * Author: Pasquale Marzaioli
 */
import app from "./app";
import { staticDir } from "./app";
import { logger } from "./lib/logger";
import { backfillBreachLog } from "./lib/breachLogger";

const rawPort = process.env["PORT"] ?? "3001";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, staticDir }, "Server listening");

  if (process.env.ENABLE_BREACH_BACKFILL === "1") {
    backfillBreachLog().catch((e) => {
      logger.warn({ err: e }, "Breach log backfill failed (non-fatal)");
    });
  }
});
