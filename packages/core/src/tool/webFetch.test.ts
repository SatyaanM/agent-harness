import { describe, expect, it, vi } from "vitest";
import { createWebFetchTool, validateOutboundUrl } from "./webFetch.js";

const publicResolver = vi.fn(async (_hostname: string) => ["93.184.216.34"]);

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
});
