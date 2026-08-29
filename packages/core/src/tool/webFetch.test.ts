import { describe, expect, it } from "vitest";
import {
  expandIpv6,
  isPublicIp,
  isPublicIpv4,
  isPublicIpv6,
  validateOutboundUrl,
  webFetchTool,
} from "./webFetch";

describe("isPublicIpv4", () => {
  it("allows public IPv4 addresses", () => {
    expect(isPublicIpv4("8.8.8.8")).toBe(true);
    expect(isPublicIpv4("1.1.1.1")).toBe(true);
    expect(isPublicIpv4("142.250.190.46")).toBe(true);
  });

  it("blocks private, loopback, and link-local IPv4 addresses", () => {
    expect(isPublicIpv4("127.0.0.1")).toBe(false);
    expect(isPublicIpv4("10.0.0.1")).toBe(false);
    expect(isPublicIpv4("172.16.0.1")).toBe(false);
    expect(isPublicIpv4("192.168.1.1")).toBe(false);
    expect(isPublicIpv4("169.254.169.254")).toBe(false); // Cloud metadata
    expect(isPublicIpv4("0.0.0.0")).toBe(false);
    expect(isPublicIpv4("224.0.0.1")).toBe(false); // Multicast
  });
});

describe("expandIpv6 and isPublicIpv6", () => {
  it("correctly identifies public and blocked IPv6 addresses", () => {
    const googleV6 = expandIpv6("2607:f8b0:4005:805::200e");
    expect(googleV6).not.toBeNull();
    expect(isPublicIpv6(googleV6!.hextets)).toBe(true);

    const loopback = expandIpv6("::1");
    expect(loopback).not.toBeNull();
    expect(isPublicIpv6(loopback!.hextets)).toBe(false);

    const linkLocal = expandIpv6("fe80::1");
    expect(linkLocal).not.toBeNull();
    expect(isPublicIpv6(linkLocal!.hextets)).toBe(false);

    const uniqueLocal = expandIpv6("fc00::1");
    expect(uniqueLocal).not.toBeNull();
    expect(isPublicIpv6(uniqueLocal!.hextets)).toBe(false);

    const mappedPrivate = expandIpv6("::ffff:192.168.1.1");
    expect(mappedPrivate).not.toBeNull();
    expect(isPublicIpv6(mappedPrivate!.hextets)).toBe(false);

    const nat64Private = expandIpv6("64:ff9b::10.0.0.1");
    expect(nat64Private).not.toBeNull();
    expect(isPublicIpv6(nat64Private!.hextets)).toBe(false);
  });
});

describe("validateOutboundUrl", () => {
  it("rejects non-http/https protocols", async () => {
    expect(await validateOutboundUrl("ftp://example.com")).toBe(
      "Only http and https protocols are supported."
    );
    expect(await validateOutboundUrl("file:///etc/passwd")).toBe(
      "Only http and https protocols are supported."
    );
  });

  it("blocks localhost and local domains", async () => {
    expect(await validateOutboundUrl("http://localhost:3000/api")).toBe(
      "Access to local and private domains is forbidden."
    );
    expect(await validateOutboundUrl("http://service.internal/status")).toBe(
      "Access to local and private domains is forbidden."
    );
  });

  it("blocks direct private IP URLs", async () => {
    expect(await validateOutboundUrl("http://127.0.0.1:8080")).toBe(
      "Access to private network addresses or localhost is forbidden."
    );
    expect(await validateOutboundUrl("http://169.254.169.254/latest/meta-data")).toBe(
      "Access to private network addresses or localhost is forbidden."
    );
  });
});

describe("webFetchTool execution", () => {
  it("returns error on private URL without initiating network request", async () => {
    const res = await webFetchTool.execute({
      url: "http://127.0.0.1:3000/secret",
      format: "text",
    });
    expect(res).toContain("[error]");
    expect(res).toContain("Access to private network addresses or localhost is forbidden.");
  });
});
