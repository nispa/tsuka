# Framework di Sicurezza e Permessi 🛡️

<div align="right">
  <p>Read in <a href="security.md">🇬🇧 English</a></p>
</div>

TSUKA è progettato per automatizzare compiti reali su sistemi operativi (Windows, Linux e macOS). Poiché l'esecuzione di script shell e la scrittura su filesystem comportano potenziali rischi per l'ambiente host, il framework implementa un modello di sicurezza multilivello rigorosamente imperniato sul principio **User-in-the-Loop**.

---

## 🔒 1. Livelli di Rischio dei Tool

Ogni tool registrato dichiara un livello di rischio (`riskLevel`). Il modulo `PermissionManager` garantisce il rispetto dei confini di autorizzazione:

| Livello di Rischio | Descrizione Operativa | Esempi | Comportamento Esecutivo |
| :--- | :--- | :--- | :--- |
| **`SAFE`** | Operazioni di sola lettura, analisi statica di sicurezza, query internet e diagnostica di sistema. | `read_file`, `list_dir`, `grep_search`, `audit_code`, `web_search`, `browse_url`, `get_ps_info` | Esecuzione trasparente e immediata senza interruzioni. |
| **`RESTRICTED`** | Operazioni che modificano o cancellano file nel workspace o alterano configurazioni. | `write_file`, `edit_file`, `delete_file`, `download_file`, `create_role`, `create_tool` | Richiede conferma all'utente: `[y/N/sempre]`. L'opzione `sempre` autorizza tutte le future modifiche ai file per la sessione corrente. |
| **`DANGEROUS`** | Esecuzione di codice arbitrario, script shell di sistema o apertura di connessioni. | `execute_command` (PowerShell / Shell executor) | **Richiede sempre** conferma esplicita `[y/N]`. Nessun bypass globale consentito. |

---

## 🛡️ 2. Auditing Statico di Sicurezza (`audit_code`)

TSUKA include il ruolo specializzato `security_auditor` (impersonato nativamente da **Worf** e come skill secondaria da **Tuvok** e **Sherlock**):

* **Analisi Statica Difensiva (`audit_code`)**: Scansiona i file sorgente del workspace alla ricerca di segreti hardcoded (chiavi API, token JWT, chiavi private), vulnerabilità di Command Injection, Path Traversal, SQL Injection e algoritmi crittografici deboli.
* **Remediation & Hardening**: L'agente analista formula raccomandazioni correttive e patch di sicurezza per la revisione da parte dello sviluppatore.
* **Pack di Sicurezza**: È possibile abilitare rapidamente le capability di sicurezza in qualsiasi workspace eseguendo:
  ```powershell
  tsuka init --pack security
  ```

---

## 👤 3. Richieste di Autorizzazione User-in-the-Loop

Quando un agente richiede l'esecuzione di un tool `RESTRICTED` o `DANGEROUS`:

1. Il ciclo di esecuzione ReAct si sospende.
2. Il `PermissionManager` visualizza i dettagli puntuali dell'azione (ad esempio il comando esatto da eseguire o il percorso del file da scrivere).
3. L'utente seleziona l'opzione desiderata:
   * `y` (sì): autorizza la singola esecuzione.
   * `n` (no): rifiuta l'azione, restituendo un errore controllato all'agente per consentirgli di tentare strade alternative.
   * `sempre` (valido solo per i tool `RESTRICTED`): concede l'autorizzazione alle scritture per l'intera durata della sessione.
4. Le autorizzazioni di sessione possono essere revocate in qualsiasi momento con il comando `/reset`.

---

## 🌐 4. Tracciamento Oggettivo delle Fonti Web

Per proteggere l'utente da allucinazioni o omissioni del modello durante l'accesso a fonti online:

* **Tracciamento deterministico**: Il framework cattura direttamente gli URL restituiti dai motori di ricerca (DuckDuckGo, Google, Tavily) e dal browser web.
* **Log a video**: Al termine dell'esecuzione del tool, la CLI stampa l'elenco esatto delle fonti interrogate:
  ```
  ✔ Tool 'web_search' completato.
    └─ Fonti trovate:
       • https://nodejs.org/en/blog/announcements/v22-release-announce
       • ...
  ```
* L'utente ha sempre visibilità immediata sulle risorse esterne realmente consultate dall'agente.
