/**
 * Mention candidate resolution engine (@characters and @roles).
 * Designed to be pure, decoupled from UI rendering, and shared across
 * CLI (Tab-completion), TUI, and Web interfaces.
 */

export interface MentionCandidate {
  tag: string;           // e.g. '@geordi' or '@developer'
  name: string;          // e.g. 'geordi' or 'developer'
  displayName: string;   // e.g. 'Geordi La Forge' or '💻 Software Developer'
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
 * Resolves an ordered list of mention candidates from a query (e.g. '@g', 'geo', '@dev').
 */
export function getMentionCandidates(
  query: string,
  characters: CharacterMentionData[],
  roles: RoleMentionData[] = []
): MentionCandidate[] {
  const cleanQuery = query.startsWith('@') ? query.slice(1).toLowerCase().trim() : query.toLowerCase().trim();

  const candidates: MentionCandidate[] = [];

  // 1. Add characters
  for (const c of characters) {
    const matchesName = c.name.toLowerCase().startsWith(cleanQuery);
    const matchesDisplayName = c.displayName.toLowerCase().split(/\s+/).some((w) => w.startsWith(cleanQuery));

    if (!cleanQuery || matchesName || matchesDisplayName) {
      candidates.push({
        tag: `@${c.name}`,
        name: c.name,
        displayName: c.displayName,
        kind: 'character',
        description: c.description || (c.role ? `Role: ${c.role}` : undefined),
      });
    }
  }

  // 2. Add roles
  for (const r of roles) {
    const matchesName = r.name.toLowerCase().startsWith(cleanQuery);
    const matchesDisplayName = r.displayName.toLowerCase().split(/\s+/).some((w) => w.startsWith(cleanQuery));

    if (!cleanQuery || matchesName || matchesDisplayName) {
      // Avoid duplicate tags if a role shares a name with a character
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
 * Returns completion tags only (e.g. ['@geordi', '@developer']) for readline/Tab completers.
 */
export function getMentionTags(
  query: string,
  characters: CharacterMentionData[],
  roles: RoleMentionData[] = []
): string[] {
  return getMentionCandidates(query, characters, roles).map((c) => c.tag);
}
