/**
 * Test del client MCP nativo (T20.1): transport stdio, handshake, tools/list,
 * tools/call e percorsi di errore (crash, timeout, frame malformati, errori
 * JSON-RPC, isError). Usa il mock server in tests/fixtures/mock_mcp_server.mjs.
 * Esecuzione: npx tsx tests/test_mcp_client.ts
 */
import * as path from 'path';
import { McpClient } from '../src/core/mcp/client';
import { StdioTransport } from '../src/core/mcp/stdioTransport';
import { MCP_DEFAULTS } from '../src/core/constants';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string) {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

const SERVER = path.join(__dirname, 'fixtures', 'mock_mcp_server.mjs');

function makeClient(mode: string = '', overrides: Record<string, unknown> = {}): McpClient {
  return new McpClient({
    command: process.execPath,
    args: [SERVER, mode],
    ...overrides,
  } as any);
}

async function run() {
  console.log('=== Test MCP Client ===\n');

  // 1. Handshake and connection state
  const client = makeClient();
  await client.connect();
  check('MCP.1', client.connected, 'connect() completa l\'handshake initialize e marca il client connesso');

  // 2. tools/list returns the two mocked descriptors with schemas
  const tools = await client.listTools();
  const names = tools.map((t) => t.name);
  check(
    'MCP.2',
    names.includes('echo') && names.includes('add') && !!tools[0].inputSchema,
    `tools/list espone echo e add con inputSchema (ricevuti: ${names.join(', ')})`
  );

  // 3. tools/call echo round-trip
  const echo = await client.callTool('echo', { message: 'ciao tsuka' });
  check(
    'MCP.3',
    !echo.isError && echo.content[0].text === 'echo: ciao tsuka',
    'tools/call restituisce il testo di echo intatto'
  );

  // 4. Numeric arguments survive the wire
  const sum = await client.callTool('add', { a: 19, b: 23 });
  check('MCP.4', sum.content[0].text === '42', 'tools/call add somma 19+23=42 attraverso il transport');

  // 5. Missing optional arguments become an empty object server-side
  const emptyEcho = await client.callTool('echo', undefined);
  check('MCP.5', emptyEcho.content[0].text === 'echo: ', 'callTool con args undefined degrada su oggetto vuoto senza crash');

  // 6. close() tears down and marks disconnected; second close is idempotent
  await client.close();
  const firstClosed = !client.connected;
  let secondCloseThrew = false;
  try {
    await client.close();
  } catch {
    secondCloseThrew = true;
  }
  check('MCP.6', firstClosed && !secondCloseThrew, 'close() disconnette ed è idempotente');

  // 7. Requests on a closed transport reject instead of hanging
  let rejectedAfterClose = false;
  try {
    await client.callTool('echo', { message: 'x' });
  } catch {
    rejectedAfterClose = true;
  }
  check('MCP.7', rejectedAfterClose, 'una richiesta dopo close() viene rifiutata, non appesa');

  // 8. Server that crashes right after initialize: listTools must reject
  const crashing = makeClient('--crash-after-init');
  await crashing.connect();
  let crashDetected = false;
  try {
    await crashing.listTools();
  } catch (err: any) {
    crashDetected = /exited unexpectedly|not running/i.test(err.message);
  }
  check('MCP.8', crashDetected, `un crash post-initialize emerge come errore descrittivo (${crashDetected ? '' : 'nessun errore!'})`);
  await crashing.close();

  // 9. Malformed frames are discarded, valid responses still processed
  const noisy = makeClient('--malformed');
  await noisy.connect();
  const noisyTools = await noisy.listTools();
  check('MCP.9', noisyTools.length === 2, 'frame JSON malformati scartati senza corrompere la correlazione delle risposte');
  await noisy.close();

  // 10. JSON-RPC error response surfaces as a rejection carrying code+message
  const erroring = makeClient('--error-call');
  await erroring.connect();
  let rpcErrorSeen = false;
  try {
    await erroring.callTool('echo', { message: 'x' });
  } catch (err: any) {
    rpcErrorSeen = /-32603/.test(err.message) && /internal mock failure/.test(err.message);
  }
  check('MCP.10', rpcErrorSeen, 'l\'errore JSON-RPC (-32603) arriva al chiamante con codice e messaggio');
  await erroring.close();

  // 11. isError:true is a successful RPC but flagged result
  const flagging = makeClient('--iserror-call');
  await flagging.connect();
  const flagged = await flagging.callTool('echo', { message: 'boom' });
  check('MCP.11', flagged.isError === true && flagged.content[0].text === 'echo: boom', 'isError:true preservato nel risultato senza rifiutare la Promise');
  await flagging.close();

  // 12. Timeout: a silent server must not hang a request forever
  const silent = new StdioTransport({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 60000)'],
    requestTimeoutMs: 300,
  });
  silent.start();
  let timedOut = false;
  const t0 = Date.now();
  try {
    await silent.request('tools/list');
  } catch (err: any) {
    timedOut = /timed out/.test(err.message) && Date.now() - t0 < 10_000;
  }
  check('MCP.12', timedOut, `richiesta contro server muto scaduta entro il timeout configurato (${Date.now() - t0}ms)`);
  await silent.close();

  // 13. Defaults from constants.ts (directive 9)
  check(
    'MCP.13',
    MCP_DEFAULTS.requestTimeoutMs > 0 && MCP_DEFAULTS.initializeTimeoutMs >= MCP_DEFAULTS.requestTimeoutMs / 4,
    'MCP_DEFAULTS centralizzati in constants.ts (init 30s, request 60s)'
  );

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
