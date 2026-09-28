---
mode: 'agent'
description: 'Scaffold a new feature module, end to end, including the dashboard tab'
---

Create a new feature module following `.github/instructions/modules.instructions.md`
and using `src/modules/parts/` as the reference implementation.

Produce, in this order:

1. `schema.ts` — domain types plus parse functions built on `Validator`, calling
   `rejectUnknown` and settling all field errors at once.
2. `repository.ts` — parameterised SQL, `snake_case` to `camelCase` mapping, a
   `parseListQuery` allow-list for sorting, and version-guarded updates.
3. `service.ts` — business rules, cross-entity validation, and an audit event for
   every state change.
4. `routes.ts` — thin handlers, each declaring its `requires` role.

Then:

- add the table to `src/db/schema.sql` with `CREATE TABLE IF NOT EXISTS`,
- register the routes in `src/app.ts`,
- document the endpoints in `src/openapi.ts`,
- add the entity to `public/api-client.js`,
- add a view config and the create/edit/delete actions to `public/app.js`,
  following `.github/instructions/frontend.instructions.md`,
- add a tab to `public/index.html`,
- write `tests/<module>.test.ts`.

Finally run `npm test` and `npm run typecheck`, fix what fails, and summarise every
file you changed.

Module: ${input:module:What should the module be called, and what does it do?}
