import { lookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP, LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import { TOOLS_DEFAULTS } from './constants';

type HostResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export interface NetworkPolicy {
  lookupHost?: HostResolver;
  /** Test seam for the address rule; defaults to isPublicAddress. */
  isAllowedAddress?: (address: string) => boolean;
  /** Test seam replacing the pinned transport; production requests never set it. */
  fetch?: typeof globalThis.fetch;
  maxRedirects?: number;
}

const systemResolver: HostResolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

let defaultPolicy: NetworkPolicy = {};

/**
 * Replaces the policy used when a caller passes none, returning a restore function.
 * Tools call safeFetch without a policy, so this is how their tests supply a fake
 * transport and resolver instead of patching globalThis.fetch — which the pinned
 * transport no longer uses — or depending on live DNS.
 */
export function overrideDefaultNetworkPolicy(policy: NetworkPolicy): () => void {
  const previous = defaultPolicy;
  defaultPolicy = policy;
  return () => {
    defaultPolicy = previous;
  };
}

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((value, part) => ((value * 256) + Number(part)) >>> 0, 0);
}

function isDeniedIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  const ranges: Array<[number, number]> = [
    [0x00000000, 0xff000000], [0x0a000000, 0xff000000], [0x64400000, 0xffc00000],
    [0x7f000000, 0xff000000], [0xa9fe0000, 0xffff0000], [0xac100000, 0xfff00000],
    [0xc0000000, 0xffffff00], [0xc0000200, 0xffffff00], [0xc0a80000, 0xffff0000],
    [0xc6120000, 0xfffe0000], [0xc6336400, 0xffffff00], [0xcb007100, 0xffffff00],
    [0xe0000000, 0xf0000000], [0xf0000000, 0xf0000000],
  ];
  return ranges.some(([network, mask]) => ((value & mask) >>> 0) === (network >>> 0));
}

function isDeniedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7);
    return isIP(mapped) === 4 && isDeniedIpv4(mapped);
  }
  // Only global unicast (2000::/3) is routable on the public Internet.
  if (!normalized.startsWith('2') && !normalized.startsWith('3')) return true;
  if (normalized.startsWith('2001:db8:') || normalized.startsWith('2001:0db8:')) return true;
  return false;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !isDeniedIpv4(address);
  if (family === 6) return !isDeniedIpv6(address);
  return false;
}

export async function validateNetworkTarget(target: URL, policy: NetworkPolicy = {}): Promise<void> {
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`URL scheme '${target.protocol}' is not allowed.`);
  }
  const expectedPort = target.protocol === 'http:' ? '80' : '443';
  if (target.port && target.port !== expectedPort) {
    throw new Error(`URL port '${target.port}' is not allowed by the HTTP policy.`);
  }

  const resolver = policy.lookupHost ?? systemResolver;
  const addresses = isIP(target.hostname) ? [{ address: target.hostname, family: isIP(target.hostname) }] : await resolver(target.hostname);
  const allowed = policy.isAllowedAddress ?? isPublicAddress;
  if (!addresses.length || addresses.some((entry) => !allowed(entry.address))) {
    throw new Error(`Host '${target.hostname}' resolves to a non-public address.`);
  }
}

/**
 * DNS lookup performed by the socket itself. The preflight in validateNetworkTarget
 * resolves the name once, but fetch would resolve it again when connecting — a DNS
 * rebinding server can answer "public" to the first query and "127.0.0.1" to the
 * second. Validating here, on the very answer the connection uses, closes that window.
 */
function guardedLookup(resolver: HostResolver, allowed: (address: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    const deny = (error: Error) => (callback as (err: NodeJS.ErrnoException | null, address: string, family: number) => void)(error, '', 0);
    resolver(hostname).then((addresses) => {
      if (!addresses.length || addresses.some((entry) => !allowed(entry.address))) {
        deny(new Error(`Host '${hostname}' resolves to a non-public address.`));
      } else if (options.all) {
        // Happy-eyeballs connections ask for every address; all of them passed the check.
        (callback as (err: null, addresses: Array<{ address: string; family: number }>) => void)(null, addresses);
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    }, deny);
  };
}

/**
 * Minimal fetch over node:http(s) with the guarded lookup; global fetch cannot take a
 * custom resolver without an external dispatcher. Redirects are never followed here —
 * safeFetch walks them so every hop is validated.
 */
export function pinnedFetch(target: URL, init: RequestInit, policy: NetworkPolicy = {}): Promise<Response> {
  if (init.body != null && typeof init.body !== 'string') {
    return Promise.reject(new Error('The HTTP safety boundary only sends string request bodies.'));
  }
  const headers = new Headers(init.headers);
  // fetch decompresses transparently, a raw socket does not: ask for identity so callers
  // reading text or streaming bytes to disk always get the plain payload.
  headers.set('accept-encoding', 'identity');
  const client = target.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request(
      target,
      {
        method: init.method ?? 'GET',
        headers: Object.fromEntries(headers),
        lookup: guardedLookup(policy.lookupHost ?? systemResolver, policy.isAllowedAddress ?? isPublicAddress),
        signal: init.signal ?? undefined,
      },
      (response) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) responseHeaders.append(name, item);
        }
        const status = response.statusCode ?? 502;
        const hasBody = status !== 204 && status !== 304 && init.method !== 'HEAD';
        resolve(new Response(hasBody ? (Readable.toWeb(response) as ReadableStream) : null, {
          status,
          statusText: response.statusMessage,
          headers: responseHeaders,
        }));
      }
    );
    request.on('error', reject);
    request.end(init.body ?? undefined);
  });
}

export async function safeFetch(input: string | URL, init: RequestInit = {}, callerPolicy: NetworkPolicy = {}): Promise<Response> {
  const policy: NetworkPolicy = { ...defaultPolicy, ...callerPolicy };
  const requestFetch = policy.fetch ?? ((url: string | URL | Request, options?: RequestInit) => pinnedFetch(new URL(url.toString()), options ?? {}, policy));
  const maxRedirects = policy.maxRedirects ?? TOOLS_DEFAULTS.httpMaxRedirects;
  let target = new URL(input.toString());

  for (let redirect = 0; ; redirect++) {
    await validateNetworkTarget(target, policy);
    const response = await requestFetch(target, { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    if (redirect >= maxRedirects) throw new Error(`HTTP redirect limit (${maxRedirects}) exceeded.`);
    target = new URL(location, target);
  }
}
