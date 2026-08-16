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

function isPublicIp(address: string): boolean {
  const normalized = address.toLowerCase();
  const version = isIP(normalized);
  if (version === 4) return isPublicIpv4(normalized);
  if (version !== 6) return false;

  if (normalized.startsWith("::ffff:")) {
    const suffix = normalized.slice(7);
    if (isIP(suffix) === 4) return isPublicIpv4(suffix);
    const parts = suffix.split(":");
    if (parts.length === 2) {
      const high = Number.parseInt(parts[0], 16);
      const low = Number.parseInt(parts[1], 16);
      if (!Number.isNaN(high) && !Number.isNaN(low)) {
        const first = (high >> 8) & 0xff;
        const second = high & 0xff;
        const third = (low >> 8) & 0xff;
        const fourth = low & 0xff;
        return isPublicIpv4(`${first}.${second}.${third}.${fourth}`);
      }
    }
    return false;
  }

  if (normalized.startsWith("::")) {
    return false;
  }

  return !(
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    /^fe[c-f]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:") ||
    normalized.startsWith("64:ff9b:") ||
    normalized.startsWith("2001:2:") ||
    normalized.startsWith("100::")
  );
}

function refused(reason: string): Error {
  return new Error(`Refusing outbound URL: ${reason}`);
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
        let currentTarget = await resolveOutboundUrl(args.url, resolver, signal);
        let response: Response | undefined;
        for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
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
