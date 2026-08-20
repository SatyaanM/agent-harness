import { SessionRepository } from "@agent-harness/core";
import { Router } from "express";
import { z } from "zod";
import { validateRequest } from "../http/validation.js";
import { sessionManager } from "../session-manager.js";
import {
  concurrencyActiveGauge,
  concurrencyQueueDepthGauge,
  metricRegistry,
  sessionsTotalGauge,
} from "../telemetry/index.js";

export const metricsRouter: Router = Router();

const MetricsQuerySchema = z
  .object({
    format: z.enum(["prometheus", "openmetrics", "json"]).optional(),
  })
  .strict();

metricsRouter.get("/", (req, res) => {
  const query = validateRequest(MetricsQuerySchema, req.query, res);
  if (!query) return;

  const metrics = sessionManager.metrics();
  concurrencyActiveGauge.set(undefined, metrics.agentExecutions.active);
  concurrencyQueueDepthGauge.set(undefined, metrics.agentExecutions.queued);
  sessionsTotalGauge.set({ state: "loaded" }, metrics.loadedSessions);

  const db = sessionManager.getDb();
  if (db) {
    try {
      const sessionRepo = new SessionRepository(db);
      const totalPersisted = sessionRepo.count();
      sessionsTotalGauge.set({ state: "persisted" }, totalPersisted);
    } catch {
      // Non-blocking best-effort
    }
  }

  const accept = req.headers.accept ?? "";
  const format = query.format ?? "";

  if (accept.includes("application/openmetrics-text") || format === "openmetrics") {
    res.setHeader("Content-Type", "application/openmetrics-text; version=1.0.0; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.send(metricRegistry.metrics({ openmetrics: true }));
    return;
  }

  if (
    (accept.includes("text/plain") && !accept.includes("application/json")) ||
    format === "prometheus"
  ) {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.send(metricRegistry.metrics());
    return;
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.json(metrics);
});
