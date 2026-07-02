/**
 * artifacts/api-server/src/routes/health.ts — Health check endpoint returning a simple 'ok' status for monitoring.
 * Author: Pasquale Marzaioli
 */
import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
