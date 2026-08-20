---
name: security-redteam
description: Execute adversarial red-team security audits testing tool sandboxing, path traversal boundaries, and input validation.
---

# Security Red-Team Testing

## Overview

Agent Harness tools (file operations, commands, web fetch) run with strict security boundaries. This skill guides adversarial testing to ensure no containment escapes or privilege escalations are possible.

## Threat Vectors Tested

1. **Path Traversal Escape**:
   - `../` sequences in file operations (`readFile`, `writeFile`, `editFile`).
   - Windows backslash traversal (`..\..\`).
   - Encoded URL traversal sequences (`%2e%2e%2f`).
   - Symlink breakouts pointing outside sandbox root.

2. **Tool Authorization**:
   - Rejection of unpermitted tool calls.
   - Rejection of unregistered or spoofed tool names.

3. **Prototype Pollution**:
   - Payloads containing `__proto__`, `constructor`, or `prototype` keys must not modify global object prototypes.

## Execution

Run security adversarial suite:

```powershell
corepack pnpm vitest run test/security/security-redteam.test.ts
```
