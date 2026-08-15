import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebFetchTool, requestPinnedUrl, validateOutboundUrl } from "./webFetch.js";

const publicResolver = vi.fn(async (_hostname: string) => ["93.184.216.34"]);
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("webFetch outbound policy", () => {
  it("accepts an HTTP URL only when all resolved addresses are public", async () => {
    await expect(validateOutboundUrl("https://example.com/path", publicResolver)).resolves.toEqual(
      new URL("https://example.com/path"),
    );
  });

  it.each([
    "file:///etc/passwd",
    "http://user:password@example.com",
    "http://127.0.0.1/admin",
    "http://[::1]/admin",
  ])("rejects a forbidden URL before fetching: %s", async (url) => {
    await expect(validateOutboundUrl(url, publicResolver)).rejects.toThrow("Refusing outbound URL");
  });

  it("rejects a hostname when DNS includes a private address", async () => {
    const mixedResolver = vi.fn(async () => ["93.184.216.34", "10.0.0.5"]);

    await expect(validateOutboundUrl("https://example.com", mixedResolver)).rejects.toThrow(
      "non-public address",
    );
  });

  it("revalidates redirects before issuing the next request", async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/internal" },
        }),
      ),
    );
    const tool = createWebFetchTool({ fetchImpl, resolveAddresses: publicResolver });

    await expect(tool.execute({ url: "https://example.com", format: "text" })).resolves.toContain(
      "Refusing outbound URL",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("applies the request timeout while resolving DNS", async () => {
    const tool = createWebFetchTool({
      timeoutMs: 10,
      resolveAddresses: async () => new Promise<readonly string[]>(() => undefined),
    });

    const result = await Promise.race([
      tool.execute({ url: "https://example.com", format: "text" }),
      new Promise<string>((_resolve, reject) =>
        setTimeout(() => reject(new Error("webFetch did not settle")), 100),
      ),
    ]);

    expect(result).toContain("timed out");
  });

  it("cancels the final redirect response when the redirect limit is exceeded", async () => {
    const cancellations: Array<ReturnType<typeof vi.fn>> = [];
    const tool = createWebFetchTool({
      resolveAddresses: publicResolver,
      requestImpl: async () => {
        const response = new Response("redirect", {
          status: 302,
          headers: { location: "https://example.com/again" },
        });
        if (!response.body) throw new Error("Expected redirect body");
        const cancel = vi.spyOn(response.body, "cancel");
        cancellations.push(cancel);
        return response;
      },
    });

    await expect(tool.execute({ url: "https://example.com", format: "text" })).resolves.toContain(
      "exceeded 5 redirects",
    );
    expect(cancellations).toHaveLength(6);
    expect(cancellations.every((cancel) => cancel.mock.calls.length === 1)).toBe(true);
  });

  it("cancels bodies that are not consumed after an HTTP error", async () => {
    const response = new Response("denied", { status: 403 });
    if (!response.body) throw new Error("Expected a response body");
    const cancel = vi.spyOn(response.body, "cancel");
    const tool = createWebFetchTool({
      fetchImpl: vi.fn(async () => response),
      resolveAddresses: publicResolver,
    });

    await expect(tool.execute({ url: "https://example.com", format: "text" })).resolves.toContain(
      "HTTP 403",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("passes the validated DNS addresses to the connection implementation", async () => {
    const requestImpl = vi.fn(async () => new Response("ok"));
    const tool = createWebFetchTool({ requestImpl, resolveAddresses: publicResolver });

    await expect(tool.execute({ url: "https://example.com/path", format: "text" })).resolves.toBe(
      "ok",
    );
    expect(requestImpl).toHaveBeenCalledWith(
      new URL("https://example.com/path"),
      ["93.184.216.34"],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("connects to the pinned address while preserving the original Host header", async () => {
    let observedHost: string | undefined;
    const server = createServer((request, response) => {
      observedHost = request.headers.host;
      response.end("pinned");
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected an IP server address");
    const url = new URL(`http://unresolvable.invalid:${address.port}/resource`);

    const response = await requestPinnedUrl(url, ["127.0.0.1"], {});

    await expect(response.text()).resolves.toBe("pinned");
    expect(observedHost).toBe(`unresolvable.invalid:${address.port}`);
  });
});
