[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Ollama](https://img.shields.io/badge/Ollama-nativo-black?logo=ollama&logoColor=white)](https://ollama.com/)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-pronto-FF6B35?logo=openai&logoColor=white)](https://openrouter.ai/)
[![Test](https://img.shields.io/badge/Test-74%20superati-brightgreen?logo=vitest&logoColor=white)](tests/)
[![Licenza](https://img.shields.io/badge/Licenza-MIT-blue.svg)](LICENSE)
[![PR benvenute](https://img.shields.io/badge/PR-benvenute-brightgreen.svg)](https://github.com/nispa/tsuka/pulls)

<br />

<div align="center">

![Logo TSUKA](assets/logo.png)

### **TypeScript Unified Kit for Agents**
*Framework multi-agente deterministico, ultra-leggero con CLI e TUI a schermo intero in TypeScript.*

[🇮🇹 Italiano](README-it.md) · [🇬🇧 Read in English](README.md) · [📚 Wiki](https://github.com/nispa/tsuka/wiki/Home)

</div>

---

**TSUKA** è un harness multi-agente deterministico e ultra-leggero con interfaccia interattiva CLI/TUI, scritto interamente in TypeScript. Si collega a backend LLM locali (**Ollama**, **llama.cpp**, **Unsloth Studio**, **LM Studio**) tramite endpoint compatibili con OpenAI (`/v1/chat/completions`) e a gateway cloud (**OpenRouter**).

> 🗡️ **Il nome**: 柄 (*tsuka*) è l'impugnatura della katana — il punto di presa a cui ogni lama si aggancia. I modelli LLM sono le lame; TSUKA è l'impugnatura che ti permette di brandirli.
>
> 💡 **Perché TSUKA?** La maggior parte dei sistemi multi-agente sono complessi, opachi e vincolati all'ecosistema Python/Linux. TSUKA porta un'orchestrazione agentica deterministica e trasparente su **Windows (PowerShell)**, **Linux** e **macOS** senza boilerplate, con tool auto-scoperti a caldo, memoria persistente e una ricca interfaccia terminale.

---

## ✨ Punti Salienti

| Caratteristica | Descrizione |
|---|---|
| 🖥️ **TUI a Schermo Intero** | Dashboard a doppia modalità (`tsuka --tui`): rendering differenziale, mouse SGR 1006, ricerca live dei tool. |
| 📡 **Telemetria in Tempo Reale** | Monitoraggio live di `PREFILL`, `DECODE` (tok/s), **TTFT** e logits di confidenza — niente attese alla cieca. |
| 👥 **Orchestrazione Multi-Agente** | Pianificazione autonoma di obiettivi (`/goal`), team (`/team`) e dibattiti a tavola rotonda (`/call`). |
| 🔁 **Loop Verifica → Correzione** | Criteri di accettazione oggettivi guidano ritentativi automatici con protezione anti-stallo. |
| 🧩 **Auto-Discovery a Caldo** | Basta aggiungere un file `.ts` in `src/tools/impl/` per registrare tool nativi all'avvio. |
| 🛠️ **Auto-Creazione dei Tool** | Gli agenti possono scrivere, testare in sandbox (`node:vm`) e registrare a caldo nuovi tool JavaScript. |
| 📊 **Capability Fingerprinting** | `/benchmark` misura l'effettiva precisione di tool-calling su 5 suite di test JSON. |
| 🧠 **Memoria Condivisa Persistente** | Memoria associativa a ranking per parole chiave (`memory.json`), condivisa tra agenti e sessioni. |
| 🛡️ **Permessi a 3 Livelli** | Classificazione `SAFE` / `RESTRICTED` / `DANGEROUS`, jail del workspace, audit statico del codice. |

---

## ⚡ Guida Rapida

```bash
git clone https://github.com/nispa/tsuka.git
cd tsuka
npm install
npm run build
npm link                 # Rende disponibile il comando globale `tsuka`

tsuka init --preset core # Inizializza il workspace con il roster di agenti base
npm run tui              # Dashboard a schermo intero (o: tsuka --tui)
# Oppure la classica CLI REPL:
tsuka
```

> [!TIP]
> Assicurati che un backend locale sia in esecuzione (`ollama serve`, `llama-server`, Unsloth Studio) o imposta `OPENROUTER_API_KEY` in `.env`.

---

## 🚀 Installazione & Setup

```powershell
# Opzione A: Ollama
ollama serve && ollama pull qwen2.5-coder:7b
# Opzione B: llama.cpp
llama-server -m models/qwen2.5-coder-7b.gguf --port 8080
# Opzione C: OpenRouter
echo "OPENROUTER_API_KEY=la_tua_chiave" >> .env
```

```powershell
npm run build
npm link               # Registra `tsuka` globalmente
tsuka --tui            # Avvia la TUI a schermo intero ovunque
```

Inizializza workspace dedicati con roster specifici:

```powershell
tsuka init                         # Procedura guidata interattiva
tsuka init --preset core           # Roster essenziale (14 personaggi, 4 team)
tsuka init --preset full           # Roster completo (24 personaggi, 21 ruoli, 10 team)
tsuka init --pack osint,devops     # Aggiunge pack dedicati
```

---

## 👥 Workflow Multi-Agente

- **`/goal`** — Pianifica, scompone e orchestra autonomamente una pipeline multi-agente tra tutti i personaggi, con blocchi `PARALLELO` e verifica da supervisore.
- **`/team`** — Team preconfigurati (`teams/*.json`) in modalità `round-robin`, `pipeline`, `orchestrated` o `hybrid`.
- **`/call`** — Dibattiti a tavola rotonda strutturati tra più agenti.

Il coordinamento usa tool di protocollo deterministici (`report_status`, `route_next`, `cast_vote`) con fallback su marker testuali e una lavagna di run effimera (`AsyncLocalStorage`).

> 📚 Spec complete: [Guida Multi-Agente](https://github.com/nispa/tsuka/wiki/Workflow-Multi-Agente)

---

## 🧰 Tool, Sicurezza & Benchmark

TSUKA include **30 tool nativi** (`src/tools/impl/*.ts`) con schemi JSON compatibili OpenAI. I tool coprono le categorie Filesystem, Sistema, Web/Rete, Memoria, Coordinamento, Estensione Agente, Escalation e SAST (`audit_code`).

- **Sicurezza**: modello a 3 livelli, jail del workspace via `resolveSafePath()`, coda serializzata dei prompt, mascheramento credenziali.
- **Benchmark**: `/benchmark` esegue 5 suite che misurano aderenza alle istruzioni, conformità JSON e precisione dei tool, alimentando il tiering dinamico (`SMALL` / `MEDIUM` / `LARGE`).

> 📚 Dettagli: [Specifiche di Sicurezza](https://github.com/nispa/tsuka/wiki/Sicurezza) · [Architettura Dettagliata](https://github.com/nispa/tsuka/wiki/Architettura)

---

## 🛠️ Comandi Slash REPL

| Comando | Descrizione |
|---|---|
| `/goal <obiettivo>` | Orchestratore autonomo di obiettivi. |
| `/team [nome] ["compito"]` | Pipeline multi-agente collaborativa. |
| `/call [@a, @b] ["tema"]` | Dibattito a tavola rotonda multi-agente. |
| `/models [id]` `/provider [p]` `/effort [e]` | Cambia modello, provider o budget di ragionamento. |
| `/benchmark [modello\|all]` | Fingerprinting delle capacità. |
| `/agent [nome]` `/tools [filtro]` | Ispeziona o cambia personaggio / tool. |
| `/export [percorso]` | Esporta conversazione e tracciati dei tool in Markdown. |
| `/memory [clear\|id]` `/blackboard` `/runs` | Memoria persistente e report dei workflow. |
| `/stop` `/continue` `/reset` `/help` `/exit` | Controllo sessione. |

---

## 🏗️ Architettura

```text
CLI REPL (src/cli/)  ◄──►  TUI (src/tui/)
            └───────────┬───────────┘
                        ▼
            Loop ReAct Agente (src/core/agent.ts)
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
  Provider LLM    Registry Tool   Manager Permessi
  (OpenAI API)   (Auto-Scan a Caldo)  (Sicurezza 3 Livelli)
```

I profili sono ortogonali: **Personaggio = Ruolo × Tratto**. Vedi [Architettura Dettagliata](https://github.com/nispa/tsuka/wiki/Architettura).

---

## 🧪 Test

74 suite di test automatizzate con oltre 1.300 asserzioni, eseguite in modo ermetico tramite `MockLLMProvider` e store temporanei isolati:

```powershell
npm test
npx tsx tests/test_goal_orchestrator.ts   # singola suite
```

---

## 📚 Documentazione & Wiki

| Guida | Descrizione |
|---|---|
| [Portale Documentazione](https://github.com/nispa/tsuka/wiki/Home) | Panoramica centrale. |
| [Architettura Dettagliata](https://github.com/nispa/tsuka/wiki/Architettura) | Assemblaggio prompt, loop ReAct, budget token. |
| [Guida Multi-Agente](https://github.com/nispa/tsuka/wiki/Workflow-Multi-Agente) | Specifiche `/goal`, `/team`, `/call`. |
| [Specifiche di Sicurezza](https://github.com/nispa/tsuka/wiki/Sicurezza) | Livelli di permesso, jail, audit AST. |
| [Casi d'Uso & Ricette](https://github.com/nispa/tsuka/wiki/Casi-d-Uso) | Esempi pratici. |
| [Guida Didattica](https://github.com/nispa/tsuka/wiki/Guida-Didattica) | Costruire un harness agentico da zero. |

> La [Wiki GitHub](https://github.com/nispa/tsuka/wiki) viene generata automaticamente da questi file tramite `npm run wiki:build`.

---

## 🗺️ Roadmap & Come Contribuire

- [x] TUI a schermo intero a zero sfarfallio (v0.5.1)
- [x] Telemetria live prefill/decode
- [x] Capability fingerprinting empirico
- [ ] Streaming per tool custom in sandbox
- [ ] Ispettore grafico delle tracce su web
- [ ] Integrazione tool basati su LSP

**Come contribuire**: aggiungi un tool (`src/tools/impl/*.ts` + `tools_schemas/*.json`) o un JSON di persona (`characters/`, `roles/`, `traits/`, `teams/`). Assicurati che tutte le 74 suite di test passino (`npm test`).

---

## 📄 Licenza

MIT — libero per uso educativo, personale e commerciale.
