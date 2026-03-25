---
description: "Code quality standards: minimal implementation, type safety, testing, security"
globs: "**/*.{ts,tsx,js,jsx,py,go,rs,java,c,cpp,h}"
---

# Code Quality

## Required Rules
- Minimum implementation: only build what's requested, no over-abstraction
- Maintain type safety (no `any`)
- Error handling only at system boundaries (trust internal code)
- Delete unused code instead of commenting it out

## Testing
- Target 80%+ unit test coverage
- Write a reproduction test before fixing bugs
- Mock only external dependencies

## Security
- Prevent OWASP Top 10 vulnerabilities
- Always validate/escape user input
- Never hardcode secrets in code
