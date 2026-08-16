import { Router } from "express";
import { z } from "zod";
import { IdentifierSchema, validateRequest } from "../http/validation.js";
import { sessionManager } from "../session-manager.js";

export const workersRouter = Router();
const WorkerParamsSchema = z.object({ taskId: IdentifierSchema }).strict();

workersRouter.post("/:taskId/cancel", (req, res) => {
  const params = validateRequest(WorkerParamsSchema, req.params, res);
  if (!params) return;
  const { taskId } = params;
  const ok = sessionManager.cancelWorker(taskId);
  if (!ok) {
    res.status(404).json({ error: "No running worker found for that task" });
    return;
  }
  res.json({ success: true, taskId });
});
