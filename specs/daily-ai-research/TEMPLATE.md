---
summary: Standardized deliverable template for daily cutting-edge AI harness research reports and RICE feature evaluations.
read_when:
  - Generating a new daily AI harness research artifact.
  - Reviewing the format requirements for daily feature proposals.
---

# Daily AI Harness Research: [YYYY-MM-DD]

## 1. Upstream Landscape Scan & Key Discoveries

### Focus Area 1: Protocols & Standards (MCP, Realtime APIs)
- **Source**: [Link / Paper / Release]
- **Key Insight**: [Concise summary of discovery]
- **Relevance to Agent Harness**: [Why this matters]

### Focus Area 2: Coding Harnesses & Multi-Agent Frameworks (Claude Code, Aider, OpenHands, LangGraph)
- **Source**: [Link / Release]
- **Key Insight**: [Concise summary of discovery]
- **Relevance to Agent Harness**: [Why this matters]

---

## 2. Feature Candidates & RICE Evaluation Matrix

| Candidate Feature | Reach (1-10) | Impact (1-5) | Confidence (0-1) | Effort (Days) | RICE Score | Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Candidate A: [Feature Name]** | [R] | [I] | [C] | [E] | **[Score]** | Selected |
| **Candidate B: [Feature Name]** | [R] | [I] | [C] | [E] | **[Score]** | Deferred |
| **Candidate C: [Feature Name]** | [R] | [I] | [C] | [E] | **[Score]** | Deferred |

---

## 3. Winning Daily Feature Proposal: [Feature Name]

### Problem Statement & Opportunity
[Detailed explanation of the problem solved and the capability unlocked]

### Architectural Concept & Borrowed Pattern
- **Upstream Origin / Inspiration**: [Source repository / paper]
- **Smallest Borrowed Concept**: [Minimal viable design pattern]
- **Hard Invariants Preserved**: [Package boundary, parse-once, strict types]

### Proposed Technical Design
- **Package Scope**: [`@agent-harness/core` / `@agent-harness/server` / `@agent-harness/dashboard`]
- **Files Affected**:
  - `[NEW] packages/core/src/...`
  - `[MODIFY] packages/server/src/...`
- **Contracts & Schemas**:
  ```ts
  // Proposed Zod schema or interface
  ```

### Verification & Testing Plan
- **Unit & Integration Tests**: [Test files and assertions]
- **Proportional Checks**: `corepack npm run check:fast`
