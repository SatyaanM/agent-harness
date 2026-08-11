import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { describe, it } from "vitest";
import { asyncHandler } from "./async-handler.js";

describe("asyncHandler", () => {
  it("forwards rejected route promises to Express error middleware", async () => {
    const app = express();
    app.get(
      "/failure",
      asyncHandler(async () => {
        throw new Error("route failure");
      }),
    );
    app.use((_error: unknown, _request: Request, response: Response, _next: NextFunction) => {
      response.status(500).json({ error: "handled" });
    });

    await request(app).get("/failure").expect(500, { error: "handled" });
  });
});
