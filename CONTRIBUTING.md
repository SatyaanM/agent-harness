# Contributing to Agent Harness

Thank you for contributing to Agent Harness! This guide outlines the standards and workflow for contributing improvements, fixes, and features.

---

## Workflow & PR Guidelines

### 1. Small, Independent Changes
- Keep pull requests focused on a single concern (e.g. one bug fix, one security patch, or one feature).
- Avoid bundling unrelated changes or massive refactors into single PRs so reviews remain fast and low-risk.

### 2. Branch Naming Conventions
Use descriptive prefixes for branches:
- `fix/<short-description>`: Bug fixes and stability improvements
- `security/<short-description>`: Security patches and boundary hardening
- `feat/<short-description>`: New features or capabilities
- `docs/<short-description>`: Documentation and contribution guides
- `chore/<short-description>`: Tooling, dependency updates, and maintenance

### 3. PR Description Formatting Standards
- Always format PR descriptions using standard GitHub Flavored Markdown.
- Wrap all code symbols, file paths, and identifiers in backticks (\`code\`).
- **CLI Submissions (GitHub CLI `gh`)**: When creating or editing PRs via the `gh` command-line tool, **always pass descriptions through `--body-file <file>` or UTF-8 stdin** rather than inline `-b "..."`. Passing inline backticks in PowerShell or Bash can cause shell escaping issues that strip backticks and introduce raw backslashes.

Example using `gh`:
```bash
# Write body to a temporary file
gh pr create --title "fix: ..." --body-file pr-body.md
```

### 4. Verification & Testing
Before submitting a PR, verify that all test suites pass and typechecking is clean:
```bash
# Run unit and integration tests across all packages
npm test

# Run TypeScript typechecks
npm run typecheck

# Check environment health
npm run doctor
```
