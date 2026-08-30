import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { z } from "zod";
import { readResponseTextBounded } from "../contracts/http.js";
import { isRecord, parseJsonBoundary } from "../validation.js";
import type { Tool } from "./types.js";

const WebFetchParams = z
  .object({
    url: z.string().url().max(2_048),
    format: z.enum(["text", "json"]).optional().default("text"),
  })
  .strict();

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type AddressResolver = (hostname: string) => Promise<readonly string[]>;
type FetchImplementation = (input: string | URL, init?: RequestInit) => Promise<Response>;
type RequestImplementation = (
  url: URL,
  addresses: readonly string[],
  init: RequestInit,
) => Promise<Response>;

interface ResolvedOutboundUrl {
  url: URL;
  addresses: readonly string[];
}

async function resolveAddresses(hostname: string): Promise<readonly string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

function isPublicIpv4(address: string): boolean {
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

interface Ipv6Parts {
  hextets: number[];
}

function normalizeIpv4Tail(address: string): string | null {
  const match = address.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
  if (!match) return address;

  const octets = match.slice(1).map((digit) => Number.parseInt(digit ?? "", 10));
  if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) return null;
  const [a, b, c, d] = octets;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  const hex = `${(((a << 8) | b) >>> 0).toString(16)}:${(((c << 8) | d) >>> 0).toString(16)}`;
  return `${address.slice(0, match.index ?? 0)}${hex}`;
}

function expandIpv6Groups(address: string): string[] | null {
  const doubleColonIdx = address.indexOf("::");
  if (doubleColonIdx < 0) return address.split(":");

  const head = doubleColonIdx === 0 ? "" : address.slice(0, doubleColonIdx);
  const tail = address.endsWith("::") ? "" : address.slice(doubleColonIdx + 2);
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === "" ? [] : tail.split(":");
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 0) return null;
  return [...headGroups, ...Array(missing).fill("0"), ...tailGroups];
}

function parseIpv6Hextets(groups: readonly string[]): number[] | null {
  if (groups.length !== 8) return null;
  const hextets: number[] = [];
  for (const group of groups) {
    if (group.length === 0 || group.length > 4) return null;
    const parsed = Number.parseInt(group, 16);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 0xffff) return null;
    hextets.push(parsed);
  }
  return hextets;
}

/**
 * Expand any IPv6 text representation to 8 16-bit hextets.
 *
 * `node:net`'s `isIP` accepts many textual forms (e.g. `::1`, `0:0:0:0:0:ffff:7f00:1`,
 * `::ffff:127.0.0.1`, `::7f00:1`, `2002:c0a8:101::`, `64:ff9b::192.168.1.1`),
 * but each of those addresses can be expressed in multiple textual forms that map
 * to the same bytes. A prefix-based filter is only safe when every form of an
 * address is recognized. Expanding first lets the filter reason about bits
 * instead of strings.
 */
function expandIpv6(address: string): Ipv6Parts | null {
  // Normalize embedded IPv4 first: when the last 32 bits are dotted-quad, the
  // text allows either `::a.b.c.d`, `::ffff:a.b.c.d`, `::w.xy:z` or even a
  // leading `0:0:0:0:0:0:w.x.y.z`. Convert those to 32-bit integers so the
  // generic hextet parser below sees only hex pairs.
  const normalized = normalizeIpv4Tail(address);
  if (!normalized) return null;

  // Strip optional zone id (RFC 4007 / RFC 6874) like `fe80::1%eth0`.
  const zoneIdx = normalized.indexOf("%");
  const withoutZone = zoneIdx >= 0 ? normalized.slice(0, zoneIdx) : normalized;
  const groups = expandIpv6Groups(withoutZone);
  if (!groups) return null;

  const hextets = parseIpv6Hextets(groups);
  return hextets ? { hextets } : null;
}

/**
 * Compare the first `prefixBits` bits of two 128-bit addresses (split across
 * 8 16-bit hextets). `prefixBits` MAY be any value from 0..128 — partial-byte
 * prefixes are compared on the high bits of the boundary hextet.
 */
function hasIpv6Prefix(
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

function isPublicIpv6(hextets: readonly number[]): boolean {
  // Unspecified `::` (all zero) — RFC 4291 §2.5.2.
  if (hextets.every((value) => value === 0)) return false;
  // Loopback `::1` — RFC 4291 §2.5.3.
  if (hextets.slice(0, 7).every((value) => value === 0) && hextets[7] === 1) {
    return false;
  }

  // IPv4-compatible IPv6 (deprecated RFC 4291 §2.5.5.1 form): `::w.x.y.z` with
  // hextets 0-5 zero and a non-zero IPv4 in hextets 6-7. Decision reduces to
  // the embedded IPv4.
  if (hextets.slice(0, 6).every((value) => value === 0)) {
    return isPublicIpv4(embeddedIpv4(hextets));
  }

  // RFC 4291 §2.5.5.2 IPv4-mapped `::ffff:w.x.y.z` — hextets 0-4 zero and
  // hextet 5 = 0xffff. Decision reduces to the embedded IPv4.
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

  // 6to4 (RFC 3056): 2002::/16 — the embedded IPv4 lives in hextets 1-2.
  // Format: `2002:WWXX:YYZZ::/48` where WWXX:YYZZ is the 32-bit IPv4.
  if (hasIpv6Prefix(hextets, [0x2002, 0, 0, 0, 0, 0, 0, 0], 16)) {
    const hi = hextets[1] ?? 0;
    const lo = hextets[2] ?? 0;
    return isPublicIpv4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
  }

  // NAT64 well-known prefix (RFC 6052): 64:ff9b::/96. Hextets 0-5 must match
  // and the embedded IPv4 lives in hextets 6-7.
  if (hasIpv6Prefix(hextets, [0x0064, 0xff9b, 0, 0, 0, 0, 0, 0], 96)) {
    return isPublicIpv4(embeddedIpv4(hextets));
  }

  // 64:ff9b:1::/48 — RFC 8215 / local NAT64 prefix. Same handling.
  if (hasIpv6Prefix(hextets, [0x0064, 0xff9b, 0x0001, 0, 0, 0, 0, 0], 48)) {
    return isPublicIpv4(embeddedIpv4(hextets));
  }

  // Unique-local (RFC 4193): fc00::/7.
  if (hasIpv6Prefix(hextets, [0xfc00, 0, 0, 0, 0, 0, 0, 0], 7)) return false;
  // Link-local (RFC 4291): fe80::/10.
  if (hasIpv6Prefix(hextets, [0xfe80, 0, 0, 0, 0, 0, 0, 0], 10)) return false;
  // Site-local, deprecated (RFC 3513, obsoleted by RFC 3879 but still recognized
  // by some stacks): fec0::/10.
  if (hasIpv6Prefix(hextets, [0xfec0, 0, 0, 0, 0, 0, 0, 0], 10)) return false;
  // Multicast (RFC 4291): ff00::/8.
  if (hasIpv6Prefix(hextets, [0xff00, 0, 0, 0, 0, 0, 0, 0], 8)) return false;
  // Discard prefix (RFC 6666): 100::/64.
  if (hasIpv6Prefix(hextets, [0x0100, 0, 0, 0, 0, 0, 0, 0], 64)) return false;
  // Documentation (RFC 3849): 2001:db8::/32.
  if (hasIpv6Prefix(hextets, [0x2001, 0x0db8, 0, 0, 0, 0, 0, 0], 32)) return false;
  // Teredo client (RFC 4380): 2001::/32. Block the full /32 — only the
  // server-side subset is normally reachable and conservative blocking costs
  // nothing.
  if (hasIpv6Prefix(hextets, [0x2001, 0, 0, 0, 0, 0, 0, 0], 32)) return false;

  return true;
}

function isPublicIp(address: string): boolean {
  const normalized = address.toLowerCase();
  const version = isIP(normalized);
  if (version === 4) return isPublicIpv4(normalized);
  if (version !== 6) return false;
  const parts = expandIpv6(normalized);
  if (!parts) return false;
  return isPublicIpv6(parts.hextets);
}

function refused(reason: string): Error {
  return new Error(`Refusing outbound URL: ${reason}`);
}

async function requestWithRedirects(
  requestImpl: RequestImplementation,
  rawUrl: string,
  resolver: AddressResolver,
  signal: AbortSignal,
): Promise<Response | string> {
  let currentTarget = await resolveOutboundUrl(rawUrl, resolver, signal);
  let response: Response | undefined;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    response = await requestImpl(currentTarget.url, currentTarget.addresses, {
      signal,
      headers: { "User-Agent": "agent-harness/0.1.0" },
      redirect: "manual",
    });
    if (!REDIRECT_STATUSES.has(response.status)) break;
    const location = response.headers.get("location");
    if (!location) break;
    if (redirects === MAX_REDIRECTS) {
      await response.body?.cancel();
      return `[error] Response exceeded ${MAX_REDIRECTS} redirects.`;
    }
    await response.body?.cancel();
    currentTarget = await resolveOutboundUrl(
      new URL(location, currentTarget.url),
      resolver,
      signal,
    );
  }
  return response ?? "[error] Request did not produce a response.";
}

async function formatWebFetchResponse(
  response: Response,
  format: "text" | "json",
): Promise<string> {
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {}
    return `[error] HTTP ${response.status} ${response.statusText}`;
  }

  const text = await readResponseTextBounded(response, MAX_BODY_BYTES, "web fetch response");
  if (format !== "json") return text;
  try {
    return JSON.stringify(parseJsonBoundary(z.unknown(), text, "web fetch JSON"), null, 2);
  } catch {
    return text;
  }
}

export async function validateOutboundUrl(
  rawUrl: string | URL,
  resolver: AddressResolver = resolveAddresses,
): Promise<URL> {
  return (await resolveOutboundUrl(rawUrl, resolver)).url;
}

async function resolveOutboundUrl(
  rawUrl: string | URL,
  resolver: AddressResolver,
  signal?: AbortSignal,
): Promise<ResolvedOutboundUrl> {
  const url = rawUrl instanceof URL ? new URL(rawUrl.href) : new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw refused(`protocol ${url.protocol} is not allowed`);
  }
  if (url.username || url.password) {
    throw refused("embedded credentials are not allowed");
  }

  const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw refused("localhost is not allowed");
  }

  const literalVersion = isIP(hostname);
  const addresses =
    literalVersion === 0 ? await waitForAbort(resolver(hostname), signal) : [hostname];
  if (addresses.length === 0) throw refused(`${hostname} did not resolve to an address`);
  for (const address of addresses) {
    if (!isPublicIp(address)) {
      throw refused(`${hostname} resolved to non-public address ${address}`);
    }
  }
  return { url, addresses };
}

export function createWebFetchTool(options?: {
  fetchImpl?: FetchImplementation;
  requestImpl?: RequestImplementation;
  resolveAddresses?: AddressResolver;
  timeoutMs?: number;
}): Tool<typeof WebFetchParams> {
  const resolver = options?.resolveAddresses ?? resolveAddresses;
  const requestImpl: RequestImplementation = options?.requestImpl
    ? options.requestImpl
    : options?.fetchImpl
      ? (url, _addresses, init) =>
          options.fetchImpl?.(url, init) ??
          Promise.reject(new Error("Missing fetch implementation"))
      : requestPinnedUrl;

  return {
    name: "webFetch",
    description:
      "Fetch public HTTP(S) content. Private networks and oversized responses are blocked.",
    parameters: WebFetchParams,

    async execute(args, context) {
      const controller = new AbortController();
      const timeoutMs = options?.timeoutMs ?? 15_000;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const signal = context?.signal
        ? AbortSignal.any([context.signal, controller.signal])
        : controller.signal;

      try {
        const response = await requestWithRedirects(requestImpl, args.url, resolver, signal);
        if (typeof response === "string") return response;
        return formatWebFetchResponse(response, args.format);
      } catch (err: unknown) {
        if (isRecord(err) && err.name === "AbortError") {
          return `[error] Request timed out after ${timeoutMs}ms.`;
        }
        const message = err instanceof Error ? err.message : String(err);
        return `[error] ${message}`;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function waitForAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function abortError(): Error {
  const error = new Error("Operation aborted");
  error.name = "AbortError";
  return error;
}

export const webFetchTool = createWebFetchTool();

export async function requestPinnedUrl(
  url: URL,
  addresses: readonly string[],
  init: RequestInit,
): Promise<Response> {
  const address = addresses[0];
  if (!address) throw refused(`${url.hostname} did not resolve to an address`);
  const family = isIP(address);
  if (family !== 4 && family !== 6) throw refused(`invalid resolved address ${address}`);
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<Response>((resolve, reject) => {
    const outgoing = request(
      url,
      {
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        method: init.method ?? "GET",
        signal: init.signal ?? undefined,
        lookup(_hostname, options, callback) {
          if (typeof options === "object" && options.all) {
            callback(null, [{ address, family }]);
            return;
          }
          callback(null, address, family);
        },
      },
      (incoming) => {
        const headers = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          const name = incoming.rawHeaders[index];
          const value = incoming.rawHeaders[index + 1];
          if (name !== undefined && value !== undefined) headers.append(name, value);
        }
        const status = incoming.statusCode ?? 500;
        const hasBody = status !== 101 && status !== 204 && status !== 205 && status !== 304;
        const body = hasBody ? Readable.toWeb(incoming) : null;
        resolve(
          new Response(body, {
            status,
            statusText: incoming.statusMessage,
            headers,
          }),
        );
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}
