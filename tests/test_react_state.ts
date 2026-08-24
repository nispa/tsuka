import { createReActState, evaluateTextResponse, markToolRound } from '../src/core/reactState';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const state = createReActState('high');
const first = evaluateTextResponse(state, 'planning only', ['report_status'], () => false);
assert(!first.accepted, 'The first text-only response should be nudged');
assert(first.nudge?.includes("call 'report_status'"), 'The nudge should name the completion tool');
assert(state.currentRoundEffortOverride === 'none', 'The nudge should lower reasoning effort');

const second = evaluateTextResponse(state, 'final summary', ['report_status'], () => false);
assert(second.accepted, 'The one-shot nudge must not reject the next response');

const round = markToolRound(state);
assert(round === 1, 'The first tool round should be numbered one');
assert(state.everCalledTool, 'A tool round should mark tool usage');
assert(evaluateTextResponse(state, 'summary', [], () => false).accepted, 'Tool users may finish with text');

console.log('4 passed');
