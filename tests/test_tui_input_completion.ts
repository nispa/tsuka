/** Regression tests for contextual TUI completion of workflow identifiers. */
import { completeTuiInput } from '../src/tui/inputCompletion';

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

function main(): void {
  const command = completeTuiInput('/cal', 4);
  check('TUIC.1', command.text === '/call', 'completes a slash command');

  const team = completeTuiInput('/team dev_o', 11);
  check('TUIC.2', team.text === '/team dev_ops', 'completes a team identifier');

  const character = completeTuiInput('/call @geor', 11);
  check('TUIC.3', character.text === '/call @geordi', 'completes a call participant');

  const noContext = completeTuiInput('ordinary prompt', 15);
  check('TUIC.4', !noContext.changed && noContext.candidates.length === 0, 'leaves Tab available for focus outside completion contexts');

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
