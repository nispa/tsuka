import * as path from 'path';

/**
 * Home dell'applicazione vs workspace — distinzione chiave per il comando globale.
 *
 * - **App home**: la cartella di installazione di TSUKA, dove vivono gli asset
 *   dell'app (tools_schemas/, roles/, traits/, characters/, teams/), la
 *   configurazione (tsuka.config.json, .env), la memoria condivisa (memory/),
 *   i profili dei modelli (models_profile.json) e la history del prompt.
 * - **Workspace**: la cartella da cui il comando viene lanciato (process.cwd()),
 *   su cui operano i file tool degli agenti (read/write/edit/list/grep con path
 *   relativi). Resta volutamente legato alla cwd: è "dove l'agente lavora".
 *
 * Finché TSUKA viene avviato dalla cartella del progetto (npm run dev) le due
 * coincidono e il comportamento è identico a prima. Lanciato come comando
 * globale (`tsuka`) da un'altra cartella, gli asset seguono l'installazione
 * mentre i file tool operano sulla cartella corrente.
 *
 * Risoluzione della home: la variabile d'ambiente TSUKA_HOME se impostata
 * (deve essere una env var reale, non una voce del .env: il .env stesso viene
 * caricato dalla home), altrimenti la root del pacchetto — due livelli sopra
 * questo modulo, valido sia in dev con tsx (src/core/) sia dopo la build
 * (dist/core/).
 */
export function getAppHome(): string {
  const env = process.env.TSUKA_HOME;
  if (env && env.trim().length > 0) {
    return path.resolve(env.trim());
  }
  return path.resolve(__dirname, '..', '..');
}

/** Risolve un percorso dentro la home dell'app. */
export function homePath(...segments: string[]): string {
  return path.join(getAppHome(), ...segments);
}
