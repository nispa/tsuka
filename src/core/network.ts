import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { TOOLS_DEFAULTS } from './constants';

export interface NetworkPolicy {
  lookupHost?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  fetch?: typeof globalThis.fetch;
  maxRedirects?: number;
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

  const resolver = policy.lookupHost ?? (async (hostname: string) => lookup(hostname, { all: true, verbatim: true }));
  const addresses = isIP(target.hostname) ? [{ address: target.hostname, family: isIP(target.hostname) }] : await resolver(target.hostname);
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new Error(`Host '${target.hostname}' resolves to a non-public address.`);
  }
}

export async function safeFetch(input: string | URL, init: RequestInit = {}, policy: NetworkPolicy = {}): Promise<Response> {
  const requestFetch = policy.fetch ?? globalThis.fetch;
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
