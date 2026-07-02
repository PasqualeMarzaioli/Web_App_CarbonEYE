/**
 * artifacts/api-server/src/routes/index.ts — Main router that composes all domain-specific subrouters (health, auth, submissions, analyze, monitoring, contact, checkout, billing, admin).
 * Author: Pasquale Marzaioli
 */
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import submissionsRouter from "./submissions";
import analyzeRouter from "./analyze";
import monitoringRouter from "./monitoring";
import contactRouter from "./contact";
import adminRouter from "./admin";
import checkoutRouter from "./checkout";
import billingRouter from "./billing";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(submissionsRouter);
router.use(analyzeRouter);
router.use(monitoringRouter);
router.use(contactRouter);
router.use(checkoutRouter);
router.use(billingRouter);
router.use(adminRouter);

export default router;
