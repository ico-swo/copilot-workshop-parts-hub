# Copilot instructions — Astra Parts Hub

Spare parts catalogue, supplier master data and procurement workflow for Astra Otoparts.

## Stack

- Node.js 24, TypeScript run directly by Node (native type stripping). There is no build step.
- Zero runtime dependencies: `node:http`, `node:sqlite`, `node:crypto`, `node:test` only.
- Frontend is plain ES modules in `public/`, served by the same process. No framework, no bundler.

Do not add a runtime dependency. If a task appears to need one, say so and stop.

## Commands

- `npm start` — run the service
- `npm run dev` — run with file watching
- `npm test` — run the full suite
- `npm run typecheck` — type check without emitting
- `npm run seed` — load reference data and issue the development API keys

Run `npm test` and `npm run typecheck` after every change.

## Architecture

```
src/core/       errors, validation kit, list-query parsing  (no HTTP, no SQL)
src/http/       router, response helpers, static assets
src/modules/    one folder per feature
src/openapi.ts  hand-maintained API description, served at /openapi.json
public/         dashboard: api-client.js, forms.js, app.js
```

Each feature module has four files, in this order:

| File | Responsibility |
|---|---|
| `schema.ts` | Parse and validate input. Throws `AppError.badRequest` with a field-level `details` map. Also holds the domain types. |
| `repository.ts` | SQL only. Parameterised statements. Maps `snake_case` rows to `camelCase` objects. |
| `service.ts` | Business rules, cross-entity checks, audit writes. Throws `AppError`. Knows nothing about HTTP. |
| `routes.ts` | Thin handlers: parse input, call the service, send a response. Declares the required role. |

`src/modules/parts/` is the reference implementation. Mirror it.
Register new routes in `src/app.ts`, and document new endpoints in `src/openapi.ts`.

## Frontend architecture

The dashboard is three modules with one responsibility each:

| File | Responsibility |
|---|---|
| `api-client.js` | Every call to the server. Owns the API key, the `If-Match` header and `ApiError`. |
| `forms.js` | Modal engine: builds a form from field descriptors, maps `error.details` back onto inputs, and renders confirm dialogs and detail drawers. |
| `app.js` | View configuration, table rendering, and the CRUD actions per entity. |

Rules for the frontend:

- **Never duplicate a validation rule in the client.** The server rejects; `forms.js`
  displays what came back in `error.details`. A rule that exists in both places will drift.
- **Never assign to `innerHTML`.** Build nodes with `element()` and set `textContent`.
- **Read capability from `/api/me`, do not infer it.** Show or hide write actions from
  `me.can`, so the UI and the API can never disagree about what a role may do.
- **Read the state machine from `/api/purchase-orders/transitions`**, do not hard-code
  which buttons apply to which status.
- Adding a field to an entity means: update `schema.ts`, update the field list in
  `app.js`, add it to `openapi.ts`. All three, every time.

## Conventions

- TypeScript is strict. No `any`. No non-null assertions (`!`).
- Do not use TypeScript parameter properties in constructors — Node's type stripping rejects them. Declare a `#private` field and assign it in the constructor body.
- Errors: always `AppError` from `src/core/errors.ts`, with a specific `code`. Never invent another error shape.
- Responses: always the helpers in `src/http/respond.ts`. Use `sendVersioned` for anything carrying a `version`.
- Validation: always the `Validator` from `src/core/validation.ts`. Call `rejectUnknown` so unexpected fields are refused rather than ignored.
- List endpoints return `{ items, total, limit, offset }` and parse their query with `parseListQuery`.
- Database columns are `snake_case`; TypeScript properties are `camelCase`.
- Timestamps are ISO 8601 strings in UTC. Money is an integer number of Rupiah. Never a float.
- Log as single-line JSON: `{ level, message, ...context }`.

## Domain rules

- **Concurrency.** Every mutable entity carries a `version`. Updates are guarded by `WHERE version = ?` and return 412 on mismatch. Callers pass the version through `If-Match`.
- **Stock.** Stock is never set to an absolute value through the API. It moves only through `POST /api/parts/:id/adjust-stock` (with a reason) or through goods receipt on a purchase order.
- **Transactions.** Any operation that touches more than one row — creating an order with its lines, receiving goods — runs inside `BEGIN IMMEDIATE` / `COMMIT` with a `ROLLBACK` on failure.
- **Audit.** Every state change calls `AuditService.record`. The audit table is append-only; never add an update or delete path for it.
- **State machine.** Purchase order transitions are defined by `ALLOWED_TRANSITIONS`. Add a transition to that map, never as an `if` in a service method.
- **Segregation of duties.** The person who raised a purchase order cannot approve it.
- **Referential integrity.** Entities referenced elsewhere are deactivated, not deleted. Deletion returns 409 when a reference exists.

## Security rules

- Build SQL with bound parameters only. The single exception is the sort column, which is resolved through the allow-list in `parseListQuery` and never taken from a request value directly.
- Never render a request value into an HTML string, on the server or in the client.
- Every route declares a `requires` role, or is deliberately public (`/`, static assets, `/openapi.json`, `/health`).
- Validate every field of every request body before it reaches a service.
- Never log a request body, a credential, an API key, or a connection string.

## Testing

- Tests live in `tests/` and use `node:test` with `node:assert/strict`.
- Use the helpers in `tests/helpers.ts`: `seededDatabase()` for service-level tests, `startServer()` for API-level tests.
- Assert on the error `status` and `code`, and on `details` keys — not on message wording.
- Every new endpoint needs at least: a success case, a validation failure, an authorisation failure, and the relevant conflict case.
- Any operation that changes stock must assert the resulting balance, and assert that a failed attempt left it unchanged.
