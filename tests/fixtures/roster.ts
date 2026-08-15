/**
 * Fixture del roster per i test: risolve gli agenti per MESTIERE, mai per nome proprio.
 *
 * Il catalogo dei personaggi è dati dell'utente (`characters/*.json`): chiunque può
 * rinominarlo o sostituirlo, mentre i ruoli sono il contratto stabile del sistema
 * (roles/*.json, allowedTools, cascata di reasoning effort). Un test che scrive
 * `members: ['geordi']` non verifica il round-robin: verifica che quel file esista,
 * e diventa rosso alla prima rinomina del roster — è esattamente quello che è
 * successo con la revisione T9.6.
 *
 * Uso tipico:
 *   const dev = agentWithRole('developer');
 *   const [a, b] = distinctAgents('sysadmin', 'security_auditor');
 */
import { listAvailableCharacters, CharacterConfig } from '../../src/cli/shared';

/** Mestieri coperti da un personaggio: multi-skill se presenti, altrimenti il ruolo singolo. */
export function rolesOf(c: CharacterConfig): string[] {
  if (c.roles && c.roles.length > 0) return c.roles;
  return c.role ? [c.role] : [];
}

/** Tutti i personaggi installati che esercitano un mestiere, ruolo attivo prima. */
export function agentsWithRole(role: string): CharacterConfig[] {
  const all = listAvailableCharacters();
  return [
    ...all.filter((c) => c.role === role),
    ...all.filter((c) => c.role !== role && rolesOf(c).includes(role))
  ];
}

/**
 * Personaggio che esercita un mestiere. Fallisce esplicitamente se il catalogo non
 * lo copre: un test non deve mai proseguire su un agente inesistente (verrebbe
 * saltato a runtime e il test passerebbe per il motivo sbagliato).
 */
export function characterWithRole(role: string): CharacterConfig {
  const found = agentsWithRole(role)[0];
  if (!found) {
    throw new Error(
      `Fixture: nessun personaggio installato copre il ruolo '${role}'. ` +
        `Aggiungerne uno in characters/ oppure usare un ruolo coperto dal catalogo.`
    );
  }
  return found;
}

/** Nome (file) del personaggio che esercita un mestiere. */
export function agentWithRole(role: string): string {
  return characterWithRole(role).name;
}

/** Nome visibile (aiName) del personaggio che esercita un mestiere. */
export function aiNameWithRole(role: string): string {
  return characterWithRole(role).aiName;
}

/**
 * Nome visibile (aiName) di un personaggio dato il suo nome file. Serve dove il
 * codice sotto test espone l'aiName invece del nome tecnico (es. ContextTracker).
 */
export function aiNameOf(name: string): string {
  const found = listAvailableCharacters().find((c) => c.name === name);
  if (!found) throw new Error(`Fixture: personaggio '${name}' non installato.`);
  return found.aiName;
}

/**
 * Un agente distinto per ciascun mestiere richiesto: se lo stesso personaggio copre
 * più ruoli (multi-skill) viene usato una volta sola e per gli altri si scende al
 * successivo candidato, così i test sui turni multi-agente hanno davvero N agenti.
 */
export function distinctAgents(...roles: string[]): string[] {
  const used = new Set<string>();
  return roles.map((role) => {
    const candidate = agentsWithRole(role).find((c) => !used.has(c.name));
    if (!candidate) {
      throw new Error(`Fixture: nessun personaggio libero per il ruolo '${role}' (già usati: ${[...used].join(', ')}).`);
    }
    used.add(candidate.name);
    return candidate.name;
  });
}
