import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import type { Tool } from "./types.js";

const WebFetchParams = z.object({
  url: z.string().url(),
  format: z.enum(["text", "json"]).optional().default("text"),
});

const MAX_BODY_BYTES = 1024 * 1024;

export function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first, second, third] = parts;
  if (first === undefined || second === undefined || third === undefined) return false;
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

export function expandIpv6(address: string): { hextets: number[] } | null {
  const ipv4Tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u;
  const match = address.match(ipv4Tail);
  let normalized = address;
  if (match) {
    const firstDigit = match[1] ?? "";
    const secondDigit = match[2] ?? "";
    const thirdDigit = match[3] ?? "";
    const fourthDigit = match[4] ?? "";
    const octets: Array<number | null> = [firstDigit, secondDigit, thirdDigit, fourthDigit].map(
      (digit) => {
        const value = Number.parseInt(digit, 10);
        return Number.isNaN(value) || value < 0 || value > 255 ? null : value;
      },
    );
    if (octets.some((value) => value === null)) return null;
    const a = octets[0] ?? 0;
    const b = octets[1] ?? 0;
    const c = octets[2] ?? 0;
    const d = octets[3] ?? 0;
    const hex = `${(((a << 8) | b) >>> 0).toString(16)}:${(((c << 8) | d) >>> 0).toString(16)}`;
    normalized = `${address.slice(0, match.index)}${hex}`;
  }

  if (normalized.includes(":")) {
    const zoneIdx = normalized.indexOf("%");
    if (zoneIdx >= 0) normalized = normalized.slice(0, zoneIdx);
  }

  const doubleColonIdx = normalized.indexOf("::");
  let groups: string[];
  if (doubleColonIdx >= 0) {
    const head = doubleColonIdx === 0 ? "" : normalized.slice(0, doubleColonIdx);
    const tail = normalized.endsWith("::") ? "" : normalized.slice(doubleColonIdx + 2);
    const headGroups = head === "" ? [] : head.split(":");
    const tailGroups = tail === "" ? [] : tail.split(":");
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 0) return null;
    groups = [...headGroups, ...Array(missing).fill("0"), ...tailGroups];
  } else {
    groups = normalized.split(":");
  }

  if (groups.length !== 8) return null;
  const hextets: number[] = [];
  for (const group of groups) {
    if (group.length === 0 || group.length > 4) return null;
    const parsed = Number.parseInt(group, 16);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 0xffff) return null;
    hextets.push(parsed);
  }
  return { hextets };
}

export function hasIpv6Prefix(
  hextets: readonly number[],
  prefixHextets: readonly number[],
  prefixBits: number,
): boolean {
  if (prefixBits > 128 || prefixBits < 0) return false;
  const fullHextets = Math.floor(prefixBits / 16);
  for (let index = 0; index < fullHextets; index += 1) {
    if (hextets[index] !== prefixHextets[index]) return false;
  }
  const remBits = prefixBits - fullHextets * 16;
  if (remBits === 0) return true;
  const mask = ((0xffff << (16 - remBits)) & 0xffff) >>> 0;
  const hextet = hextets[fullHextets];
  const prefixHextet = prefixHextets[fullHextets];
  if (hextet === undefined || prefixHextet === undefined) return false;
  return (hextet & mask) === (prefixHextet & mask);
}

function embeddedIpv4(hextets: readonly number[]): string {
  const last = hextets[hextets.length - 2] ?? 0;
  const final = hextets[hextets.length - 1] ?? 0;
  return `${(last >> 8) & 0xff}.${last & 0xff}.${(final >> 8) & 0xff}.${final & 0xff}`;
}

export function isPublicIpv6(hextets: readonly number[]): boolean {
  if (hextets.every((value) => value === 0)) return false;
  if (hextets.slice(0, 7).every((value) => value === 0) && hextets[7] === 1) {
    return false;
  }
  if (hextets.slice(0, 6).every((value) => value === 0)) {
    return isPublicIpv4(embeddedIpv4(hextets));
  }
  if (
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0xffff
  ) {
    return isPublicIpv4(embeddedIpv4(hextets));
  }
  if (
    hextets[0] === 0x0064 &&
    hextets[1] === 0xff9b &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0
  ) {
    return isPublicIpv4(embeddedIpv4(hextets));
  }
  if (hextets[0] === 0x2002) {
    const second = hextets[1] ?? 0;
    const third = hextets[2] ?? 0;
    const v4 = `${(second >> 8) & 0xff}.${second & 0xff}.${(third >> 8) & 0xff}.${third & 0xff}`;
    return isPublicIpv4(v4);
  }
  if (hasIpv6Prefix(hextets, [0xfc00, 0, 0, 0, 0, 0, 0, 0], 7)) return false;
  if (hasIpv6Prefix(hextets, [0xfe80, 0, 0, 0, 0, 0, 0, 0], 10)) return false;
  if (hasIpv6Prefix(hextets, [0xfec0, 0, 0, 0, 0, 0, 0, 0], 10)) return false;
  if (hasIpv6Prefix(hextets, [0x0100, 0, 0, 0, 0, 0, 0, 0], 64)) return false;
  if (hasIpv6Prefix(hextets, [0x2001, 0x0db8, 0, 0, 0, 0, 0, 0], 32)) return false;
  if (hasIpv6Prefix(hextets, [0xff00, 0, 0, 0, 0, 0, 0, 0], 8)) return false;

  return true;
}

export function isPublicIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPublicIpv4(ip);
  if (version === 6) {
    const parts = expandIpv6(ip);
    return parts ? isPublicIpv6(parts.hextets) : false;
  }
  return false;
}

export async function validateOutboundUrl(targetUrl: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return "Invalid URL format.";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http and https protocols are supported.";
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return "Access to local and private domains is forbidden.";
  }

  if (isIP(hostname)) {
    if (!isPublicIp(hostname)) {
      return "Access to private network addresses or localhost is forbidden.";
    }
    return null;
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0) {
      return "Unable to resolve hostname.";
    }
    for (const entry of addresses) {
      if (!isPublicIp(entry.address)) {
        return "Access to private network addresses or localhost is forbidden.";
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `DNS resolution failed: ${message}`;
  }

  return null;
}

export const webFetchTool: Tool<typeof WebFetchParams> = {
  name: "webFetch",
  description: "Fetch content from a URL. Returns the response body as text or JSON.",
  parameters: WebFetchParams,

  async execute(args) {
    const validationError = await validateOutboundUrl(args.url);
    if (validationError) {
      return `[error] ${validationError}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(args.url, {
        signal: controller.signal,
        headers: { "User-Agent": "agent-harness/0.1.0" },
        redirect: "follow",
      });

      if (!res.ok) {
        return `[error] HTTP ${res.status} ${res.statusText}`;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        return "[error] Response has no body.";
      }

      const chunks: Uint8Array[] = [];
      let total = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          reader.cancel().catch(() => {});
          return "[error] Response body exceeds maximum size (1 MB).";
        }
      }

      const decoder = new TextDecoder("utf-8", { fatal: false });
      const text = chunks.map((c) => decoder.decode(c)).join("");

      if (args.format === "json") {
        try {
          const parsed = JSON.parse(text);
          return JSON.stringify(parsed, null, 2);
        } catch {
          return text;
        }
      }

      return text;
    } catch (err: unknown) {
      const e = err as { name?: string; message: string };
      if (e.name === "AbortError") {
        return "[error] Request timed out after 15 seconds.";
      }
      return `[error] ${e.message}`;
    } finally {
      clearTimeout(timeout);
    }
  },
};
