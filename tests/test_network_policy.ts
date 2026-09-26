/** Deterministic regression tests for the shared SSRF and redirect policy. */
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { isPublicAddress, pinnedFetch, safeFetch, validateNetworkTarget } from '../src/core/network';

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

  // T23.7 closure — DNS rebinding: the preflight sees a public address, the connection
  // would resolve the name again and get loopback. The guarded lookup validates the answer
  // the socket actually uses, so the request fails before any connection is opened.
  let resolutions = 0;
  const rebinding = async () => (++resolutions === 1 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]);
  check('NET.11', await rejects(safeFetch('http://rebind.test/', {}, { lookupHost: rebinding }), /non-public/) && resolutions === 2,
    'rebind after the preflight is denied at connect time (2 resolutions, no connection)');

  // The pinned transport itself, against a real local server (address rule opened for the test).
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.setHeader('x-echo-method', req.method || '');
      res.setHeader('x-echo-encoding', String(req.headers['accept-encoding']));
      res.setHeader('set-cookie', ['a=1', 'b=2']);
      res.end(`body:${body}`);
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  const local = { lookupHost: async () => [{ address: '127.0.0.1', family: 4 }] };
  try {
    // Denied case first: a keep-alive socket opened by the allowed request below would be
    // reused without a new lookup (safe in production, where the address rule never changes).
    check('NET.12', await rejects(pinnedFetch(new URL(`http://service.test:${port}/x`), {}, local), /non-public/) && hits === 0,
      'with the default address rule a loopback answer never reaches the server');
    const ok = await pinnedFetch(new URL(`http://service.test:${port}/x`), { method: 'POST', body: 'ping' }, { ...local, isAllowedAddress: () => true });
    check('NET.13',
      ok.status === 200 && (await ok.text()) === 'body:ping' && ok.headers.get('x-echo-method') === 'POST' && ok.headers.get('x-echo-encoding') === 'identity',
      'pinned transport returns status, headers and streamed body, and asks for identity encoding');
  } finally {
    server.close();
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal test error:', error);
  process.exit(1);
});
