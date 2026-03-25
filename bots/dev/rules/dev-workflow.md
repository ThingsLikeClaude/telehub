---
description: "Development workflow: implementation order, worktree usage, coding principles"
globs: "**/*.{ts,tsx,js,jsx,py,go,rs,java,c,cpp,h,css,scss}"
---

# Development Workflow

## Implementation Order
1. `/explore` — Understand the existing codebase
2. `/plan` — Create implementation plan (required when changing 3+ files)
3. `/tdd` — Write tests first, then implement
4. `/build-fix` — Incrementally fix build errors
5. `/refactoring-code` — Clean up after implementation
6. `/security-review` — Security review before PR
7. `/commit-push-pr` — Commit and create PR

## Worktree Usage
- Use `/worktree-start` for parallel tasks
- Use `/worktree-cleanup` after PR merge

## Principles
- Separate feature implementation and refactoring into different commits
- Never commit with a broken build
- Never merge feature code without tests
