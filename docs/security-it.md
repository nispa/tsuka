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
│                  5. RUNTIME VM SANDBOX & USER-SPACE TOOLS               │
│        node:vm Isolation · Blocklist Policies · custom_tools/ User Space│
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                  6. DEFENSIVE SAST ENGINE (audit_code)                  │
│       CWE-798 · CWE-78/95 · CWE-89 · CWE-79 · CWE-077/795 · CWE-507    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔒 1. Tre Livelli di Rischio dei Tool (`riskLevel`)

Ogni tool registrato nel `ToolRegistry` dichiara esplicitamente il proprio livello di rischio. Il modulo `PermissionManager` garantisce che nessuna operazione impattante avvenga senza la necessaria autorizzazione:

| Livello | Descrizione Operativa | Tool Nativi | Politica di Esecuzione |
| :--- | :--- | :--- | :--- |
| **`SAFE`** | Operazioni di sola lettura, analisi statica difensiva, query internet e diagnostica di sistema. | `read_file`, `list_dir`, `grep_search`, `audit_code`, `web_search`, `browse_url`, `get_ps_info`, `recall_memory`, `read_notes` | **Esecuzione immediata e trasparente** senza interruzioni per l'utente. |
| **`RESTRICTED`** | Modifica o cancellazione di file nel workspace, download da rete o creazione di ruoli/tool. | `write_file`, `edit_file`, `delete_file`, `download_file`, `create_role`, `create_tool`, `save_memory`, `post_note` | **Richiede conferma interattiva**: `[y/N/sempre]`. L'opzione `sempre` attiva l'approvazione delle sole modifiche ai file per la sessione attiva. |
| **`DANGEROUS`** | Esecuzione di codice arbitrario, script shell di sistema (PowerShell, Bash) o apertura di processi. | `execute_command` | **Richiede SEMPRE conferma esplicita** `[y/N]`. Il bypass di sessione (`always`) è **rigorosamente disabilitato** per prevenire esecuzioni incontrollate. |

---

## 🏢 7. Confinamento Rigoroso nel Workspace (Workspace Jail)

Tutte le operazioni sul filesystem (`read_file`, `write_file`, `edit_file`, `delete_file`, `list_dir`, `grep_search`, `audit_code`) sono obbligatoriamente vincolate alla directory del workspace attivo tramite la funzione protetta `resolveSafePath()`:

* **Blocco del Path Traversal (`CWE-77`)**: Tentativi di risalire la gerarchia con `..` o di accedere a percorsi assoluti al di fuori del workspace vengono intercettati e rifiutati prima di raggiungere il filesystem.
* **Nessun accesso al sistema host**: Gli agenti non possono leggere né modificare file di sistema, chiavi SSH, profili utente o configurazioni globali dell'OS.

```typescript
// src/tools/impl/utils.ts
export function resolveSafePath(workspaceRoot: string, targetPath: string): string {
  const resolved = path.resolve(workspaceRoot, targetPath);
  if (!resolved.startsWith(workspaceRoot)) {
    throw new Error(`Access denied: path '${targetPath}' is outside the workspace jail.`);
  }
  return resolved;
}
```

---

## 🔑 0. Mascheramento Automatico di Credenziali e Segreti

TSUKA integra una pipeline automatica di sanitizzazione dell'output (`maskEnvVars`):
* **Filtro delle Variabili d'Ambiente**: Tutte le variabili d'ambiente caricate da `.env` o dal sistema contenenti pattern sensibili (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `CREDENTIAL`, `AUTH`) vengono mascherate automaticamente.
* **Sanitizzazione su Tutti i Canali**: Il mascheramento avviene prima che i dati vengano inviati ai prompt dei modelli LLM, registrati nei file di log (`workflow_logs/`), stampati a video nella CLI o visualizzati nella TUI.

---

## ⚡ 4. Coda di Permessi Serializzata (Sequential FIFO Prompt Queue)

Nelle modalità multi-agente o nei workflow con esecuzione concorrente (`PARALLELO` in `/goal` o team paralleli):
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

## 🛠️ 6. Sandbox VM e Isolamento dei Tool Utente (`create_tool`)

Il framework consente agli agenti di creare nuovi tool dinamicamente in modo controllato e sicuro:
* **Esecuzione in Sandbox `node:vm`**: Il codice del tool viene validato ed eseguito in un contesto isolato senza accesso a `eval()`, `new Function()`, `process.exit`, `process.env` o moduli esterni non autorizzati.
* **Isolamento nello User-Space (`custom_tools/`)**: I tool generati dall'agente e i relativi schemi JSON vengono salvati in `custom_tools/` e `custom_tools_schemas/` (esclusi dal controllo versione tramite `.gitignore`), proteggendo l'integrità del codice sorgente del framework.
* **Controllo Anti-Sovrascrittura**: È impossibile sovrascrivere o manomettere i 77 tool core nativi.
* **Versioning e Backup Automatico**: In caso di aggiornamento di un tool custom, la versione precedente viene salvata automaticamente in `tools_backup/`.

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
