---
mode: 'agent'
description: 'Generate node:test coverage for an endpoint following project conventions'
---

Write tests for the endpoint I name below, following `.github/instructions/tests.instructions.md`.

Cover at minimum:

- the success path, asserting the status code and the response shape,
- one validation failure, asserting a 400 and the expected key in `error.details`,
- an authorisation failure, asserting a 403 for a role that should not have access,
- the relevant conflict: a duplicate, an invalid state transition, or a stale version (412),
- any side effect on stock, asserting the balance before and after,
- the shapes the dashboard sends, including an empty string for an unselected dropdown.

Use `seededDatabase()` for service-level tests and `startServer()` for API-level tests.
Do not introduce a dependency. Run `npm test` when you are done and report the result.

Endpoint: ${input:endpoint:Which endpoint should I test?}
