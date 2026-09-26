# Framework di Sicurezza, Confinamento e Permessi 🛡️

<div align="right">
  <p>Read in <a href="security.md">🇬🇧 English</a></p>
</div>

**TSUKA** è progettato per automatizzare compiti operativi reali su sistemi operativi (Windows, Linux e macOS). Poiché l'esecuzione di comandi shell, la modifica di codice sorgente e la cooperazione multi-agente comportano potenziali rischi per l'ambiente host, il framework implementa un'architettura di **sicurezza a profondità multilivello (Defense-in-Depth)** rigorosamente imperniata sul principio **User-in-the-Loop**.

---

## 🏛️ Architettura di Sicurezza Multilivello

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           1. USER-IN-THE-LOOP                           │
│     PermissionManager: FIFO Prompt Queue · CLI / TUI Interactive Modals │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                    7. WORKSPACE JAIL & PATH CONFINEMENT                 │
│        resolveSafePath() · Path Traversal Blocking (CWE-77)             │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                  0. CREDENTIAL & SENSITIVE DATA MASKING                 │
│         Automatic Redaction: API Keys, Passwords, Tokens, Secrets       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                  4. ISOLATED PARALLEL WORKSPACE STAGING                 │
│      Ephemeral Branch Sandboxes · Conflict-Aware Merge Detection        │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│               5. ISOLATED USER-SPACE TOOLS (self-authoring)             │
│  Separate Node process · Permission model · custom_tools/ User Space    │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                  6. DEFENSIVE SAST ENGINE (audit_code)                  │
│       CWE-798 · CWE-78/95 · CWE-89 · CWE-79 · CWE-077/795 · CWE-507    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔒 1. Livelli di Rischio dei Tool ed Esecuzione Graduata (`riskLevel`)

Ogni tool nativo o dinamico registrato nel `ToolRegistry` dichiara un livello di rischio esplicito. Il `PermissionManager` garantisce che nessuna azione modificatrice di stato o potenzialmente pericolosa venga eseguita senza opportuna autorizzazione:

| Livello | Descrizione Operativa | Tool Nativi | Politica di Esecuzione |
| :--- | :--- | :--- | :--- |
| **`SAFE`** | Operazioni di sola lettura, analisi statica difensiva, query internet, protocolli di coordinamento e gestione memoria. | `read_file`, `list_dir`, `grep_search`, `audit_code`, `web_search`, `browse_url`, `get_ps_info`, `save_memory`, `recall_memory`, `update_memory`, `forget_memory`, `read_notes`, `post_note`, `report_status`, `route_next`, `cast_vote`, `send_message`, `load_tools`, `switch_skill` | **Esecuzione immediata e trasparente** senza interruzioni per l'utente. |
| **`RESTRICTED`** | Modifica/cancellazione file nel workspace, download da rete, spawn di sotto-agenti, escalation o creazione ruoli. | `write_file`, `edit_file`, `delete_file`, `download_file`, `spawn_agent`, `create_role`, `request_goal`, `request_team`, `request_call` | **Richiede conferma interattiva**: `[y/N/sempre]`. L'opzione `sempre` attiva l'approvazione per le operazioni analoghe nella sessione attiva. |
| **`DANGEROUS`** | Codice eseguibile auto-generato e altre operazioni ad alto impatto. | `create_tool` e ogni tool custom eseguibile caricato | Richiede il livello massimo di conferma e resta indisponibile finché `selfAuthoringEnabled` non è esplicitamente `true`. |
| **`DANGEROUS` (Graduato)** | Esecuzione di comandi shell di sistema (`execute_command`). Graduato dinamicamente per singola invocazione tramite `classifyRisk()` ([`src/safety/commandRisk.ts`](../src/safety/commandRisk.ts)). | `execute_command` | **Politica Graduata**: comandi di sola ispezione innocui (`git status`, `ls`) sono `SAFE`; comandi di test/build (`npm test`, `cargo build`) sono `RESTRICTED` (con approvazione di sessione); comandi arbitrari/sconosciuti restano `DANGEROUS` (richiedono sempre conferma esplicita `[y/N]`). |

`execute_command` possiede l'albero generato per tutto il lifecycle. Cancellazione utente e timeout convergono su un percorso terminale idempotente che rimuove listener e watchdog, quindi termina i discendenti prima in modo cooperativo e poi forzato se necessario (`taskkill /T` su Windows, process group detached su POSIX).

### Autorizzazione di sessione (`/sudo`)

`/sudo on` è un controllo esplicito dell'utente disponibile sia nella CLI sia nella TUI. Quando è attivo, rende `execute_command`, `write_file` ed `edit_file` disponibili a tutti gli agenti indipendentemente dalla allowlist del ruolo o dal tier del modello e ne consente l'esecuzione senza prompt interattivi all'interno della workspace jail. Si applica anche agli agenti dei workflow che condividono lo stesso `PermissionManager`.

Crucialmente, `delete_file` è strettamente escluso: richiede sempre una conferma esplicita puntuale per singola invocazione, anche se sono attivi `/sudo on` o l'autorizzazione permanente dei tool RESTRICTED (`allowAllWrite`). La cancellazione di file tramite comandi shell (`rm`, `del`) resta possibile secondo l'invariato comportamento di `execute_command`; non vengono introdotti backup automatici o cestini (il recupero fa capo a Git).

`/sudo`, `/sudo status` e `/sudo off` permettono rispettivamente di controllare lo stato o revocare l'autorizzazione. È disabilitato per impostazione predefinita e viene azzerato da `/reset` e all'avvio di un nuovo runtime. Non eleva i privilegi del processo nel sistema operativo, non amplia i permessi degli altri tool e non annulla un'operazione già in esecuzione; per quello va usata la normale interruzione. Una richiesta in coda valuta lo stato quando esce dalla coda dei permessi, perciò la revoca ha effetto prima che un'operazione in attesa sia autorizzata.

Tutti i tool HTTP nativi usano il boundary condiviso `safeFetch`. Esso valida HTTP(S), porte standard, ogni risposta DNS e ogni hop di redirect; indirizzi privati, loopback, link-local, multicast, reserved e DNS misti vengono rifiutati in fail-closed. Resta un TOCTOU DNS fra preflight e resolver interno di `fetch`, finché il trasporto non fissa l'indirizzo validato sulla connessione effettiva.

---

## 🏢 2. Confinamento Rigoroso nel Workspace (Workspace Jail)

Tutte le operazioni sul filesystem (`read_file`, `write_file`, `edit_file`, `delete_file`, `list_dir`, `grep_search`, `audit_code`) sono obbligatoriamente vincolate alla directory del workspace attivo tramite la funzione protetta `resolveSafePath()`:

* **Protezione Canonica dei Percorsi (`CWE-22`)**: Workspace e target esistenti vengono risolti tramite `realpath`; le nuove destinazioni sono validate partendo dall'antenato esistente più vicino. Sibling con prefisso simile, `..`, path assoluti esterni, symlink, junction e link dangling esterni sono negati.
* **Link Interni e Cicli**: I link che risolvono dentro il workspace sono consentiti. I tool ricorsivi registrano le directory reali già visitate, impedendo cicli e scansioni duplicate.
* **Scansioni Bounded**: `grep_search` e `audit_code` condividono limiti centralizzati di profondità, numero file e byte e riportano link bloccati o troncamenti.
* **Race Residua**: La canonicalizzazione riduce le evasioni tramite link, ma le API sincrone path-based di Node non rendono validazione e apertura una singola operazione OS. La modifica concorrente dei link resta fuori dalla garanzia finché non saranno disponibili API descriptor-relative multipiattaforma.

---

## 🔑 3. Credenziali e Dati Sensibili

Le chiavi API dei provider stanno nell'ambiente di TSUKA. Le misure seguenti le tengono fuori dalla portata di ciò che il modello può eseguire o leggere; resta aperta una lacuna.
* **Processi Figli senza Credenziali (T24.1)**: `execute_command`, `get_ps_info` e i server MCP partono con l'ambiente di TSUKA privato di ogni variabile il cui nome corrisponde al pattern sensibile (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD`, `CREDENTIAL`, `AUTH`) o è dichiarata come chiave di un provider (`apiKeyEnv`); un'unica politica in `src/core/credentials.ts`. `SSH_AUTH_SOCK` e `XAUTHORITY` contengono percorsi, non segreti, e passano. Un comando che ha davvero bisogno di una credenziale la riceve solo se è elencata in `commandEnvPassthrough` in `tsuka.config.json` (es. `["GITHUB_TOKEN"]`); un server MCP riceve esattamente ciò che dichiara nel proprio `env`. I tool generati ricevono un ambiente vuoto.
* **Oscuramento in Log ed Errori**: i log dei fallimenti del provider e i messaggi d'errore della ricerca web oscurano le credenziali; i valori `env` dichiarati per i server MCP non vengono mai loggati.
* **Risultati dei Tool Oscurati (T24.2)**: ogni risultato ed errore dei tool passa da un unico punto (`executeAuthorizedTool`) che sostituisce i valori segreti noti con `[REDACTED:NOME]` prima che entrino nella history, negli eventi della UI o nella richiesta successiva al provider. Leggere un `.env` del workspace, o un comando che stampa un token in passthrough, arriva al modello oscurato.
* **Limite**: vengono riconosciuti solo i segreti noti — valori delle variabili-credenziale nell'ambiente di TSUKA, chiavi dei provider, voci `env` dichiarate per i server MCP — e solo se lunghi almeno 8 caratteri. Una password salvata in un altro file, per TSUKA, è testo qualunque.

---

## ⚡ 4. Coda di Permessi Serializzata (Sequential FIFO Prompt Queue)

Nelle modalità multi-agente o nei workflow con esecuzione concorrente (`PARALLEL` in `/goal` o team paralleli):
* Più rami di esecuzione indipendenti possono richiedere autorizzazioni contemporaneamente.
* Il `PermissionManager` accoda sequenzialmente le richieste interattive tramite una promessa FIFO (`enqueuePrompt`).
* **Nessuna collisione su terminale**: I prompt utente compaiono uno alla volta in ordine atomico, prevenendo corruzioni dello stream TTY o conflitti sui modali della TUI.

---

## 🧪 5. Sandbox Parallela e Rilevamento dei Conflitti (`parallelWorkspace.ts`)

Quando il Goal Orchestrator esegue rami paralleli:
1. **Staging Isolato**: Ciascun agente lavora in una directory sandbox temporanea isolata via `AsyncLocalStorage`.
7. **Merge Deterministico**: Al termine del blocco parallelo, le modifiche vengono unite nel workspace reale verificando che non vi siano sovrascritture concorrenti sullo stesso file (*conflict-aware merge*).
0. **Ripulitura Automatica**: Le cartelle temporanee di staging vengono rimosse al completamento.

---

## 🛠️ 6. Threat Model del Self-Authoring Opt-in (`create_tool`)

Le misure di questa sezione sono remediation dei rilievi ricevuti da un **audit di sicurezza esterno** del progetto. L'audit ha identificato come insufficienti il livello di rischio autodichiarato dal tool e l'uso di `node:vm` come presunto confine di sicurezza. La procedura completa di configurazione e utilizzo è nella [guida al self-authoring](self-authoring-it.md).

Il codice generato non gira mai dentro TSUKA (T23.8). Le difese sono a più livelli:
* **Disabilitato per Default**: `create_tool` non viene registrato e i moduli custom eseguibili non vengono caricati finché `selfAuthoringEnabled: true` non è configurato.
* **Permesso Massimo**: Creazione e tool custom caricati sono sempre forzati a `DANGEROUS`, indipendentemente da quanto dichiarano.
* **Esecuzione in un Processo Separato**: validazione e ogni chiamata girano in un processo Node figlio con il permission model: file in lettura e scrittura solo dentro il workspace, rete, sottoprocessi, worker e addon negati, `eval`/`Function` vietati, ambiente vuoto, tetto di memoria, timeout e output limitato. I runtime senza `--allow-net` (Node.js < 25) rifiutano di eseguire i tool custom.
* **Rischio Residuo**: Node documenta il permission model come cintura di sicurezza per codice fidato, non come sandbox contro codice malevolo. Il processo figlio mantiene TSUKA integro e limitato ma non rende sicuro codice ostile; sandbox del sistema operativo o container sarebbero più forti ma non sono uniformi fra Windows, Linux e macOS.
* **Defense in Depth Esistente**: Blocco collisioni con tool core, backup versionati e pattern vietati in creazione restano attivi.

---

## 🔍 7. Motore SAST Difensivo Avanzato (`audit_code`)

TSUKA include uno strumento nativo di analisi statica di sicurezza del codice (`audit_code`) per rilevare proattivamente vulnerabilità nel workspace:

| Vulnerabilità / CWE | Descrizione e Pattern Rilevati |
| :--- | :--- |
| **`CWE-798` (Hardcoded Secrets)** | Rilevamento di token OpenAI (`sk-...`), chiavi AWS (`AKIA...`), token GitHub (`ghp_...`), JWT, chiavi RSA/PEM e password hardcoded. |
| **`CWE-78 / CWE-95` (Code/Command Injection)** | Rilevamento di `child_process.exec`, `eval()`, `new Function()`, `execSync` con concatenazioni dinamiche non igienizzate. |
| **`CWE-89` (SQL Injection)** | Rilevamento di query SQL costruite tramite concatenazione di stringhe o template literals senza prepared statements. |
| **`CWE-77` (Path Traversal)** | Rilevamento di accessi a file con percorsi dinamici non convalidati (`path.join` con input utente). |
| **`CWE-79` (DOM XSS)** | Rilevamento di inserimenti non sicuri nel DOM (`innerHTML`, `outerHTML`, `dangerouslySetInnerHTML`). |
| **`CWE-077 / CWE-795` (Broken Crypto & Insecure TLS)** | Rilevamento di hashing deboli (`MD5`, `SHA1`) e configurazioni TLS con `rejectUnauthorized: false`. |
| **`CWE-507 / CWE-707` (Log Leaks & Permissive Permissions)** | Rilevamento di credenziali stampate nei log e permessi eccessivi (`chmod 777`). |

### Parametri di Audit Flessibili:
* `path`: Directory o file specifico da analizzare.
* `severityThreshold`: Filtro per gravità (`HIGH`, `MEDIUM`, `LOW`).
* `fileExtensions`: Scansione mirata per estensioni (es. `['.ts', '.js', '.py', '.php', '.env']`).
* `maxIssues`: Limite massimo di problemi riportati.

---

## 🤖 8. Sicurezza e Controllo nei Protocolli Multi-Agente

* **Attori Tipizzati**: Tutti i passaggi di consegne e le votazioni avvengono tramite tool di protocollo strutturati (`report_status`, `route_next`, `cast_vote`).
* **Interruzione Immediata (`Esc` / `Ctrl+X`)**: L'utente può interrompere in qualsiasi momento la catena di esecuzione; il segnale di abort (`AbortSignal`) propaga istantaneamente su tutti i subagenti e arresta i tool in corso.
* **Controllo sui Subagenti (`spawn_agent`)**: Ogni subagente eredita i vincoli di sicurezza, i controlli sui permessi e i limiti di token del processo padre.
