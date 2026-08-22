/**
 * Mock MCP server speaking newline-delimited JSON-RPC 2.0 over stdio.
 * Used by tests/test_mcp_client.ts and tests/test_mcp_registry.ts.
 *
 * Modes (argv[2]):
 *   (none)            healthy server: initialize, tools/list (2 tools), tools/call echo
 *   --crash-after-init exits right after answering initialize
 *   --malformed       emits a garbage line before every valid frame
 *   --error-call      tools/call answers with a JSON-RPC error
 *   --iserror-call    tools/call succeeds but sets isError:true
 */
import * as readline from 'readline';

const mode = process.argv[2] ?? '';

const TOOLS = [
  {
    name: 'echo',
    description: 'Echoes the message argument back',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Text to echo' } },
      required: ['message'],
    },
  },
  {
    name: 'add',
    description: 'Sums two numbers',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
];

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  if (mode === '--malformed') {
    process.stdout.write('this is not json\n');
  }

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (msg.id === undefined || msg.id === null) return; // ignore notifications

  switch (msg.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-mcp-server', version: '1.0.0' },
        },
      });
      if (mode === '--crash-after-init') {
        setImmediate(() => process.exit(3));
      }
      break;

    case 'tools/list':
      send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
      break;

    case 'tools/call': {
      const args = msg.params?.arguments ?? {};
      if (mode === '--error-call') {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32603, message: 'internal mock failure' },
        });
        break;
      }
      let text;
      if (msg.params?.name === 'add') {
        text = String(Number(args.a ?? 0) + Number(args.b ?? 0));
      } else {
        text = `echo: ${args.message ?? ''}`;
      }
      const isError = mode === '--iserror-call';
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { content: [{ type: 'text', text }], isError },
      });
      break;
    }

    default:
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }
});

// Signal readiness: the client only writes after we are listening, which is
// immediate with readline, but flush stdout once so pipes are warm.
process.stdout.write('');
