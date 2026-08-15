/**
 * Test del catalogo personaggi e dei preset (T7.1, TASKS.md — FASE 2).
 *
 * Copre i due criteri di accettazione:
 * 1) Copertura dei ruoli: per ogni file in roles/ esiste almeno un character che lo usa.
 *    Prima del task questo è FALSO per 'developer' (nessun personaggio nel repo lo usa,
 *    quindi /goal non può mai assegnare codice a uno sviluppatore) — vedi AGENTS.md
 *    "Character system" e TASKS.md §"Perché questa fase", punto 3.
 * 2) Validazione dei manifest in presets/ (core.json + packs/*.json): ogni nome citato
 *    (role/trait/character/team) esiste davvero su disco, e ogni character elencato nel
 *    core usa un role e un trait a loro volta elencati nel core — altrimenti
 *    `tsuka init --preset core` (T7.2) produrrebbe un'installazione con riferimenti rotti.
 *
 * Esecuzione: npx tsx tests/test_presets.ts
 */
import * as fs from 'fs';
import * as path from 'path';

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

const ROOT = process.cwd();

function listJsonNames(dir: string): string[] {
  const full = path.resolve(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((f) => f.endsWith('.json')).map((f) => path.basename(f, '.json'));
}

function loadJson(dir: string, name: string): any {
  return JSON.parse(fs.readFileSync(path.resolve(ROOT, dir, `${name}.json`), 'utf-8'));
}

function assetExists(kind: 'roles' | 'traits' | 'characters' | 'teams', name: string): boolean {
  return fs.existsSync(path.resolve(ROOT, kind, `${name}.json`));
}

interface PresetManifest {
  name: string;
  displayName?: string;
  description?: string;
  roles?: string[];
  traits?: string[];
  characters?: string[];
  teams?: string[];
  note?: string;
}

function main() {
  console.log('=== Test catalogo personaggi e preset (T7.1) ===\n');

  // --- 1) Copertura dei ruoli: ogni role/*.json usato da almeno un character/*.json ---
  const roleNames = listJsonNames('roles');
  const characterNames = listJsonNames('characters');
  const characters = characterNames.map((n) => ({ file: n, ...loadJson('characters', n) }));

  check('T7.1-roles-exist', roleNames.length > 0, `roles/ contiene ${roleNames.length} file`);
  check('T7.1-characters-exist', characterNames.length > 0, `characters/ contiene ${characterNames.length} file`);

  // Il conteggio include le skill secondarie (multi-skill T9.1): un ruolo coperto solo
  // come skill sbloccata è comunque assegnabile, purché qualcuno lo possieda.
  const declaredRoles = (c: any): string[] =>
    (Array.isArray(c.roles) && c.roles.length > 0 ? c.roles : [c.role]).filter(Boolean);

  for (const roleName of roleNames) {
    const users = characters.filter((c) => declaredRoles(c).includes(roleName)).map((c) => c.file);
    check(
      `T7.1-role-coverage-${roleName}`,
      users.length > 0,
      users.length > 0
        ? `il ruolo '${roleName}' è usato da: ${users.join(', ')}`
        : `NESSUN character usa il ruolo '${roleName}' — /goal non può mai assegnargli un compito`
    );
  }

  // --- 2) Manifest dei preset: core.json + packs/*.json ---
  const presetsDir = path.resolve(ROOT, 'presets');
  const packsDir = path.resolve(presetsDir, 'packs');

  const manifestRefs: { label: string; relPath: string }[] = [];
  const corePath = path.join(presetsDir, 'core.json');
  check('T7.1-core-manifest-exists', fs.existsSync(corePath), `presets/core.json esiste`);
  if (fs.existsSync(corePath)) manifestRefs.push({ label: 'core', relPath: 'presets/core.json' });

  const expectedPacks = ['osint', 'content', 'devops', 'demo'];
  for (const packName of expectedPacks) {
    const packPath = path.join(packsDir, `${packName}.json`);
    check(`T7.1-pack-manifest-exists-${packName}`, fs.existsSync(packPath), `presets/packs/${packName}.json esiste`);
    if (fs.existsSync(packPath)) manifestRefs.push({ label: `pack:${packName}`, relPath: `presets/packs/${packName}.json` });
  }

  let coreManifest: PresetManifest | null = null;
  let demoManifest: PresetManifest | null = null;

  for (const { label, relPath } of manifestRefs) {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(ROOT, relPath), 'utf-8')) as PresetManifest;
    if (label === 'core') coreManifest = manifest;
    if (label === 'pack:demo') demoManifest = manifest;

    (['roles', 'traits', 'characters', 'teams'] as const).forEach((kind) => {
      for (const name of manifest[kind] || []) {
        check(
          `T7.1-manifest-ref-${label}-${kind}-${name}`,
          assetExists(kind, name),
          `${label}: '${kind}/${name}.json' referenziato nel manifest esiste su disco`
        );
      }
    });
  }

  // --- 3) Auto-consistenza del core: ogni character elencato usa role/trait elencati ---
  if (coreManifest) {
    const coreRoles = new Set(coreManifest.roles || []);
    const coreTraits = new Set(coreManifest.traits || []);
    check('T7.1-core-has-characters', (coreManifest.characters || []).length > 0, `core elenca ${(coreManifest.characters || []).length} character`);
    for (const charName of coreManifest.characters || []) {
      if (!assetExists('characters', charName)) continue; // già segnalato sopra
      const charData = loadJson('characters', charName);
      check(
        `T7.1-core-selfcontained-role-${charName}`,
        coreRoles.has(charData.role),
        `character core '${charName}' usa role '${charData.role}' ${coreRoles.has(charData.role) ? 'presente' : 'ASSENTE'} nella lista roles del core`
      );
      check(
        `T7.1-core-selfcontained-trait-${charName}`,
        coreTraits.has(charData.trait),
        `character core '${charName}' usa trait '${charData.trait}' ${coreTraits.has(charData.trait) ? 'presente' : 'ASSENTE'} nella lista traits del core`
      );
    }

    // Nessun doppione di ruolo nel core (una competenza distinta ciascuno, TASKS.md T7.1)
    const roleAssignments = (coreManifest.characters || [])
      .filter((c) => assetExists('characters', c))
      .map((c) => loadJson('characters', c).role as string);
    const uniqueRoles = new Set(roleAssignments);
    check(
      'T7.1-core-no-duplicate-roles',
      uniqueRoles.size === roleAssignments.length,
      `ogni character del core copre un ruolo distinto (${uniqueRoles.size} ruoli unici su ${roleAssignments.length} character)`
    );
  } else {
    check('T7.1-core-manifest-present', false, 'presets/core.json non trovato: impossibile validare auto-consistenza');
  }

  // --- 4) Pack demo: nota didattica sui tratti dannosi (compliant/sensual) ---
  if (demoManifest) {
    check(
      'T7.1-demo-has-note',
      typeof demoManifest.note === 'string' && demoManifest.note.trim().length > 0,
      `pack demo ha un campo 'note' che spiega perché ospita tratti dannosi come esempio didattico`
    );
    check(
      'T7.1-demo-contains-expected',
      ['sensual', 'compliant'].every((t) => (demoManifest!.traits || []).includes(t)) &&
        ['deanna_troi', 'q'].every((c) => (demoManifest!.characters || []).includes(c)),
      `pack demo contiene i trait 'sensual'/'compliant' e i characters 'deanna_troi'/'q'`
    );

    // L'esempio didattico vive solo se un personaggio incarna il tratto dannoso:
    // un trait elencato nel manifest ma senza nessuno che lo usi non insegna nulla
    // (è successo con la rinomina del roster, che aveva rimosso l'unico 'compliant').
    for (const traitName of demoManifest.traits || []) {
      const users = (demoManifest.characters || [])
        .filter((c) => assetExists('characters', c))
        .filter((c) => loadJson('characters', c).trait === traitName);
      check(
        `T7.1-demo-trait-incarnato-${traitName}`,
        users.length > 0,
        users.length > 0
          ? `il trait '${traitName}' del pack demo è incarnato da: ${users.join(', ')}`
          : `il trait '${traitName}' è elencato nel pack demo ma NESSUN suo character lo usa: l'esempio didattico non è dimostrabile`
      );
    }
  } else {
    check('T7.1-demo-manifest-present', false, 'presets/packs/demo.json non trovato');
  }

  // --- 5) Integrità dei team: ogni membro e ogni orchestrator esiste in characters/ (T7.3) ---
  // Un membro inesistente non fa fallire /team: viene avvisato e saltato
  // (`strategies/common.ts`, resolveCharacter → null). Il team gira quindi in silenzio
  // con meno agenti del previsto — degradazione che solo un test come questo intercetta.
  for (const teamName of listJsonNames('teams')) {
    const teamData = loadJson('teams', teamName);
    for (const memberName of (teamData.members || []) as string[]) {
      check(
        `T7.3-team-member-${teamName}-${memberName}`,
        assetExists('characters', memberName),
        assetExists('characters', memberName)
          ? `team '${teamName}': il membro '${memberName}' esiste`
          : `team '${teamName}': il membro '${memberName}' NON esiste in characters/ — verrebbe saltato a runtime`
      );
    }
    if (typeof teamData.orchestrator === 'string' && teamData.orchestrator.length > 0) {
      check(
        `T7.3-team-orchestrator-${teamName}`,
        assetExists('characters', teamData.orchestrator),
        `team '${teamName}': l'orchestrator '${teamData.orchestrator}' esiste in characters/`
      );
    }
  }

  // --- 6) Simulazione delle installazioni reali: core da solo e core+pack (T7.4) ---
  // `tsuka init` copia alla lettera i nomi elencati nei manifest (initCmd.ts,
  // copyCategoryAssets), senza risolvere dipendenze: un team che cita un membro
  // non installato gira in silenzio con meno agenti, e una skill il cui role non è
  // stato copiato non è equipaggiabile con /skill. I pack si installano SOPRA il
  // core, quindi la verifica è sull'unione core+pack, non sul pack isolato.
  if (coreManifest) {
    const packNames = listJsonNames('presets/packs');
    const installs: { label: string; manifests: PresetManifest[] }[] = [
      { label: 'core', manifests: [coreManifest] },
      ...packNames.map((p) => ({
        label: `core+${p}`,
        manifests: [coreManifest!, loadJson('presets/packs', p) as PresetManifest]
      }))
    ];

    for (const { label, manifests } of installs) {
      const chars = new Set(manifests.flatMap((m) => m.characters || []));
      const roles = new Set(manifests.flatMap((m) => m.roles || []));
      const traits = new Set(manifests.flatMap((m) => m.traits || []));
      const teams = new Set(manifests.flatMap((m) => m.teams || []));

      for (const teamName of teams) {
        if (!assetExists('teams', teamName)) continue; // già segnalato sopra
        const teamData = loadJson('teams', teamName);
        const missing = ([...(teamData.members || []), teamData.orchestrator] as (string | undefined)[])
          .filter((m): m is string => !!m)
          .filter((m) => !chars.has(m));
        check(
          `T7.4-install-${label}-team-${teamName}`,
          missing.length === 0,
          missing.length === 0
            ? `installazione '${label}': il team '${teamName}' ha tutti i suoi membri installati`
            : `installazione '${label}': il team '${teamName}' cita ${missing.join(', ')} che il preset NON installa`
        );
      }

      for (const charName of chars) {
        if (!assetExists('characters', charName)) continue; // già segnalato sopra
        const charData = loadJson('characters', charName);
        const missingRoles = declaredRoles(charData).filter((r: string) => !roles.has(r));
        check(
          `T7.4-install-${label}-skills-${charName}`,
          missingRoles.length === 0,
          missingRoles.length === 0
            ? `installazione '${label}': '${charName}' ha su disco tutti i role delle sue skill`
            : `installazione '${label}': '${charName}' dichiara la skill ${missingRoles.join(', ')} ma il preset NON installa quel role`
        );
        check(
          `T7.4-install-${label}-trait-${charName}`,
          !charData.trait || traits.has(charData.trait),
          `installazione '${label}': il trait '${charData.trait}' di '${charName}' è installato`
        );
      }
    }
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
