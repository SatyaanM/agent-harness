import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";

describe("GET /api/metrics route", () => {
  const app = createApp();

  it("returns Prometheus text format when requested via format=prometheus or text/plain", async () => {
    const res = await request(app).get("/api/metrics?format=prometheus");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("agent_harness_tokens_total");
    expect(res.text).toContain("agent_harness_concurrency_active_runs");

    const res2 = await request(app).get("/api/metrics").set("Accept", "text/plain; version=0.0.4");
    expect(res2.status).toBe(200);
    expect(res2.headers["content-type"]).toContain("text/plain");
  });

  it("returns OpenMetrics text format when requested and terminates with # EOF", async () => {
    const res = await request(app)
      .get("/api/metrics")
      .set("Accept", "application/openmetrics-text; version=1.0.0");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/openmetrics-text");
    expect(res.text.trim().endsWith("# EOF")).toBe(true);

    const res2 = await request(app).get("/api/metrics?format=openmetrics");
    expect(res2.status).toBe(200);
    expect(res2.headers["content-type"]).toContain("application/openmetrics-text");
    expect(res2.text.trim().endsWith("# EOF")).toBe(true);
  });

  it("returns JSON snapshot by default and when Accept application/json is requested", async () => {
    const res = await request(app).get("/api/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).toHaveProperty("loadedSessions");
    expect(res.body).toHaveProperty("agentExecutions");

    const res2 = await request(app).get("/api/metrics").set("Accept", "application/json");
    expect(res2.status).toBe(200);
    expect(res2.headers["content-type"]).toContain("application/json");
  });
});
