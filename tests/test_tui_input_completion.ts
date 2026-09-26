/**
 * Prompt suggestions in the TUI: the completion table shared with the CLI, the live
 * menu (↑/↓ choose, Tab completes, Esc closes, Enter untouched) and its overlay.
 *
 * Run: npx tsx tests/test_tui_input_completion.ts
 */
import { computeSuggestions, CompletionMenu } from '../src/tui/interaction/completionMenu';
import { argumentCompletions } from '../src/cli/commands/completion';
import { TuiStore } from '../src/tui/store';
import { TuiScreen } from '../src/tui/screen';
import { composeLayoutFrame } from '../src/tui/layoutEngines';
import { DEFAULT_LAYOUT_CONFIG, applyLayout } from '../src/tui/layoutConfig';
import { listAvailableCharacters } from '../src/core/personas';

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

const ctx = { models: () => ['qwen3-8b', 'llama3'], providers: () => ['ollama', 'openrouter'] };
const key = (name: string) => ({ name, ctrl: false, meta: false, shift: false } as any);

function storeWith(text: string): TuiStore {
  const store = new TuiStore();
  store.setState({ focus: 'input' });
  store.setInputText(text, text.length);
  return store;
}

function main(): void {
  // --- the shared table ---
  const geordi = listAvailableCharacters().find((c) => c.name.startsWith('ge'));
  const agentSuggestions = computeSuggestions('/agent ge', 9, ctx);
  check('TUIC.1', !!geordi && !!agentSuggestions?.items.some((i) => i.value === geordi.name),
    `"/agent ge" offers ${geordi?.name} (${agentSuggestions?.items.map((i) => i.value).join(', ')})`);
  if (geordi) {
    const byAiName = computeSuggestions(`/agent ${geordi.aiName.slice(0, 3)}`, 7 + 3, ctx);
    check('TUIC.2', !!byAiName?.items.some((i) => i.value === geordi.name), `the full name (${geordi.aiName}) also matches`);
  }
  check('TUIC.3', computeSuggestions('/team dev_o', 11, ctx)?.items[0]?.value === 'dev_ops', 'teams are suggested');
  check('TUIC.4', computeSuggestions('/call @geor', 11, ctx)?.items.some((i) => i.value.startsWith('@geor')) === true, '@mentions are suggested');
  check('TUIC.5', computeSuggestions('/cal', 4, ctx)?.appendSpace === true && computeSuggestions('/cal', 4, ctx)!.items.some((i) => i.value === '/call'),
    'command names are suggested and completing one adds a space');
  check('TUIC.6', computeSuggestions('ordinary prompt', 15, ctx) === undefined, 'no suggestions outside completion contexts');
  check('TUIC.7', computeSuggestions('/team dev_ops', 13, ctx) === undefined, 'nothing is offered once the token is already complete');
  check('TUIC.8', argumentCompletions('/provider', ctx).map((i) => i.value).join() === 'ollama,openrouter', 'runtime lists come from the interface context');

  // --- the menu: navigation, completion, dismissal ---
  const menu = new CompletionMenu(ctx);
  const store = storeWith('/effort ');
  const first = menu.view(store.getState());
  check('TUIC.9', first?.index === 0 && first.items.length === 7, 'the menu opens on the first of the /effort levels');
  menu.handleKey(key('down'), store.getState(), store);
  menu.handleKey(key('down'), store.getState(), store);
  check('TUIC.10', menu.view(store.getState())?.index === 2, '↓ moves the selection');
  menu.handleKey(key('up'), store.getState(), store);
  const chosen = menu.view(store.getState())!.items[1].value;
  const tabHandled = menu.handleKey(key('tab'), store.getState(), store);
  check('TUIC.11', tabHandled && store.getState().inputText === `/effort ${chosen}`, `Tab completes with the selected item ("${store.getState().inputText}")`);

  const store2 = storeWith('/effort ');
  const escHandled = menu.handleKey(key('escape'), store2.getState(), store2);
  check('TUIC.12', escHandled && menu.view(store2.getState()) === undefined, 'Esc closes the menu');
  store2.insertInputChar('h');
  check('TUIC.13', menu.view(store2.getState())?.items[0]?.value === 'high', 'typing again reopens it, filtered');
  check('TUIC.14', menu.handleKey(key('return'), store2.getState(), store2) === false, 'Enter is never taken over by the menu');

  const store3 = storeWith('/effort ');
  store3.setFocus('chat');
  check('TUIC.15', menu.view(store3.getState()) === undefined && menu.handleKey(key('down'), store3.getState(), store3) === false,
    'no menu, and arrows untouched, when the prompt does not have focus');

  // --- the overlay, in both built-in layouts ---
  for (const engine of ['console', 'classic']) {
    const s = storeWith('/effort ');
    const state = s.getState();
    const frame = composeLayoutFrame({
      state, width: 121, height: 30, activeTab: 'chat',
      layout: applyLayout({ ...DEFAULT_LAYOUT_CONFIG }, { engine }),
      completion: menu.view(state),
    });
    const text = frame.lines.map((l) => TuiScreen.stripAnsi(l));
    const input = frame.panes.input!;
    const menuRow = text.findIndex((l) => l.includes(' xhigh ') || l.includes(' none '));
    check(`TUIC.16-${engine}`, menuRow >= 0 && menuRow + 1 < input.y && text.every((l) => TuiScreen.stringWidth(l) === 120),
      `${engine}: the menu floats above the prompt and every row keeps the terminal width`);
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
