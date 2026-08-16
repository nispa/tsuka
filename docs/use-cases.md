# Practical Use Cases 🧪

<div align="right">
  <p>Leggi in <a href="use-cases-it.md">🇮🇹 Italiano</a></p>
</div>

This guide demonstrates how to effectively utilize **Characters (Agents)**, **Roles**, and **Collaborative Teams** in TSUKA for real-world tasks. All examples use native declarative configurations from `characters/`, `roles/`, `traits/`, and `teams/`.

---

## 🎨 1. Prompt Design for Generative Models & Krea2

* **Characters**: 
  * `moriarty` (role: `krea_prompt_engineer`, trait: `creative`) — Tailored specifically for image generation workflows with **Krea2**.
  * `barclay` (role: `genai_prompt_designer`, trait: `creative`) — Crafts rich, contextual prompts and instructions for generic multimodal generative models.
* **When to use**: when turning a rough concept or short description into an expanded, production-ready text-to-image/video prompt (framing, lighting, camera gear, art medium, color palette, negative constraints).
* **Sample Prompt**:
  > *"Generate a photorealistic Krea2 prompt: an underground cyberpunk server laboratory with neon reflections on wet metallic surfaces and exposed cable bundles."*

---

## 📣 2. Social Media Management & Channel Strategy

* **Character**: `ortegas` (role: `social_media_manager`, trait: `creative`).
* **When to use**: crafting posts, threads, launch campaigns, and editorial schedules for LinkedIn, X/Twitter, Instagram, Facebook, or TikTok.
* **Sample Prompt**:
  > *"Write a LinkedIn launch post announcing the new release of TSUKA. Target audience: developers and sysadmins; highlight hot-plug tools and local LLM auto-discovery."*
* **Provided Output**: formatted body copy, opening hooks, call-to-actions (CTAs), contextual hashtags, and visual asset suggestions.

---

## ✍️ 3. High-Conversion Copywriting & Storytelling

* **Characters**:
  * `kirk` (role: `copywriter`, trait: `blunt`) — Direct, punchy, conversion-oriented copy without fluff.
  * `doctor` (roles: `storyteller` + `copywriter`, trait: `creative`) — Theatrical, engaging narrative copy with deep stylistic nuance.
  * `q` (roles: `entertainer` + `copywriter`, trait: `creative`) — Witty, ironic, memorable promotional messaging.
* **When to use**: headline brainstorming, landing page copy, email sequences (AIDA/PAS formulas), video scripts, or taglines.
* **Sample Prompt**:
  > *"Write 3 distinct landing page hero sections for a defensive cybersecurity software, each leveraging a different psychological angle (urgency, authority, simplicity)."*

---

## 🌐 4. Technical Translation & Localization

* **Character**: `uhura` (role: `translator`, trait: `professional`).
* **When to use**: translating technical documentation, UI strings, or articles while strictly preserving domain terminology and formal registers.
* **Sample Prompt**:
  > *"Translate this REST API documentation into Italian, keeping method and parameter names unchanged and using formal technical prose."*

---

## 📊 5. Data Analysis & Applied Statistics

* **Characters**:
  * `data` (roles: `tech_writer` + `data_analyst`, trait: `professional`) — Methodical quantitative breakdowns and structured documentation.
  * `mbenga` (roles: `data_analyst` + `researcher`, trait: `reliable`) — Rigorous critical analysis highlighting anomalies, data hygiene, and causal factors.
  * `seven` (roles: `osint_researcher` + `data_analyst`, trait: `reliable`) — Pattern extraction and synthesis across complex datasets.
* **When to use**: analyzing CSV/JSON datasets, detecting business trends, or inspecting server performance metrics.
* **Sample Prompt**:
  > *"Analyze this quarterly sales summary: identify the three largest percentage drops and formulate plausible causal hypotheses."*

---

## 🔍 6. SEO Optimization & Search Positioning

* **Character**: `quark` (role: `seo_specialist`, trait: `creative`).
* **When to use**: on-page audits, keyword clustering, meta-tag optimization, information architecture, and organic search ranking strategies.
* **Sample Prompt**:
  > *"Optimize the heading structure (H1, H2, H3) and meta description of this landing page for the keyword 'typescript multi agent framework'."*

---

## 💻 7. Software Engineering & System Architecture

* **Characters**:
  * `geordi` (role: `developer`, trait: `professional`) — Feature implementation, refactoring, code optimization, and unit testing in TypeScript/JavaScript and modern stacks.
  * `una` (role: `architect`, trait: `reliable`) — Clean system architecture, modular design patterns (SOLID, ReAct), interface contracts, and scaling roadmaps.
* **When to use**: planning complex new subsystems or implementing robust, maintainable code modules.
* **Sample Prompt**:
  > *"Design the TypeScript interfaces and implementation for an in-memory LRU cache with Time-To-Live (TTL) expiration support."*

---

## ⚙️ 8. DevOps, Cloud & System Administration

* **Characters**:
  * `scotty` (roles: `devops_engineer` + `sysadmin`, trait: `reliable`) — CI/CD automation, Docker containers, deployment scripting, and infrastructure management.
  * `tuvok` (roles: `sysadmin` + `security_auditor`, trait: `devils_advocate`) — Advanced system diagnostics, network port audits, and service hardening.
* **When to use**: automation scripts, container builds, server troubleshooting, and cross-platform PowerShell/Linux administration.
* **Sample Prompt**:
  > *"Create a production-ready multi-stage Dockerfile for a TypeScript Node.js backend with minimal image size."*

---

## 🛡️ 9. Defensive Cybersecurity & SAST Code Auditing

* **Characters**:
  * `worf` (role: `security_auditor`, trait: `reliable`) — Security officer: static code analysis (`audit_code`), defensive hardening, and OWASP/CWE vulnerability mitigation.
  * `tuvok` (roles: `sysadmin` + `security_auditor`, trait: `devils_advocate`) — System and network boundary checks, TLS/SSL certificate audits, and filesystem permission verification.
  * `sherlock` (roles: `osint_researcher` + `security_auditor`, trait: `professional`) — Analytical investigator: systematic vulnerability tracing and attack vector mapping.
* **What `audit_code` Analyzes**:
  * **CWE-798**: Hardcoded secrets & API keys (OpenAI keys, AWS Access Keys, GitHub PATs, JWT tokens, unencrypted PEM private keys).
  * **CWE-78 / CWE-95**: OS Command Injection risk and insecure dynamic code evaluation (`eval`, `new Function`).
  * **CWE-89**: SQL Injection on concatenated or unparameterized queries.
  * **CWE-22**: Path Traversal in filesystem operations with dynamic paths.
  * **CWE-79**: DOM-based Cross-Site Scripting (`innerHTML`, `dangerouslySetInnerHTML`).
  * **CWE-327 / CWE-295**: Broken cryptography (MD5, SHA1, DES) and disabled TLS/SSL certificate validation.
  * **CWE-532 / CWE-732**: Sensitive credential leakage in logs and permissive file permissions (`chmod 777`).
* **When to use**: pre-commit validation, security reviews before release, or verifying third-party dependencies.
* **Sample Operational Prompt**:
  > *"Run a defensive security audit on `src/` filtering for HIGH severity issues (or `.ts`/`.js` files). For every finding, explain the CWE risk and propose a concrete defensive patch."*
* **Provided Output**: structured SAST report categorized by severity (🔴 HIGH, 🟡 MEDIUM, 🔵 LOW), exact source location (`file:line`), vulnerable snippet, threat explanation, and practical remediation guidance.

---

## 🕵️ 10. OSINT Intelligence, Fact-Checking & Research

* **Characters**:
  * `spock` (roles: `researcher` + `osint_researcher`, trait: `laconic`) — Open-source intelligence, logical correlation, and empirical source verification.
  * `seven` (roles: `osint_researcher` + `data_analyst`, trait: `reliable`) — Large-scale online information gathering and data collation.
  * `dax` (role: `osint_editor`, trait: `professional`) — Drafting executive briefings and structured intelligence dossiers.
  * `odo` (role: `osint_verifier`, trait: `devils_advocate`) — Relentless cross-examination, inconsistency spotting, and fact-checking.
* **When to use**: deep-dive technical research, competitive analysis, and public record verification.
* **Sample Prompt**:
  > *"Collate and compare the technical specifications and licensing models of the top 3 open-source Markdown parsers in the Node.js ecosystem."*

---

## 🎮 11. Game Design & Gamification Mechanics

* **Character**: `paris` (role: `game_designer`, trait: `creative`).
* **When to use**: designing core loops, puzzle mechanics, balance models, and interactive narrative systems.
* **Sample Prompt**:
  > *"Define the rules and progression curve for a terminal-based hacking mini-game based on node networks and virtual memory limits."*

---

## 🧭 12. Supervision & Quality Assurance

* **Character**: `pike` (role: `supervisor`, trait: `reliable`).
* **Where found**: operates as the closing member across all 10 preconfigured teams.
* **When to use**: independent quality gating, requirement audit, and objective progress validation without sycophancy.

---

## 👥 13. Collaborative Multi-Agent Teams (`/team`)

Teams combine complementary skills and conclude with a `supervisor` quality gate (bold member indicates the orchestrator):

| Team | Members & Roles | Operational Objective |
|---|---|---|
| `creative_promo` | kirk (`copywriter`), deanna_troi (`entertainer`), **pike (`supervisor`)** | Kirk sets the high-impact strategy, Deanna Troi writes compelling promotional copy, and Pike verifies audience resonance. |
| `cyber_audit` | worf (`security_auditor`), tuvok (`sysadmin` + `security_auditor`), **pike (`supervisor`)** | Worf executes static security auditing, Tuvok verifies system and network boundaries, Pike signs off on mitigations. |
| `dev_ops` | scotty (`devops_engineer` + `sysadmin`), geordi (`developer`), **pike (`supervisor`)** | Scotty automates infrastructure and CI/CD pipelines, Geordi verifies code integrations, Pike approves release. |
| `dev_security` | geordi (`developer`), worf (`security_auditor`), **pike (`supervisor`)** | Geordi develops software features, Worf performs defensive security hardening, Pike supervises overall quality. |
| `game_dev` | paris (`game_designer`), geordi (`developer`), **pike (`supervisor`)** | Tom Paris designs game mechanics, Geordi implements logic and rendering, Pike leads testing and validation. |
| `legal_research` | spock (`researcher` + `osint_researcher`), deanna_troi (`entertainer`), **pike (`supervisor`)** | Spock evaluates legal constraints and standards, Deanna Troi drafts accessible summaries, Pike validates compliance. |
| `osint_recon` | spock (`researcher` + `osint_researcher`), seven (`osint_researcher` + `data_analyst`), **pike (`supervisor`)** | Spock scans primary open sources, Seven collates structured findings, Pike certifies the final intelligence report. |
| `research_writer` | spock (`researcher` + `osint_researcher`), dax (`osint_editor`), **pike (`supervisor`)** | Spock conducts empirical research, Jadzia Dax authors the executive whitepaper, Pike reviews and approves. |
| `story_comedy` | doctor (`storyteller` + `copywriter`), q (`entertainer` + `copywriter`), **pike (`supervisor`)** | The Doctor builds narrative structure, Q polishes comedic timing and wit, Pike validates tone and coherence. |
| `tech_docs` | geordi (`developer`), data (`tech_writer` + `data_analyst`), **pike (`supervisor`)** | Geordi inspects code interfaces, Data authors technical guides and architecture diagrams, Pike signs off on clarity. |

### Sample Team Execution:
```powershell
/team dev_security
> "Implement a JWT authentication helper and run a security audit to ensure tokens and secrets are handled defensively."
```

---

## 🎭 14. Multi-Agent Debate Conferences (`/call`)

Conference mode allows exploring opposing viewpoints on critical technical decisions before execution:

* **Pragmatic vs. Analytical Trade-offs**:
  ```powershell
  /call @spock, @kirk
  > "Should we immediately refactor our monolithic architecture to microservices or consolidate our existing modules?"
  ```
  *Spock calculates computational overhead and structural complexity; Kirk focuses on execution velocity and business delivery.*

* **Extensibility vs. Security**:
  ```powershell
  /call @moriarty, @worf
  > "Evaluate introducing dynamic sandboxed execution for user scripts."
  ```
  *Moriarty analyzes runtime flexibility; Worf maps attack surfaces and container jail boundaries.*
