# Portale di Documentazione TSUKA 📖

<div align="right">
  <p>Read in <a href="README.md">🇬🇧 English</a></p>
</div>

Benvenuto nel portale della documentazione tecnica di **TSUKA**. Qui troverai le specifiche architetturali, i workflow multi-agente, le linee guida di sicurezza e i casi d'uso pratici del framework.

---

## 🗂️ Sezioni della Documentazione

### 1. [Architettura di Sistema](architecture-it.md)
* Approfondisci il funzionamento del **ciclo ReAct deterministico**, l'**auto-discovery dinamico dei tool** (`src/tools/impl/*.ts`), la selezione adattiva degli strumenti tramite **Capability Fingerprinting** e il disaccoppiamento I/O tramite `logSink`.

### 2. [Workflow Multi-Agente e Collaborazione](multi-agent-it.md)
* Scopri la meccanica dei dibattiti collegiali (`/call`), i workflow collaborativi su filesystem condiviso (`/team`) con 4 strategie operative e l'orchestratore dinamico di obiettivi (`/goal`) con esecuzione parallela isolata.

### 3. [Casi d'Uso Pratici](use-cases-it.md)
* Esempi concreti di prompt ed esecuzione per tutti i 24 personaggi/agenti, i 21 ruoli e i 10 team preconfigurati (Krea2, social media, copywriting, traduzione, analisi dati, SEO, DevOps, sicurezza e OSINT).

### 4. [Framework di Sicurezza e Permessi](security-it.md)
* Dettagli sul gestore dei permessi **User-in-the-Loop** (`SAFE`, `RESTRICTED`, `DANGEROUS`), la sandbox di filesystem (`workspaceRoot`), l'isolamento dei tool utente (`create_tool`) e il tracciamento deterministico delle fonti web.

### 5. [Guida Didattica — Costruire un harness agentico](guida-didattica.md) 🎓
* Il percorso completo in 10 tappe per costruire da zero un harness agentico moderno: ciclo ReAct, tool plugin, budgeting del contesto, streaming live ANSI e gestione dei modelli locali con le 10 trappole ingegneristiche reali.

---

## 🏗️ Principi Guida di Design

* **Configurazioni puramente dichiarative**: Ruoli, tratti, personaggi e team sono memorizzati come file JSON esterni. È possibile personalizzare o creare nuovi agenti senza modificare il codice sorgente.
* **Overhead minimo di contesto**: L'harness monta dinamicamente solo le istruzioni e i tool autorizzati per il ruolo attivo, preservando la context window dell'LLM.
* **Sicurezza al primo posto**: I comandi potenzialmente distruttivi (es. esecuzione di script shell) richiedono sempre l'autorizzazione esplicita dell'utente.
