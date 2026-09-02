/**
 * Test for the /call multi-agent conference preparation and logic.
 * Run: npx tsx tests/test_call.ts
 */
import { resolveCharacter, loadRole, loadTrait, loadSystemPrompt } from '../src/cli/shared';
import { parseCallInvocation } from '../src/cli/commands/call';

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

async function run() {
  console.log('=== Test Multi-Agent Conference (/call) ===\n');

  // Resolve characters by craft
  const researcher = resolveCharacter('researcher');
  const dev = resolveCharacter('developer');
  const auditor = resolveCharacter('security_auditor');

  check('CALL.1', !!researcher && !!dev && !!auditor, 'base roles resolved correctly from the catalog');

  const byAiName = dev ? resolveCharacter(dev.aiName.toUpperCase()) : null;
  check('CALL.1b', !!dev && byAiName?.name === dev.name, 'an aiName resolves case-insensitively to the same call participant');

  const parsed = parseCallInvocation('@geordi @doctor "Find a robust solution"');
  check('CALL.1c', parsed.selectedNames.join(',') === 'geordi,doctor' && parsed.topic === 'Find a robust solution', 'quoted call syntax preserves complete character identifiers');

  if (researcher && dev && auditor) {
    const topic = 'System architecture analysis';
    const participants = [researcher, dev, auditor];

    for (const p of participants) {
      const role = loadRole(p.role);
      const trait = loadTrait(p.trait);
      const sysPrompt = loadSystemPrompt(role, trait, 'test-model', undefined, p, topic);

      check(`CALL.2.${p.aiName}`, sysPrompt.includes(p.aiName) && sysPrompt.includes(role.systemPrompt), `system prompt correct for ${p.aiName}`);
    }
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
