# Portale Documentale Didattico di TSUKA 📖

<div align="right">
  <p>Read in <a href="README.md">🇬🇧 English</a></p>
</div>

Benvenuto nel portale documentale didattico di **TSUKA**. TSUKA è un harness multi-agente deterministico, pedagogico e ultra-leggero scritto in TypeScript.  
Questo portale è strutturato per spiegare **come funzionano davvero i sistemi agentici sotto il cofano**, analizzando le scelte architetturali, i compromessi ingegneristici e gli errori pratici risolti durante lo sviluppo.

---

## 🗂️ Moduli Didattici

### 1. [Sistema di Memoria Persistente](memory-it.md) 🧠
* Comprendi i **3 livelli di coscienza dell'agente** (RAM di turno, Blackboard di workflow, Memoria persistente), la **Scala della Memoria**, la gerarchia delle **4 durabilità** (Lezioni > Decisioni > Fatti > Run) e il funzionamento dell'algoritmo BM25 combinato al decadimento temporale a zero dipendenze.

### 2. [Architettura di Sistema](architecture-it.md) 🏛️
* Scopri il **ciclo ReAct deterministico**, l'**auto-discovery a caldo dei tool** (`src/tools/impl/*.ts`), la calibrazione del budget di token e il disaccoppiamento I/O basato su eventi.

### 3. [Guida Didattica — Costruire un Harness Agentico da Zero](guida-didattica.md) 🎓
* Il percorso completo in 10 tappe per costruire un harness agentico, con l'analisi dettagliata delle 10 insidie reali riscontrate sul campo.

### 4. [Workflow Multi-Agente & Collaborazione](multi-agent-it.md) 👥
* Analisi dei dibattiti strutturati (`/call`), dei team collaborativi (`/team`) e dell'orchestratore di obiettivi (`/goal`) con staging parallelo isolato.

### 5. [Sicurezza & Framework dei Permessi](security-it.md) 🛡️
* Approfondimento sulla gestione dei permessi **User-in-the-Loop** (`SAFE`, `RESTRICTED`, `DANGEROUS`), confinamento canonico del workspace, validazione dei tool dinamici e analisi statica del codice (SAST).

### 6. [Capability Fingerprinting & Benchmark](benchmark-it.md) 📊
* Come `/benchmark` misura empiricamente l'accuratezza dei modelli locali nel tool-calling per calibrare dinamicamente i tool attivi.

### 7. [Casi d'Uso Pratici & Ricette](use-cases-it.md) 💼
* Esempi pratici e prompt operativi per tutti i 24 personaggi, 21 ruoli e 10 team preconfigurati.

### 8. [Integrazione MCP](mcp-it.md) 🔌
* Come il client MCP nativo (stdio, JSON-RPC 2.0, zero dipendenze) avvia i server esterni e registra i loro tool come cittadini di prima classe del registry — convenzione dei nomi, gating dei permessi, timeout e modello di sicurezza.

### 9. [Self-Authoring dei Tool](self-authoring-it.md) 🛠️
* Guida operativa per abilitare `create_tool`, richiedere un tool a un agente, gestirne persistenza e ruoli, disabilitarlo e comprenderne i limiti di sicurezza emersi dall'audit esterno.

---

## 🏗️ Principi Didattici Fondamentali

* **Zero Magia, Massimo Determinismo**: L'LLM propone; il codice deterministico governa e valida.
* **Ispezionabile & Autonomo**: File JSON in chiaro, nessun database vettoriale opaco, esecuzione 100% locale.
* **Imparare dagli Errori**: Ogni modulo è nato per risolvere uno specifico problema pratico emerso durante i test.
