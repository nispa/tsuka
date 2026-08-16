/**
 * Motore di risoluzione per mention (@personaggi e @ruoli).
 * Progettato per essere puro, disaccoppiato dall'interfaccia e riutilizzabile
 * identico per CLI (Tab-completion), TUI (popup box) e WebUI (dropdown popover).
 */

export interface MentionCandidate {
  tag: string;           // Es. '@geordi' o '@developer'
  name: string;          // Es. 'geordi' o 'developer'
  displayName: string;   // Es. 'Geordi La Forge' o '💻 Sviluppatore Software'
  kind: 'character' | 'role';
  description?: string;
}

export interface CharacterMentionData {
  name: string;
  displayName: string;
  role?: string;
  description?: string;
}

export interface RoleMentionData {
  name: string;
  displayName: string;
  description?: string;
}

/**
 * Risolve la lista ordinata dei candidati a partire da una query (es. '@g', 'geo', '@dev').
 */
export function getMentionCandidates(
  query: string,
  characters: CharacterMentionData[],
  roles: RoleMentionData[] = []
): MentionCandidate[] {
  const cleanQuery = query.startsWith('@') ? query.slice(1).toLowerCase().trim() : query.toLowerCase().trim();

  const candidates: MentionCandidate[] = [];

  // 1. Aggiungi personaggi
  for (const c of characters) {
    const matchesName = c.name.toLowerCase().startsWith(cleanQuery);
    const matchesDisplayName = c.displayName.toLowerCase().split(/\s+/).some((w) => w.startsWith(cleanQuery));

    if (!cleanQuery || matchesName || matchesDisplayName) {
      candidates.push({
        tag: `@${c.name}`,
        name: c.name,
        displayName: c.displayName,
        kind: 'character',
        description: c.description || (c.role ? `Ruolo: ${c.role}` : undefined),
      });
    }
  }

  // 2. Aggiungi ruoli
  for (const r of roles) {
    const matchesName = r.name.toLowerCase().startsWith(cleanQuery);
    const matchesDisplayName = r.displayName.toLowerCase().split(/\s+/).some((w) => w.startsWith(cleanQuery));

    if (!cleanQuery || matchesName || matchesDisplayName) {
      // Evita duplicati esatti se un ruolo ha lo stesso nome di un personaggio
      if (!candidates.some((c) => c.tag === `@${r.name}`)) {
        candidates.push({
          tag: `@${r.name}`,
          name: r.name,
          displayName: r.displayName,
          kind: 'role',
          description: r.description,
        });
      }
    }
  }

  return candidates;
}

/**
 * Restituisce i soli tag di completamento (es. ['@geordi', '@developer']) per i sistemi readline/Tab.
 */
export function getMentionTags(
  query: string,
  characters: CharacterMentionData[],
  roles: RoleMentionData[] = []
): string[] {
  return getMentionCandidates(query, characters, roles).map((c) => c.tag);
}
