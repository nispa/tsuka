/**
 * Test dell'Architettura Multi-Skill (Tipi, Loading, Agent Hot-Swapping e Tool switch_skill).
 *
 * Esecuzione: npx tsx tests/test_multi_skill.ts
 */
import { loadCharacter, loadRole, loadTrait, loadSystemPrompt } from '../src/cli/shared';
import { Agent } from '../src/core/agent';
import { switchSkillTool } from '../src/tools/impl/switchSkill';
import { CharacterConfig } from '../src/core/types';

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

function main() {
  console.log('=== Test Architettura Multi-Skill ===\n');

  // --- 1) Retro-compatibilità caricamento personaggi ---
  const legacyChar = loadCharacter('dev');
  check('MS-1-legacy-character-loaded', legacyChar !== null, "Personaggio 'dev' caricato con successo");
  if (legacyChar) {
    check(
      'MS-2-legacy-roles-populated',
      Array.isArray(legacyChar.roles) && legacyChar.roles.length > 0 && legacyChar.activeRole === 'developer',
      `Legacy character 'dev' ha roles=[${legacyChar.roles?.join(', ')}] e activeRole='${legacyChar.activeRole}'`
    );
  }

  // --- 2) Supporto Multi-Skill su CharacterConfig ---
  const multiSkillChar: CharacterConfig = {
    name: 'dev_multi',
    displayName: '💻 Dev Multi-Skill',
    aiName: 'DevMulti',
    roles: ['developer', 'architect', 'researcher'],
    activeRole: 'architect',
    trait: 'professional',
    description: 'Sviluppatore multi-skill'
  };

  check(
    'MS-3-multi-skill-config',
    Array.isArray(multiSkillChar.roles) && multiSkillChar.roles.length === 3 && multiSkillChar.activeRole === 'architect',
    `Multi-skill config valida: 3 ruoli sbloccati, activeRole='architect'`
  );

  // --- 3) Assemblaggio System Prompt con Skill Attiva ---
  const roleArch = loadRole('architect');
  const traitProf = loadTrait('professional');

  const promptArch = loadSystemPrompt(roleArch, traitProf, 'test-model', undefined, multiSkillChar);
  check(
    'MS-4-prompt-assembly-with-active-skill',
    promptArch.includes('You are DevMulti') && promptArch.includes(roleArch.systemPrompt),
    'loadSystemPrompt genera correttamente il prompt combinando Trait e Skill attiva'
  );

  // --- 4) Agent Hot-Swapping di Skill senza perdite di cronologia ---
  const mockProvider: any = {
    getCurrentModel: () => 'test-model',
    chatWithTools: async () => ({ content: 'OK' })
  };
  const mockRegistry: any = {
    listForLLM: () => [],
    executeTool: async () => ({ success: true, output: 'OK' })
  };
  const mockPermissionManager: any = {
    checkPermission: async () => true
  };

  const agent = new Agent(
    mockProvider,
    mockRegistry,
    mockPermissionManager,
    promptArch,
    roleArch.allowedTools
  );

  // Simula un messaggio di storia utente
  const messages = agent.getMessages();
  messages.push({ role: 'user', content: 'Analisi iniziale completata.' });
  check('MS-5-history-message-added', agent.getMessages().length === 2, 'Cronologia contiene System Prompt + Messaggio Utente');

  // Hot-swapping della Skill a 'developer'
  const roleDev = loadRole('developer');
  const promptDev = loadSystemPrompt(roleDev, traitProf, 'test-model', undefined, multiSkillChar);
  agent.setActiveSkill(promptDev, roleDev.allowedTools);

  const updatedMessages = agent.getMessages();
  check(
    'MS-6-agent-active-skill-swapped',
    updatedMessages[0].content === promptDev && updatedMessages[1].content === 'Analisi iniziale completata.',
    'setActiveSkill ha aggiornato il System Prompt ed i tool preservando il messaggio utente inalterato'
  );

  // --- 5) Esecuzione del Tool switch_skill ---
  switchSkillTool.execute({ skill: 'developer', reason: 'Fase di codice avviata' })
    .then((res) => {
      check('MS-7-switch-skill-tool-executed', res.includes('developer'), `switch_skill output: ${res}`);
      console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      check('MS-7-switch-skill-tool-failed', false, err.message);
      console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
      process.exit(1);
    });
}

main();
