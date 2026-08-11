import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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

function isPublicIp(address: string): boolean {
  const normalized = address.toLowerCase();
  const version = isIP(normalized);
  if (version === 4) return isPublicIpv4(normalized);
  if (version !== 6) return false;
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("::ffff:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function refused(reason: string): Error {
  return new Error(`Refusing outbound URL: ${reason}`);
}

export async function validateOutboundUrl(
  rawUrl: string | URL,
  resolver: AddressResolver = resolveAddresses,
): Promise<URL> {
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
  const addresses = literalVersion === 0 ? await resolver(hostname) : [hostname];
  if (addresses.length === 0) throw refused(`${hostname} did not resolve to an address`);
  for (const address of addresses) {
    if (!isPublicIp(address)) {
      throw refused(`${hostname} resolved to non-public address ${address}`);
    }
  }
  return url;
}

export function createWebFetchTool(options?: {
  fetchImpl?: FetchImplementation;
  resolveAddresses?: AddressResolver;
}): Tool<typeof WebFetchParams> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const resolver = options?.resolveAddresses ?? resolveAddresses;

  return {
    name: "webFetch",
    description:
      "Fetch public HTTP(S) content. Private networks and oversized responses are blocked.",
    parameters: WebFetchParams,

    async execute(args) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      try {
        let currentUrl = await validateOutboundUrl(args.url, resolver);
        let response: Response | undefined;
        for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
          response = await fetchImpl(currentUrl, {
            signal: controller.signal,
            headers: { "User-Agent": "agent-harness/0.1.0" },
            redirect: "manual",
          });
          if (!REDIRECT_STATUSES.has(response.status)) break;
          const location = response.headers.get("location");
          if (!location) break;
          if (redirects === MAX_REDIRECTS) {
            return `[error] Response exceeded ${MAX_REDIRECTS} redirects.`;
          }
          await response.body?.cancel();
          currentUrl = await validateOutboundUrl(new URL(location, currentUrl), resolver);
        }

        if (!response) return "[error] Request did not produce a response.";
        if (!response.ok) {
          try {
            await response.body?.cancel();
          } catch {}
          return `[error] HTTP ${response.status} ${response.statusText}`;
        }

        const text = await readResponseTextBounded(response, MAX_BODY_BYTES, "web fetch response");

        if (args.format === "json") {
          try {
            return JSON.stringify(parseJsonBoundary(z.unknown(), text, "web fetch JSON"), null, 2);
          } catch {
            return text;
          }
        }
        return text;
      } catch (err: unknown) {
        if (isRecord(err) && err.name === "AbortError") {
          return "[error] Request timed out after 15 seconds.";
        }
        const message = err instanceof Error ? err.message : String(err);
        return `[error] ${message}`;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export const webFetchTool = createWebFetchTool();
