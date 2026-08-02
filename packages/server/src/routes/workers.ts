import { Router } from "express";
import { sessionManager } from "../session-manager.js";

export const workersRouter = Router();

workersRouter.post("/:taskId/cancel", (req, res) => {
  const ok = sessionManager.cancelWorker(req.params["taskId"]!);
  if (!ok) {
    res.status(404).json({ error: "No running worker found for that task" });
    return;
  }
  res.json({ success: true, taskId: req.params["taskId"] });
});
