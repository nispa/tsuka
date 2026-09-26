/**
 * Isolation of self-authored tools (T23.8, option A).
 *
 * Every payload runs through runCustomToolIsolated directly, bypassing create_tool's
 * regex blocklist on purpose: the blocklist is defense in depth, the confinement under
 * test is the child process (permission model, empty env, heap and time limits). Each
 * case must fail inside the child while the TSUKA process stays intact and responsive.
 *
 * Run: npx tsx tests/test_custom_tool_isolation.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isCustomToolIsolationSupported, runCustomToolIsolated } from '../src/tools/customToolRunner';

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

/** A generated-style module whose execute body is `body`. */
function moduleWith(body: string, name = 'probe'): string {
  return `exports.probeTool = {\n  name: '${name}',\n  riskLevel: 'DANGEROUS',\n  execute: async (args) => {\n${body}\n  }\n};\n`;
}

async function run(body: string, timeoutMs = 10_000): Promise<{ ok: boolean; out: string }> {
  try {
    return { ok: true, out: await runCustomToolIsolated({ name: 'probe', source: moduleWith(body), mode: 'execute', args: { x: 1 }, timeoutMs }) };
  } catch (error: any) {
    return { ok: false, out: String(error?.message ?? error) };
  }
}

async function main(): Promise<void> {
  console.log('=== Custom tool isolation (T23.8) ===\n');

  if (!isCustomToolIsolationSupported()) {
    // The runner refuses to execute on such runtimes; that refusal is itself the contract.
    const refused = await run("return 'ran';");
    check('CTI.0', !refused.ok && /Node\.js >= 25/.test(refused.out), 'runtimes without --allow-net refuse to run custom tools');
    console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
  }

  const outside = path.join(os.tmpdir(), `tsuka-cti-${process.pid}.txt`);
  fs.writeFileSync(outside, 'secret');
  process.env.TSUKA_CTI_CANARY_KEY = 'must-not-leak';

  try {
    const ok = await run("return 'sum:' + (args.x + 1) + ':' + path.basename('a/b.txt') + ':' + fs.existsSync('package.json');");
    check('CTI.1', ok.ok && ok.out === 'sum:2:b.txt:true', `a well-behaved tool runs with args, path and workspace fs (${ok.out})`);

    const env = await run("return JSON.stringify(Object.keys(process['e' + 'nv']));");
    check('CTI.2', env.ok && !env.out.includes('TSUKA_CTI_CANARY_KEY') && !/KEY|TOKEN|SECRET/i.test(env.out), `the child environment carries no secrets (${env.out})`);

    const bracketFs = await run(`return fs['read' + 'FileSync'](${JSON.stringify(outside)}, 'utf-8');`);
    check('CTI.3', !bracketFs.ok && /ERR_ACCESS_DENIED|restricted/i.test(bracketFs.out), 'bracket-notation fs read outside the workspace is denied');

    const writeOutside = await run(`fs.writeFileSync(${JSON.stringify(outside)}, 'pwned'); return 'written';`);
    check('CTI.4', !writeOutside.ok && fs.readFileSync(outside, 'utf-8') === 'secret', 'writing outside the workspace is denied and the file is untouched');

    const ctorChain = await run("return ({}).constructor['constr' + 'uctor']('return 1')();");
    check('CTI.5', !ctorChain.ok && /Code generation from strings disallowed/.test(ctorChain.out), 'Function via constructor chain is disallowed');

    const protoChain = await run("return Object.getPrototypeOf(async function () {}).constructor('return 1')();");
    check('CTI.6', !protoChain.ok && /Code generation from strings disallowed/.test(protoChain.out), 'AsyncFunction via prototype is disallowed');

    const dynImport = await run("const m = await import('child' + '_process'); return String(m.execSync('echo pwned'));");
    check('CTI.7', !dynImport.ok, `dynamic import of child_process fails (${dynImport.out.slice(0, 90)})`);

    const indirectRequire = await run("return String(process['getBuiltin' + 'Module']('child' + '_process').execSync('echo pwned'));");
    check('CTI.8', !indirectRequire.ok && /ERR_ACCESS_DENIED|restricted/i.test(indirectRequire.out), 'child_process reached through getBuiltinModule is denied');

    const localRequire = await run("return require('os').hostname();");
    check('CTI.9', !localRequire.ok && /Module not allowed/.test(localRequire.out), 'the injected require only serves fs and path');

    const network = await run("const r = await fetch('http://93.184.216.34/'); return String(r.status);");
    check('CTI.10', !network.ok, `network access is denied (${network.out.slice(0, 90)})`);

    const socket = await run("return await new Promise((ok, ko) => { const s = process.getBuiltinModule('net').connect(80, '93.184.216.34'); s.on('connect', () => ok('connected')); s.on('error', ko); });");
    check('CTI.11', !socket.ok, `raw sockets are denied (${socket.out.slice(0, 90)})`);

    const started = Date.now();
    const loop = await run('while (true) {}', 1_500);
    check('CTI.12', !loop.ok && /exceeded 1500 ms/.test(loop.out) && Date.now() - started < 8_000, 'an infinite loop is killed at the timeout');

    const heap = await run('const hog = []; while (true) hog.push(new Array(1e6).fill(7));', 60_000);
    check('CTI.13', !heap.ok && /crashed|heap|memory/i.test(heap.out), `a memory blow-up kills only the child (${heap.out.slice(0, 90)})`);

    const flood = await run("return 'x'.repeat(4 * 1024 * 1024);");
    check('CTI.14', !flood.ok && /bytes of output/.test(flood.out), 'oversized output is cut off');

    const exit = await run("process.exit(0);");
    check('CTI.15', !exit.ok, 'process.exit only ends the child');

    // The host is still here and responsive after every payload above.
    const after = await run("return 'still here';");
    check('CTI.16', after.ok && after.out === 'still here' && fs.readFileSync(outside, 'utf-8') === 'secret', 'TSUKA stays intact after all payloads');

    const wrongName = await runCustomToolIsolated({ name: 'expected', source: moduleWith("return 1;", 'other'), mode: 'validate' }).then(() => 'ok', (e) => e.message);
    check('CTI.17', /expected 'expected'/.test(wrongName), 'a module exporting a different tool name is rejected');

    const legacy = "const fs = require('/old/path/jailedFs').jailedFs;\nconst path = require('path');\n" + moduleWith("return String(fs.existsSync('package.json'));");
    const legacyRun = await runCustomToolIsolated({ name: 'probe', source: legacy, mode: 'execute' }).then((r) => r, (e) => e.message);
    check('CTI.18', legacyRun === 'true', `modules written by the old template still run (${legacyRun})`);
  } finally {
    delete process.env.TSUKA_CTI_CANARY_KEY;
    fs.rmSync(outside, { force: true });
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal test error:', error);
  process.exit(1);
});
