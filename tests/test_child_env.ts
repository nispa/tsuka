/**
 * Credential-free environment for processes started on the model's behalf (T24.1).
 *
 * A canary variable with a credential-like name is set in TSUKA's own environment;
 * execute_command, get_ps_info and an MCP server must not see it, while variables the
 * user named explicitly (commandEnvPassthrough, an MCP server's `env`) and everyday
 * non-secret names (PATH, PWD, SSH_AUTH_SOCK) still get through.
 *
 * Run: npx tsx tests/test_child_env.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

const CANARY = 'TSUKA_T241_CANARY_API_KEY';
const CANARY_VALUE = 'sk-canary-must-not-leak';
const ALLOWED = 'TSUKA_T241_GITHUB_TOKEN';
const ALLOWED_VALUE = 'ghp-allowed-on-purpose';

async function main(): Promise<void> {
  console.log('=== Child process environment (T24.1) ===\n');

  const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-child-env-'));
  const priorHome = process.env.TSUKA_HOME;
  process.env.TSUKA_HOME = testHome;
  fs.copyFileSync(path.join(process.cwd(), 'providers.json'), path.join(testHome, 'providers.json'));
  fs.writeFileSync(path.join(testHome, 'tsuka.config.json'), JSON.stringify({
    activeProvider: 'ollama',
    workspaceRoot: process.cwd(),
    commandEnvPassthrough: [ALLOWED.toLowerCase()],
  }));
  process.env[CANARY] = CANARY_VALUE;
  process.env[ALLOWED] = ALLOWED_VALUE;
  process.env.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK ?? '/tmp/ssh-agent.sock';

  try {
    const { buildChildEnv, isSensitiveEnvName } = await import('../src/core/childEnv');

    // --- the rule itself ---
    const env = buildChildEnv();
    check('CE.1', env[CANARY] === undefined && env[ALLOWED] === undefined, 'credential-like names are removed by default');
    check('CE.2', !!(env.PATH ?? env.Path) && env.SSH_AUTH_SOCK !== undefined, 'PATH and SSH_AUTH_SOCK (a path, not a secret) are kept');
    check('CE.3', !isSensitiveEnvName('PWD') && !isSensitiveEnvName('OLDPWD') && isSensitiveEnvName('DB_PASSWORD') && isSensitiveEnvName('openrouter_api_key'),
      'PWD/OLDPWD are not mistaken for passwords; real credential names match case-insensitively');
    check('CE.4', buildChildEnv([ALLOWED.toLowerCase()])[ALLOWED] === ALLOWED_VALUE, 'a passthrough name lets that one variable through (case-insensitive)');
    check('CE.5', buildChildEnv([], { SERVER_TOKEN: 'declared' }).SERVER_TOKEN === 'declared', 'explicit extra values are always passed');

    // --- execute_command ---
    const { executeCommandTool } = await import('../src/tools/impl/executeCommand');
    const probe = `node -e "console.log('C=' + (process.env.${CANARY} || 'absent') + ' A=' + (process.env.${ALLOWED} || 'absent'))"`;
    const commandOut = String(await executeCommandTool.execute({ command: probe }));
    check('CE.6', commandOut.includes('C=absent') && !commandOut.includes(CANARY_VALUE), `the shell cannot read the canary credential (${commandOut.trim().split('\n').pop()})`);
    check('CE.7', commandOut.includes(`A=${ALLOWED_VALUE}`), 'a variable named in commandEnvPassthrough reaches the shell');

    // --- get_ps_info ---
    const { getPsInfoTool } = await import('../src/tools/impl/getPsInfo');
    const envListing = String(await getPsInfoTool.execute({ category: 'env' }));
    check('CE.8', !envListing.includes(CANARY_VALUE) && !envListing.includes(ALLOWED_VALUE) && !envListing.includes(CANARY),
      'the env listing shows neither the credential names nor their values, on every platform');

    // --- MCP server over stdio ---
    const { StdioTransport } = await import('../src/core/mcp/stdioTransport');
    const serverScript =
      "process.stdin.setEncoding('utf8');let b='';process.stdin.on('data',c=>{b+=c;let i;while((i=b.indexOf('\\n'))>=0){const l=b.slice(0,i);b=b.slice(i+1);" +
      "const r=JSON.parse(l);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{canary:process.env." + CANARY + "||null,declared:process.env.SERVER_TOKEN||null}})+'\\n')}});";
    const transport = new StdioTransport({ command: process.execPath, args: ['-e', serverScript], env: { SERVER_TOKEN: 'declared-token' }, requestTimeoutMs: 10_000 });
    transport.start();
    try {
      const result = (await transport.request('probe')) as { canary: string | null; declared: string | null };
      check('CE.9', result.canary === null, 'an MCP server does not inherit the canary credential');
      check('CE.10', result.declared === 'declared-token', "an MCP server receives the variables declared in its own 'env'");
    } finally {
      await transport.close();
    }
  } finally {
    delete process.env[CANARY];
    delete process.env[ALLOWED];
    if (priorHome === undefined) delete process.env.TSUKA_HOME;
    else process.env.TSUKA_HOME = priorHome;
    fs.rmSync(testHome, { recursive: true, force: true });
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal test error:', error);
  process.exit(1);
});
