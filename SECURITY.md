# Security Policy

## Reporting Security Issues

If you discover a security vulnerability within **TSUKA**, please report it responsibly by opening a private security advisory on GitHub or by contacting the maintainer directly.

---

## Security Architecture & Technical Documentation

TSUKA enforces a multi-layer **Defense-in-Depth** security model:

- 📖 **[English Security Documentation](docs/security.md)**
- 🇮🇹 **[Documentazione di Sicurezza in Italiano](docs/security-it.md)**

### Key Security Safeguards:
1. **User-in-the-Loop 3-Tier Permissions** (`SAFE`, `RESTRICTED`, `DANGEROUS` with no session bypass for arbitrary shell execution).
2. **Strict Workspace Jail** (`resolveSafePath` blocks path traversal and host file access).
3. **Sensitive Credential & Secret Masking** (automatic redaction of API keys and tokens).
4. **Isolated Parallel Workspaces & Conflict-Aware Merges**.
5. **Runtime VM Sandboxing & User-Space Tool Authoring** (`node:vm` sandbox and `custom_tools/`).
6. **Defensive Static Code Auditing** (`audit_code` covering CWE-798, CWE-78, CWE-89, CWE-22, CWE-79, CWE-327, CWE-532).
