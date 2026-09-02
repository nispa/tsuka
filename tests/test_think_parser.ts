/** Contract tests for streaming and complete-response reasoning tag parsing. */

import { ThinkTagParser, stripThinkBlocks, StreamChannel } from '../src/core/thinkParser';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail: string): void {
  if (condition) {
    console.log(`  PASS ${name}: ${detail}`);
    passed++;
  } else {
    console.error(`  FAIL ${name}: ${detail}`);
    failed++;
  }
}

function run(chunks: string[]): { content: string; reasoning: string } {
  let content = '';
  let reasoning = '';
  const parser = new ThinkTagParser((text: string, channel: StreamChannel) => {
    if (channel === 'content') content += text;
    else reasoning += text;
  });
  for (const chunk of chunks) parser.push(chunk);
  parser.flush();
  return { content, reasoning };
}

function split(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

function agrees(text: string, chunks = split(text, 1)): boolean {
  return run(chunks).content.trim() === stripThinkBlocks(text);
}

console.log('\n=== Test ThinkTagParser contract ===\n');

let result = run(['plain response']);
check('TP1', result.content === 'plain response' && result.reasoning === '', 'plain content is unchanged');

result = run(['<think>reasoning</think>Final response']);
check('TP2', result.reasoning === 'reasoning' && result.content === 'Final response', 'a closed block is separated');

result = run(split('<think>split plan</think>\n\nFinal response', 1));
check('TP3', result.reasoning === 'split plan' && result.content === 'Final response', 'tags may span single-character chunks');

result = run(['<think>unfinished private reasoning']);
check('TP4', result.reasoning === 'unfinished private reasoning' && result.content === '', 'an orphan opening tag remains private reasoning');

result = run(['Visible </think> response']);
check('TP5', result.content === 'Visible </think> response' && result.reasoning === '', 'an orphan closing tag remains literal content');

result = run(['<THINK >private</ THINK> public']);
check('TP6', result.reasoning === 'private' && result.content === 'public', 'tag casing and harmless whitespace are normalized');

result = run(['<think>a</think>one <think>b</think>two']);
check('TP7', result.reasoning === 'ab' && result.content === 'one two', 'multiple blocks preserve visible content order');

result = run(['before <think attr="x">after']);
check('TP8', result.content === 'before <think attr="x">after', 'tags with attributes are malformed literal content');

result = run(['<think>outer <think> inner</think>end']);
check('TP9', result.reasoning === 'outer <think> inner' && result.content === 'end', 'a nested opening tag is literal reasoning text');

result = run(['comparison: 1 < 2']);
check('TP10', result.content === 'comparison: 1 < 2', 'an incomplete non-tag candidate is preserved');

console.log('\n=== Test complete and streaming agreement ===\n');

const agreementCases = [
  '<think>x</think>Answer',
  '<think>never closed',
  'Visible </think> answer',
  '<THINK >x</ THINK> answer',
  '<think>a</think>one<think>b</think> two',
  'before <think attr="x"> after',
  '<think>outer <think> inner</think>end',
  'comparison: 1 < 2',
];

for (const [index, text] of agreementCases.entries()) {
  check(`TA${index + 1}`, agrees(text), `streaming and final parsing agree for case ${index + 1}`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
