/**
 * Suite di test per il motore di mention autocomplete (@personaggi e @ruoli).
 * Esecuzione: npx tsx tests/test_mention_completion.ts
 */
import { getMentionCandidates, getMentionTags } from '../src/core/mentionSuggestions';
import { setCompletionSource, completeLine } from '../src/cli/input';

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
  console.log('=== Test Mention Autocomplete & Tab Completion ===\n');

  const mockCharacters = [
    { name: 'geordi', displayName: 'Geordi La Forge', role: 'developer' },
    { name: 'spock', displayName: 'Spock', role: 'researcher' },
    { name: 'scotty', displayName: 'Montgomery Scott', role: 'devops_engineer' },
    { name: 'worf', displayName: 'Worf', role: 'security_auditor' },
    { name: 'seven', displayName: 'Seven of Nine', role: 'osint_researcher' },
  ];

  const mockRoles = [
    { name: 'developer', displayName: '💻 Sviluppatore Software' },
    { name: 'supervisor', displayName: '🎖️ Supervisore' },
    { name: 'security_auditor', displayName: '🛡️ Security Auditor' },
  ];

  // 1. getMentionCandidates
  const candsG = getMentionCandidates('@g', mockCharacters, mockRoles);
  check('MENTION.1', candsG.length === 1 && candsG[0].tag === '@geordi' && candsG[0].kind === 'character', 'Risoluzione @g -> @geordi (character)');

  const candsDev = getMentionCandidates('@dev', mockCharacters, mockRoles);
  check('MENTION.2', candsDev.some((c) => c.tag === '@developer' && c.kind === 'role'), 'Risoluzione @dev -> @developer (role)');

  const candsAllS = getMentionCandidates('@s', mockCharacters, mockRoles);
  check('MENTION.3', candsAllS.some((c) => c.tag === '@spock') && candsAllS.some((c) => c.tag === '@scotty') && candsAllS.some((c) => c.tag === '@supervisor'), 'Risoluzione multipla su prefisso comune (@spock, @scotty, @supervisor)');

  // 2. completeLine con setCompletionSource
  setCompletionSource({
    commands: ['/call', '/team', '/goal', '/models', '/agent'],
    argumentsFor: (cmd) => {
      if (cmd === '/agent') return ['geordi', 'spock', 'worf'];
      if (cmd === '/team') return ['dev_ops', 'cyber_audit'];
      if (cmd === '/call') return ['@geordi', '@spock', '@worf', '@developer'];
      return [];
    },
    mentions: () => ['@geordi', '@spock', '@scotty', '@worf', '@seven', '@developer', '@supervisor']
  });

  // 3. Tab su comando slash
  const [cmdHits] = completeLine('/ca');
  check('MENTION.4', cmdHits.length === 1 && cmdHits[0] === '/call', 'Completamento comando slash /ca -> /call');

  // 4. Tab su argomento comando
  const [argHits] = completeLine('/agent g');
  check('MENTION.5', argHits.length === 1 && argHits[0] === 'geordi', 'Completamento argomento comando /agent g -> geordi');

  // 5. Tab su /call @...
  const [callHits] = completeLine('/call @w');
  check('MENTION.6', callHits.length === 1 && callHits[0] === '@worf', 'Completamento /call @w -> @worf');

  // 6. Tab su @ a metà frase
  const [midHits] = completeLine('vorrei comporre un team con @sc');
  check('MENTION.7', midHits.length === 1 && midHits[0] === '@scotty', 'Completamento @scotty a metà riga');

  // 7. Tab su ruolo con @
  const [roleHits] = completeLine('@super');
  check('MENTION.8', roleHits.length === 1 && roleHits[0] === '@supervisor', 'Completamento ruolo @super -> @supervisor');

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
