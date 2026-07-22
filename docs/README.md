# TSUKA Documentation Portal 📖

Welcome to the **TSUKA** technical documentation system. This portal covers the design, architecture, multi-agent workflows, and safety features of this lightweight, dynamic agentic harness for Windows and PowerShell (with experimental Linux/macOS support).

---

## 🗂️ Documentation Sections

### 1. [System Architecture](architecture.md)
* Learn about the **dynamic plugin auto-discovery registry** (`src/tools/impl/*.ts`), the **model-adaptive tool selection** (Tier Pruning), and the runtime **Dynamic Prompt Assembly** engine.

### 2. [Multi-Agent & Collaboration Workflows](multi-agent.md)
* Understand the mechanics of the multi-agent debate conference command (`/call`) with `@` mentions, and the collaborative, state-sharing tool workflows (`/team`) that allow agents to cooperate on code development and cybersecurity hardening.

### 3. [Casi d'Uso Pratici](use-cases.md)
* Esempi concreti di utilizzo dei personaggi, ruoli e team (Krea2, social, copy, traduzione, dati, SEO, DevOps, supervisione).

### 4. [Security & Permissions Framework](security.md)
* Deep dive into the user-in-the-loop permission manager (`SAFE`, `RESTRICTED`, `DANGEROUS` risk levels), the local sandbox protection, and the deterministic web source URL logging.

### 5. [Guida Didattica — Costruire un harness agentico](guida-didattica.md) 🎓
* Il percorso completo, tappa per tappa, per arrivare a un harness come TSUKA: i componenti comuni a tutti gli harness (ciclo agentico, tool registry, permessi, gestione contesto), le scelte peculiari di questo progetto (fingerprinting, self-authoring, personas, protocollo STATO) e le trappole reali incontrate lungo la strada.

---

## 🏗️ High-Level Design Principles

TSUKA is designed as a **highly educational, decoupled, and modular framework**:

* **Declarative Configurations**: System roles, traits, character presets, and team configurations are stored as clean JSON files outside the source code. You can modify their behavior or invent new agents simply by editing JSON files.
* **Low Startup Context overhead**: Instead of passing giant prompts to the LLM, the harness dynamically mounts only the instructions and tools related to the active role, saving model token capacity and reducing hallucinations.
* **Safety First**: Dangerous commands (like running shell scripts) can never run autonomously. The user always retains full execution audit power.
