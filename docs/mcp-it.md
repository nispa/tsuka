# 🔌 Integrazione MCP (Model Context Protocol)

Il **Model Context Protocol (MCP)** è uno standard aperto che consente di estendere le capacità degli agenti AI collegandoli a server e strumenti esterni (ad esempio GitHub, database SQLite, browser web o sistemi di file esterni) attraverso un'interfaccia di comunicazione standardizzata **JSON-RPC 2.0**.

Dalla versione **v0.6.0**, TSUKA include un **client MCP nativo** basato su trasporto standard I/O (`stdio`): i server configurati vengono avviati automaticamente come processi figli e i loro tool vengono registrati direttamente nel `ToolRegistry`, diventando immediatamente utilizzabili da tutti gli agenti.

---

## 🎯 Perché l'integrazione MCP è importante

1. **Ecosistema infinito senza codice aggiuntivo**: permette all'agente di utilizzare centinaia di integrazioni già pronte (database, API cloud, repository Git, automazione browser) senza dover scrivere nuovi moduli TypeScript.
2. **Architettura nativa e Zero-Dependency**: il client MCP (`src/core/mcp/`) è sviluppato direttamente su standard I/O e JSON-RPC 2.0, senza dipendenze da SDK esterni o pacchetti terzi pesanti.
3. **Cittadini di prima classe**: i tool forniti da server MCP partecipano al normale ciclo ReAct, rispettano il sistema dei permessi (`PermissionManager`) e vengono filtrati in base al tier del modello.

---

## ⚙️ Configurazione rapida (`tsuka.config.json`)

Per abilitare uno o più server MCP, basta aggiungere la sezione `mcpServers` nel file di configurazione `tsuka.config.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\dati"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_tuo_token_segreto"
      },
      "riskLevel": "RESTRICTED",
      "timeoutMs": 60000
    },
    "database": {
      "command": "node",
      "args": ["server-sqlite.mjs"],
      "enabled": false
    }
  }
}
```

### Parametri di Configurazione

| Parametro | Tipo | Default | Descrizione |
|---|---|---|---|
| `command` | `string` | *(obbligatorio)* | Eseguibile del server MCP (es. `npx`, `node`, `python`, `uvx`). |
| `args` | `string[]` | `[]` | Argomenti passati al comando di avvio. |
| `env` | `object` | `{}` | Variabili d'ambiente aggiuntive (es. token API). Vengono oscurate nei log per sicurezza. |
| `enabled` | `boolean` | `true` | Se impostato a `false`, il server rimane configurato ma non viene avviato. |
| `riskLevel` | `string` | `"RESTRICTED"` | Livello di sicurezza assegnato ai tool del server (`SAFE`, `RESTRICTED`, `DANGEROUS`). |
| `timeoutMs` | `number` | `60000` | Tempo massimo (in millisecondi) per l'esecuzione di ciascuna chiamata tool o richiesta di lista. |

---

## 🏷️ Convenzione dei Nomi (`mcp__<server>__<tool>`)

Per evitare collisioni con i 30 tool nativi di TSUKA e rendere sempre chiara la provenienza delle azioni, ogni tool MCP viene registrato con un prefisso univoco:

$$\text{Nome Registrato} = \mathbf{mcp\_\_}\{\text{nome\_server}\}\mathbf{\_\_}\{\text{nome\_tool}\}$$

**Esempi pratici:**
* `mcp__github__create_issue`
* `mcp__filesystem__list_directory`
* `mcp__sqlite__read_query`

L'agente riconosce e invoca questi tool nello stesso identico modo dei tool nativi, e le richieste di autorizzazione all'utente mostrano chiaramente quale server sta compiendo l'azione.

---

## 🔒 Sicurezza e Gestione dei Permessi

I tool MCP sono completamente integrati nel perimetro di sicurezza di TSUKA:

1. **Richiesta di autorizzazione interattiva**: ogni chiamata a un tool MCP passa dal `PermissionManager`. Con il livello predefinito `RESTRICTED`, l'utente visualizza a schermo il nome completo del server, il tool e i parametri prima di confermare l'esecuzione `[y/N/sempre]`.
2. **Validazione preventiva degli argomenti**: lo schema JSON dei parametri (`inputSchema`) servito dal server MCP viene validato localmente da TSUKA prima dell'invio, bloccando alla radice parametri errati o malformati.
3. **Isolamento e resilienza ai guasti**: se un server MCP non si avvia o va in crash, TSUKA emette un avviso diagnostico tramite `logSink` e prosegue l'avvio degli altri moduli. Un server MCP difettoso non blocca mai l'harness.
4. **Ciclo di vita con ownership**: ogni runtime chiude soltanto i client MCP che ha creato; CLI e TUI attendono la chiusura. Un gestore sincrono di uscita resta come ultima protezione per le terminazioni improvvise.

> ⚠️ **Nota sul Workspace Jail**: i server MCP operano come processi indipendenti di sistema. Ad esempio, un server filesystem esterno configurato dall'utente ha accesso ai percorsi che gli vengono assegnati, superando la root del workspace locale. Il controllo di sicurezza è garantito dal livello di autorizzazione `riskLevel`.

---

## 🔄 Flusso di Funzionamento

```
[ Avvio TSUKA ] ──► [ Lettura mcpServers da tsuka.config.json ]
                            │
                            ▼
              [ Spawn del processo figlio (stdio) ]
                            │
                            ▼
              [ Handshake JSON-RPC 2.0: initialize ]
                            │
                            ▼
              [ Richiesta lista tool: tools/list ]
                            │
                            ▼
     [ Registrazione nel ToolRegistry come mcp__<server>__<tool> ]
                            │
                            ▼
  [ Esecuzione ReAct dell'Agente con gating permessi e validazione ]
```

---

## 🚧 Stato Attuale e Roadmap

* **Trasporto supportato**: Standard I/O (`stdio`). L'interfaccia modulare `IMcpClient` è già predisposta per supportare futuri trasporti via HTTP/Server-Sent Events (SSE).
* **Tipologia contenuti**: I contenuti testuali e JSON sono supportati nativamente. Risorse binarie o immagini vengono notificate con apposito marcatore di tipo.
