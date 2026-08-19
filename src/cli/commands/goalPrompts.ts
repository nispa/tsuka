import { CharacterConfig, loadRole, listAvailableTeams } from '../shared';

/** Returns roles/skills covered by a character (multi-skill list or single role). */
export function rolesOf(c: CharacterConfig): string[] {
  if (c.roles && c.roles.length > 0) return c.roles;
  return c.role ? [c.role] : [];
}

/**
 * Formats a concise character signature for the orchestrator prompt catalog.
 */
export function formatAgentSignature(c: CharacterConfig): string {
  if (c.signature && typeof c.signature === 'string' && c.signature.trim()) {
    return `- @${c.name} (${c.aiName || c.name}): ${c.signature.trim()}`;
  }

  const roleNames = rolesOf(c);
  const allTools = new Set<string>();
  const roleSummaries: string[] = [];

  // Ambient tools that don't differentiate specialization
  const AMBIENT_TOOLS = new Set(['save_memory', 'recall_memory', 'update_memory', 'forget_memory', 'send_message', 'list_dir', 'read_file', 'browse_url']);

  for (const rName of roleNames) {
    const role = loadRole(rName);
    if (role) {
      if (role.description) roleSummaries.push(role.description);
      (role.allowedTools || []).forEach((t) => allTools.add(t));
    }
  }

  let desc = (c.description || roleSummaries.join('; ') || 'No description').split('\n')[0].trim();
  if (desc.length > 85) {
    desc = desc.slice(0, 82).trim() + '...';
  }

  const specificTools = Array.from(allTools).filter((t) => !AMBIENT_TOOLS.has(t));
  const displayTools = specificTools.length > 0 ? specificTools : Array.from(allTools);
  const toolsStr = displayTools.length > 0 ? ` | Tools: [${displayTools.join(', ')}]` : '';
  const rolesLabel = roleNames.length > 0 ? `role=${roleNames.join(',')}` : 'general';

  return `- @${c.name} (${c.aiName || c.name}): ${rolesLabel} — ${desc}${toolsStr}`;
}

/**
 * Builds installed team blueprints from `teams/*.json`.
 */
export function buildTeamBlueprints(allCharacters: CharacterConfig[]): string {
  const byName = new Map(allCharacters.map((c) => [c.name, c]));
  const lines: string[] = [];

  for (const team of listAvailableTeams()) {
    const members = (team.members || [])
      .map((m) => byName.get(m))
      .filter((c): c is CharacterConfig => !!c);
    if (members.length < 2) continue;

    const crew = members
      .map((c) => `${rolesOf(c).join('+') || 'general'} (@${c.name})`)
      .join(' → ');

    let desc = (team.description || team.displayName || '').split('\n')[0].trim();
    if (desc.length > 110) desc = desc.slice(0, 107).trim() + '...';

    lines.push(`- [${team.name.toUpperCase()}] ${crew}${desc ? ` — ${desc}` : ''}`);
  }

  return lines.join('\n');
}

export function buildGoalOrchestratorPrompt(allCharacters: CharacterConfig[], goal: string): string {
  const charList = allCharacters
    .map(formatAgentSignature)
    .join('\n');

  const blueprints = buildTeamBlueprints(allCharacters);
  const blueprintBlock = blueprints
    ? `INSTALLED TEAMS (role chains — reuse one when the goal matches):\n${blueprints}\n\n`
    : '';
  const blueprintRule = blueprints
    ? '1. Reason by CRAFT: list the roles the goal requires, then reuse the team whose role chain matches, or compose your own from AVAILABLE AGENTS.\n'
    : '1. Reason by CRAFT: list the roles the goal requires, then pick the agents that cover them.\n';

  const supervisor = allCharacters.find((c) => rolesOf(c).includes('supervisor'));
  const workers = allCharacters.filter((c) => c !== supervisor).slice(0, 3);
  const ex = (i: number, fallback: string) => {
    const c = workers[i];
    return c ? `@${c.name}` : `@${fallback}`;
  };
  const exReviewer = supervisor ? `@${supervisor.name}` : ex(3, 'reviewer');

  return `You are the TSUKA Goal Orchestrator. Plan a dynamic agent team to achieve a goal.

${blueprintBlock}AVAILABLE AGENTS (for custom or fallback composition):
${charList}

GOAL: "${goal}"

INSTRUCTIONS:
${blueprintRule}2. An agent listed with several roles (role=a,b) owns the tools of ALL of them: prefer ONE such agent over two specialists when the tasks are adjacent — it avoids a handoff whose only purpose is reaching another role's tool.
3. The @handle is just how you address the agent that holds the craft: use ONLY the @names listed above, any other name is discarded.
4. For each selected agent, specify a concrete task.
5. If some tasks are INDEPENDENT (can run concurrently), wrap them in a PARALLELO block.
6. If the goal is trivial (simple question, answer, info), respond with just FINE.

RESPONSE FORMAT:
AGENTE: @name — Task
PARALLELO:
AGENTE: @name1 — Task1 (independent from others)
AGENTE: @name2 — Task2 (independent from others)
FINE PARALLELO
AGENTE: @name3 — Task3 (after parallel tasks)
FINE

Example with parallel tasks:
AGENTE: ${ex(0, 'agent1')} — First step of the work
PARALLELO:
AGENTE: ${ex(1, 'agent2')} — Independent step A
AGENTE: ${ex(2, 'agent3')} — Independent step B
FINE PARALLELO
AGENTE: ${exReviewer} — Review and validate the work
FINE

If no team is needed:
FINE`;
}
