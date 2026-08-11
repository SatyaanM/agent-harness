import { Router } from "express";
import { sessionManager } from "../session-manager.js";

export const workersRouter = Router();

workersRouter.post("/:taskId/cancel", (req, res) => {
  const taskId = req.params.taskId;
  if (!taskId) {
    res.status(400).json({ error: "Worker task id is required" });
    return;
  }
  const ok = sessionManager.cancelWorker(taskId);
  if (!ok) {
    res.status(404).json({ error: "No running worker found for that task" });
    return;
  }
  res.json({ success: true, taskId });
});
