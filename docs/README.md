# TSUKA Documentation Portal 📖

<div align="right">
  <p>Leggi in <a href="README-it.md">🇮🇹 Italiano</a></p>
</div>

Welcome to the **TSUKA** technical documentation system. This portal covers the design, architecture, multi-agent workflows, and safety features of this lightweight, dynamic agentic harness for Windows, Linux, and macOS.

---

## 🗂️ Documentation Sections

### 1. [System Architecture](architecture.md)
* Learn about the **deterministic ReAct cycle**, dynamic **tool auto-discovery** (`src/tools/impl/*.ts`), adaptive tool selection via **Capability Fingerprinting**, and event-driven I/O decoupling.

### 2. [Multi-Agent & Collaboration Workflows](multi-agent.md)
* Understand conference debates (`/call`), collaborative shared-filesystem teams (`/team`) across 4 strategies, and the dynamic goal orchestrator (`/goal`) with isolated parallel execution.

### 3. [Practical Use Cases](use-cases.md)
* Concrete recipes and prompts across all 24 characters/agents, 21 roles, and 10 preconfigured teams (Krea2, social media, copywriting, translation, data analysis, SEO, DevOps, security, and OSINT).

### 4. [Security & Permissions Framework](security.md)
* Deep dive into the **User-in-the-Loop** permission manager (`SAFE`, `RESTRICTED`, `DANGEROUS`), filesystem jail (`workspaceRoot`), dynamic tool sandboxing, and deterministic web source logging.

### 5. [Persistent Memory System](memory.md) 🧠
* Deep dive into the **score-based eviction engine**, write-time deduplication, keyword search with morphological stemming, the four durability kinds, and the architectural rationale for a zero-dependency JSON memory layer.

### 6. [Educational Guide — Building an Agentic Harness](educational-guide.md) 🎓
* The full 10-milestone curriculum to building a modern agentic harness from scratch: ReAct loop, tool plugins, context budgeting, live ANSI streaming, and the 10 real-world engineering traps.

### 7. [Capability Fingerprinting & Benchmarks](benchmark.md) 📊
* How `/benchmark` measures instruction-following, JSON compliance and tool-calling, the file-driven test DSL, scoring and tier derivation, and the reasoning-effort sweep.

---

## 🏗️ High-Level Design Principles

* **Purely Declarative Configurations**: Roles, traits, characters, and teams are stored as external JSON files. Modify or create new agents without touching application source code.
* **Low Startup Context Overhead**: The harness dynamically mounts only instructions and tools authorized for the active role, saving token capacity and reducing hallucinations.
* **Safety First**: Destructive actions (such as arbitrary shell execution) always require explicit user approval.
