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

  it("accepts a 6to4 address whose embedded IPv4 is public", async () => {
    // Regression: previously the 6to4 branch read the wrong hextet positions
    // and read 0.0.0.0 from the trailing zeros, blocking ALL 6to4 addresses
    // indiscriminately. RFC 3056 says decision should reduce to the IPv4 in
    // hextets 2-3 — so a public address there must remain public.
    await expect(
      validateOutboundUrl("http://[2002:0808:0808::]/admin", publicResolver),
    ).resolves.toEqual(new URL("http://[2002:0808:0808::]/admin"));
  });

  it("accepts a NAT64 well-known prefix whose embedded IPv4 is public", async () => {
    // The well-known NAT64 prefix maps an IPv4 inside NAT64 into the IPv6
    // space; a public embedded address must remain reachable when the
    // synthesised IPv4 is itself a public address.
    await expect(
      validateOutboundUrl("http://[64:ff9b::8.8.8.8]/admin", publicResolver),
    ).resolves.toEqual(new URL("http://[64:ff9b::808:808]/admin"));
  });

  it.each([
    "file:///etc/passwd",
    "http://user:password@example.com",
    "http://127.0.0.1/admin",
    "http://[::1]/admin",
    "http://[::127.0.0.1]/admin",
    "http://[::169.254.169.254]/latest/meta-data",
    "http://[::ffff:127.0.0.1]/admin",
    "http://[fec0::1]/internal",
    // Fully-expanded IPv4-mapped IPv6 forms (canonical text for ::ffff:wxyz).
    // The URL parser already normalizes these into the canonical ::ffff:wxyz
    // form, but the SSRF classifier must remain robust when called directly
    // with arbitrary textual input — e.g. from a future caller that resolves
    // an address via a non-URL-aware path.
    "http://[0:0:0:0:0:ffff:7f00:1]/admin",
    "http://[0000:0000:0000:0000:0000:ffff:7f00:0001]/admin",
    // IPv4-compatible IPv6 (deprecated RFC 4291 §2.5.5.1 form).
    "http://[::7f00:1]/admin",
    "http://[0:0:0:0:0:0:7f00:1]/admin",
    // 6to4 (RFC 3056): 2002::/16 — embed 192.168.1.1 and 10.0.0.1, both private.
    "http://[2002:c0a8:101::]/admin",
    "http://[2002:0a00:0001::]/admin",
    // NAT64 well-known prefix (RFC 6052): 64:ff9b::/96 — embed private IPv4.
    "http://[64:ff9b::192.168.1.1]/admin",
    // NAT64 local prefix (RFC 8215): 64:ff9b:1::/48.
    "http://[64:ff9b:1::192.168.1.1]/admin",
    // Documentation prefix (RFC 3849).
    "http://[2001:db8::1]/admin",
    // Discard-only prefix (RFC 6666): 100::/64 — block the whole subnet.
    "http://[100::1]/admin",
    // Link-local (RFC 4291).
    "http://[fe80::1]/admin",
    // Teredo (RFC 4380): 2001::/32.
    "http://[2001::1]/admin",
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
