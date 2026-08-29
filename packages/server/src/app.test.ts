import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp, errorHandler } from "./app.js";
import type { Request, Response, NextFunction } from "express";

describe("GET /api/health", () => {
  it("returns status ok", async () => {
    const res = await request(createApp()).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("errorHandler middleware", () => {
  it("returns 500 JSON when headers have not been sent", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("Something broke");
    const req = {} as Request;
    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    const res = { headersSent: false, status: statusMock } as unknown as Response;
    const next = vi.fn() as NextFunction;

    errorHandler(err, req, res, next);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Something broke" });
    expect(next).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("safely closes response without sending JSON if headers are already sent", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("Stream dropped");
    const req = {} as Request;
    const endMock = vi.fn();
    const statusMock = vi.fn();
    const res = {
      headersSent: true,
      writableEnded: false,
      end: endMock,
      status: statusMock,
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    errorHandler(err, req, res, next);

    expect(statusMock).not.toHaveBeenCalled();
    expect(endMock).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("does not call end if response is already writableEnded", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("Stream dropped");
    const req = {} as Request;
    const endMock = vi.fn();
    const res = {
      headersSent: true,
      writableEnded: true,
      end: endMock,
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    errorHandler(err, req, res, next);

    expect(endMock).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
