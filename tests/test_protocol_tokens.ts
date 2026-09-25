/**
 * Multi-agent protocol vocabulary contract (T14.25).
 *
 * The protocol tokens live in three places that must agree exactly: the constants in
 * `src/core/protocolTokens.ts`, the `enum`s of the JSON tool schemas sent to the model,
 * and the text-marker fallback parsers. A mismatch never throws — the parser simply
 * stops matching — so this suite pins all three to the same values and checks that
 * the retired Italian tokens are no longer accepted anywhere (clean break: no
 * persisted data depends on them beyond a single team/goal turn).
 *
 * Run: npx tsx tests/test_protocol_tokens.ts
 */
import './isolateMemory';
import * as fs from 'fs';
import * as path from 'path';
import { TURN_STATUSES, VOTES, END_TOKEN } from '../src/core/protocolTokens';
import {
  hasCompletionMarker,
  hasUnanimousApproval,
  parseOrchestratorDecision,
  hasDoneSignal
} from '../src/cli/commands/team';
import { hasAnyStatusMarker } from '../src/cli/commands/strategies/common';
import { parsePlan } from '../src/cli/commands/goal';
import { reportStatusTool } from '../src/tools/impl/reportStatus';
import { castVoteTool } from '../src/tools/impl/castVote';
import { distinctAgents } from './fixtures/roster';

const [WORKER] = distinctAgents('sysadmin');

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

function schemaProperty(file: string, prop: string): any {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools_schemas', file), 'utf-8'));
  return schema.parameters.properties[prop];
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

const asst = (content: string) => ({ role: 'assistant' as const, content });

async function main() {
  console.log('=== Protocol Token Contract (T14.25) ===\n');

  // Schema enums are what the model sees: they must be the parser's vocabulary.
  check('PT1', sameList(schemaProperty('report_status.json', 'status').enum, TURN_STATUSES),
    'report_status.json enum === TURN_STATUSES');
  check('PT2', sameList(schemaProperty('cast_vote.json', 'vote').enum, VOTES),
    'cast_vote.json enum === VOTES');
  check('PT3', String(schemaProperty('route_next.json', 'agent').description).includes(`'${END_TOKEN}'`),
    `route_next.json agent description names the '${END_TOKEN}' token`);

  // Every token is accepted by its text-marker fallback.
  check('PT4', TURN_STATUSES.every((s) => hasAnyStatusMarker(`Done.\nSTATUS: ${s}`)),
    'every TURN_STATUS is recognised by the STATUS: marker');
  check('PT5', hasCompletionMarker([asst('STATUS: COMPLETED')]), 'STATUS: COMPLETED is a completion marker');
  check('PT6', VOTES.every((v) => hasUnanimousApproval([{ role: 'user', content: `X: "ok\nVOTE: ${v}"` }]) === (v === 'APPROVE')),
    'VOTE: marker recognises every vote, only APPROVE counts as approval');
  check('PT7', hasDoneSignal(END_TOKEN) && parseOrchestratorDecision(`AGENT: @${WORKER}`, [WORKER])?.agent === WORKER,
    'orchestrator fallback accepts AGENT: @name and END');
  const plan = parsePlan(`AGENT: @${WORKER} — a\nPARALLEL:\nAGENT: @${WORKER} — b\nEND PARALLEL\n${END_TOKEN}`, [WORKER]);
  check('PT8', plan.groups.length === 2 && plan.groups[1].mode === 'parallel',
    'goal plan parses AGENT / PARALLEL / END PARALLEL / END');

  // Tools validate against the same vocabulary.
  check('PT9', !(await rejects(() => reportStatusTool.execute({ status: 'continue', summary: 's' }, {} as any))),
    'report_status accepts a valid status (case-insensitive)');
  check('PT10', !(await rejects(() => castVoteTool.execute({ vote: 'revise', reason: 'r' }, {} as any))),
    'cast_vote accepts a valid vote (case-insensitive)');

  // Clean break: the retired Italian tokens are not protocol anymore.
  check('PT11', !hasAnyStatusMarker('STATO: COMPLETATO') && !hasCompletionMarker([asst('STATO: COMPLETATO')]),
    'legacy STATO: COMPLETATO is not recognised');
  check('PT12', !hasUnanimousApproval([{ role: 'user', content: 'X: "VOTO: APPROVO"' }]),
    'legacy VOTO: APPROVO is not recognised');
  check('PT13', !hasDoneSignal('FINE') && parseOrchestratorDecision(`AGENTE: @${WORKER}`, [WORKER]) === null,
    'legacy AGENTE: / FINE are not recognised by the orchestrator fallback');
  check('PT14', await rejects(() => reportStatusTool.execute({ status: 'COMPLETATO', summary: 's' }, {} as any)),
    'report_status rejects legacy COMPLETATO');
  check('PT15', await rejects(() => castVoteTool.execute({ vote: 'APPROVO', reason: 'r' }, {} as any)),
    'cast_vote rejects legacy APPROVO');

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error in test:', err);
  process.exit(1);
});
