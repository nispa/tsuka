import chalk from 'chalk';
import { CommandCtx } from './types';
import { CLITheme } from '../ui';
import { getModelTier } from '../../tools/registry';
import { ReasoningEffort } from '../../core/provider';
import {
  getEffortPin, setEffortPin, isAskModeEnabled, setAskMode,
  describeEffortSource, describeToolDiff
} from '../../core/effortControl';

/**
 * Comando `/effort` (T8.14, TASKS.md — FASE 3): controllo globale del
 * reasoning_effort a runtime. Tre forme:
 *  - `/effort`               → mostra il livello attivo, la provenienza e il
 *    tier di tool che ne consegue;
 *  - `/effort <livello>`     → fissa il pin (in memoria di processo, non in
 *    tsuka.config.json — sparisce al riavvio);
 *  - `/effort auto`          → rimuove il pin, torna alla cascata di T8.10;
 *  - `/effort ask`           → alterna la modalità ask (conferma quando un
 *    turno di CHAT diverge dal riferimento; MAI in /team, /goal o nei figli
 *    di spawn_agent, che degradano sempre a riga di log).
 */

const VALID_LEVELS: ReasoningEffort[] = ['none', 'low', 'medium', 'xhigh'];

/** Ruolo/personaggio attivi ORA, secondo la stessa logica di recreateAgent (index.ts). */
function activeRoleAndCharacter(ctx: CommandCtx) {
  const charName = ctx.configManager.getActiveCharacter();
  const char = ctx.loadCharacter(charName);
  const roleName = char ? char.role : ctx.configManager.getActiveRole();
  const role = ctx.loadRole(roleName);
  return { char, role };
}

/** Nomi dei tool visibili al modello attivo, a un dato livello di effort. */
function toolNamesAt(ctx: CommandCtx, allowedTools: string[] | undefined, effort: ReasoningEffort | undefined): string[] {
  return ctx.registry.listForLLM(ctx.provider.getCurrentModel(), allowedTools, effort)
    .map((t) => t.function.name)
    .sort();
}

function printStatus(ctx: CommandCtx): void {
  const { char, role } = activeRoleAndCharacter(ctx);
  const configDefault = ctx.configManager.getDefaultReasoningEffort();
  const { effort, source } = describeEffortSource(char, role, configDefault);
  const tier = getModelTier(ctx.provider.getCurrentModel(), effort);
  const tierColor = tier === 'large' ? chalk.green : tier === 'medium' ? chalk.yellow : chalk.red;

  const sourceLabel: Record<string, string> = {
    pin: 'pin globale (/effort)',
    personaggio: `personaggio (${char?.displayName ?? char?.name ?? '—'})`,
    ruolo: `ruolo (${role.displayName})`,
    default: 'default di configurazione (tsuka.config.json)',
    nessuno: 'nessuno — decide il modello'
  };

  console.log(chalk.bold('\n🎚️  EFFORT DI RAGIONAMENTO'));
  console.log(`  Livello attivo: ${chalk.magenta(effort ?? 'nessuno (decide il modello)')}`);
  console.log(`  Provenienza:    ${chalk.cyan(sourceLabel[source])}`);
  console.log(`  Tier dei tool:  ${tierColor(tier.toUpperCase())} (per il modello '${ctx.provider.getCurrentModel()}')`);
  console.log(`  Pin globale:    ${getEffortPin() ? chalk.magenta(getEffortPin()) : chalk.gray('nessuno')}`);
  console.log(`  Modalità ask:   ${isAskModeEnabled() ? chalk.green('attiva') : chalk.gray('disattiva')} ${chalk.gray('(solo nella chat interattiva)')}`);
  console.log(chalk.gray('  Uso: /effort <none|low|medium|xhigh> · /effort auto · /effort ask'));
  console.log();
}

/** Applica un nuovo pin (o lo rimuove con undefined), ricrea l'agente e annuncia l'eventuale cambio di tool visibili. */
function applyPinAndAnnounce(ctx: CommandCtx, newPin: ReasoningEffort | undefined, label: string): void {
  const { role } = activeRoleAndCharacter(ctx);
  const before = toolNamesAt(ctx, role.allowedTools, ctx.agent.current.getReasoningEffort());

  setEffortPin(newPin);
  ctx.agent.current = ctx.recreateAgent();

  const after = toolNamesAt(ctx, role.allowedTools, ctx.agent.current.getReasoningEffort());
  const diff = describeToolDiff(before, after);

  CLITheme.success(label);
  if (diff) {
    // È l'effetto collaterale meno intuibile del comando (T8.14): l'effort non
    // regola solo il ragionamento, decide anche quali tool il modello vede
    // (T8.12) — va detto subito, non lasciato scoprire a sorpresa.
    CLITheme.warning(`Cambiano i tool visibili al modello: ${diff}`);
  } else {
    CLITheme.info('Nessun cambiamento nel set di tool visibili al modello.');
  }
}

export async function handleEffort(ctx: CommandCtx, arg: string): Promise<void> {
  const normalized = arg.trim().toLowerCase();

  if (!normalized) {
    printStatus(ctx);
    return;
  }

  if (normalized === 'auto') {
    if (getEffortPin() === undefined) {
      CLITheme.info('Nessun pin attivo: già in modalità automatica (cascata personaggio → ruolo → default).');
      return;
    }
    applyPinAndAnnounce(ctx, undefined, 'Pin rimosso: ripristinata la cascata automatica (personaggio → ruolo → default di configurazione).');
    return;
  }

  if (normalized === 'ask') {
    const nowEnabled = !isAskModeEnabled();
    setAskMode(nowEnabled);
    if (nowEnabled) {
      CLITheme.success('Modalità ask attivata: la chat chiederà conferma quando un turno diverge dal livello di riferimento.');
      CLITheme.info('Non si applica a /team, /goal né ai figli di spawn_agent: lì la divergenza resta solo una riga di log, mai un blocco.');
    } else {
      CLITheme.success('Modalità ask disattivata: le divergenze tornano a essere solo segnalate, non chieste.');
    }
    return;
  }

  if (!VALID_LEVELS.includes(normalized as ReasoningEffort)) {
    CLITheme.error(`Livello non valido: '${arg}'. Valori ammessi: ${VALID_LEVELS.join(', ')}, oppure 'auto' o 'ask'.`);
    return;
  }

  const level = normalized as ReasoningEffort;
  applyPinAndAnnounce(ctx, level, `Pin di effort impostato a '${level}' (vale per l'intera sessione, sopra personaggio/ruolo/default; non sopravvive al riavvio).`);
}
