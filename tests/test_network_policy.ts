/** Deterministic regression tests for the shared SSRF and redirect policy. */
import { isPublicAddress, safeFetch, validateNetworkTarget } from '../src/core/network';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

async function rejects(task: Promise<unknown>, pattern: RegExp): Promise<boolean> {
  try {
    await task;
    return false;
  } catch (error) {
    return pattern.test(String(error));
  }
}

async function main(): Promise<void> {
  console.log('=== Test shared network SSRF policy ===\n');
  check('NET.1', isPublicAddress('8.8.8.8'), 'public IPv4 is accepted');
  check('NET.2', !isPublicAddress('127.0.0.1') && !isPublicAddress('10.0.0.1'), 'loopback and RFC1918 IPv4 are denied');
  check('NET.3', !isPublicAddress('::1') && !isPublicAddress('fc00::1') && !isPublicAddress('fe80::1'), 'IPv6 loopback, ULA, and link-local are denied');
  check('NET.4', !isPublicAddress('::ffff:192.168.1.1') && isPublicAddress('2001:4860:4860::8888'), 'mapped private IPv4 is denied and global IPv6 is accepted');

  const resolver = async (hostname: string) => hostname === 'mixed.example'
    ? [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]
    : [{ address: '8.8.8.8', family: 4 }];
  check('NET.5', await rejects(validateNetworkTarget(new URL('https://mixed.example'), { lookupHost: resolver }), /non-public/), 'mixed public/private DNS fails closed');
  check('NET.6', await rejects(validateNetworkTarget(new URL('http://example.com:8080'), { lookupHost: resolver }), /port/), 'non-standard port is denied');
  check('NET.7', await rejects(validateNetworkTarget(new URL('file:///etc/passwd'), { lookupHost: resolver }), /scheme/), 'non-HTTP scheme is denied');

  let calls = 0;
  const response = (status: number, location?: string): Response => new Response('', {
    status,
    headers: location ? { location } : undefined,
  });
  const fetchMock: typeof fetch = async (input) => {
    calls++;
    return calls === 1 ? response(302, 'https://safe.example/next') : response(200);
  };
  const redirectResult = await safeFetch('https://start.example', {}, { lookupHost: resolver, fetch: fetchMock });
  check('NET.8', redirectResult.status === 200 && calls === 2, 'redirect is followed through the policy boundary');

  const privateRedirectFetch: typeof fetch = async () => response(302, 'http://127.0.0.1/admin');
  check('NET.9', await rejects(safeFetch('https://safe.example', {}, { lookupHost: resolver, fetch: privateRedirectFetch }), /non-public/), 'public-to-private redirect is denied');

  const loopFetch: typeof fetch = async () => response(302, 'https://safe.example/loop');
  check('NET.10', await rejects(safeFetch('https://safe.example', {}, { lookupHost: resolver, fetch: loopFetch, maxRedirects: 1 }), /redirect limit/), 'redirect loop is bounded');

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal test error:', error);
  process.exit(1);
});
