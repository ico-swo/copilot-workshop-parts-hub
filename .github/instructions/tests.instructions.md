---
applyTo: "tests/**/*.ts"
---

# Test conventions

- Use `node:test` (`test`, `describe`, `before`, `beforeEach`) with `node:assert/strict`.
- Use the shared helpers rather than building fixtures by hand:
  - `seededDatabase()` for service-level tests — an isolated in-memory database with reference data.
  - `startServer()` for API-level tests — the real app on an ephemeral port, with `request()` and `json()` helpers that attach an API key.
- One behaviour per test. The name states the behaviour, not the function.
  Good: `refuses approval by the person who raised the order`.
  Bad: `approve test 3`.
- Assert on `error.status` and `error.code`, and on the keys of `error.details`. Never assert on message wording.
- For anything that moves stock, assert the resulting balance — and for the failure case, assert the balance did not move.
- Validation tests should cover the shapes the dashboard actually sends, including
  empty strings from unselected dropdowns and cleared optional inputs.
- Never hard-code a port. Never add a mocking library or snapshot tests.
