# TSUKA Educational Documentation Portal 📖

<div align="right">
  <p>Leggi in <a href="README-it.md">🇮🇹 Italiano</a></p>
</div>

Welcome to the **TSUKA** educational documentation portal. TSUKA is a pedagogical, lightweight, and deterministic multi-agent harness built in TypeScript.  
This portal is designed to explain **how modern agentic systems work under the hood**, exploring architectural decisions, engineering trade-offs, and lessons learned from real-world development mistakes.

---

## 🗂️ Educational Modules

### 1. [Persistent Memory System](memory.md) 🧠
* Master the **3 tiers of agent state** (Turn RAM, Run Blackboard, Persistent Memory), the **Memory Ladder** trade-offs, the **4 durability kinds** (Lessons > Decisions > Facts > Runs), and how BM25 lexical ranking and half-life decay operate with zero external dependencies.

### 2. [System Architecture](architecture.md) 🏛️
* Explore the **deterministic ReAct cycle**, dynamic **tool auto-discovery** (`src/tools/impl/*.ts`), token budget calibration, and event-driven I/O decoupling.

### 3. [Educational Guide — Building an Agentic Harness from Scratch](educational-guide.md) 🎓
* The full 10-milestone curriculum covering how to build an agent harness from the ground up, highlighting the 10 critical engineering traps.

### 4. [Multi-Agent & Collaboration Workflows](multi-agent.md) 👥
* Understand structured debates (`/call`), collaborative teams (`/team`), and the dynamic goal orchestrator (`/goal`) with isolated parallel staging sandboxes.

### 5. [Security & Permissions Framework](security.md) 🛡️
* Deep dive into the **User-in-the-Loop** permission manager (`SAFE`, `RESTRICTED`, `DANGEROUS`), workspace jailing (`resolveSafePath`), dynamic tool sandboxing (`node:vm`), and static code auditing.

### 6. [Capability Fingerprinting & Benchmarks](benchmark.md) 📊
* How `/benchmark` empirically measures small-model tool-calling accuracy, driving dynamic active tool set selection.

### 7. [Practical Use Cases & Recipes](use-cases.md) 💼
* Concrete recipes and prompts across 24 characters, 21 roles, and 10 preconfigured collaborative teams.

---

## 🏗️ Core Pedagogical Principles

* **Zero Magic, Pure Determinism**: The LLM proposes; deterministic code decides and governs.
* **Inspectable & Self-Contained**: Plain JSON configs, no opaque vector databases, full local-first execution.
* **Learning from Errors**: Every feature exists to solve a concrete failure mode identified during testing.
