---
mode: 'agent'
description: 'Review a module against the project security and domain rules'
---

Review the module I name below against `.github/copilot-instructions.md`.

Check, in this order:

1. **Injection** — is every SQL statement parameterised? The only permitted dynamic
   fragment is a sort column resolved through the `parseListQuery` allow-list.
2. **Output handling** — is any request value interpolated into an HTML string, on the
   server or in `public/`?
3. **Authorisation** — does every route declare a `requires` role? Is any mutating route
   reachable by a `viewer`? Does the dashboard hide an action it is not allowed to perform,
   and does the server still refuse it independently?
4. **Input validation** — does every field pass through `Validator`, and does the parser
   call `rejectUnknown`? Does it handle the empty strings an HTML form sends?
5. **Atomicity** — does any operation write more than one row outside a transaction?
6. **Concurrency** — is every update to a versioned entity guarded by `WHERE version = ?`,
   and does the client pass `If-Match`?
7. **Audit** — does every state change record an audit event with a useful summary?
8. **Logging** — is any request body, API key, or credential written to a log?

For each finding report: the file and line, the concrete risk in one sentence, the
minimal fix as a snippet, and the test that would have caught it.

Group as **Must fix** and **Consider**. If a category is clean, say so in one line.

Module: ${input:module:Which module should I review?}
