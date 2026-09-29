# Astra Parts Hub

Spare parts catalogue, supplier master data and procurement workflow — the reference
application for the **GitHub Copilot Refreshment Workshop, Part 2 (hands-on labs)** at
Astra Otoparts.

A working full-stack application: a layered REST API and an interactive dashboard with
full create, read, update and delete across every entity. No runtime dependencies and no
build step, so a two-hour workshop never fails on an install and every line in the
request path can be read during the session. The patterns transfer directly to Express
or Fastify against PostgreSQL.

## Requirements

- Node.js 24 or later (native TypeScript execution and `node:sqlite`)
- No runtime dependencies; TypeScript and `@types/node` are dev-only

## Run it

```bash
npm install
npm run seed     # reference data plus three development API keys
npm run dev      # http://localhost:3000
npm test         # 83 passing, 1 skipped until Lab 1 is complete
npm run typecheck
```

Open `http://localhost:3000` and paste `aoph_operator_workshop_key` into the **API key**
field to unlock the write actions.

## Using the dashboard

Five tabs, all backed by the same API:

| Tab | What you can do |
|---|---|
| **Catalogue** | Search and filter parts. **+ New part** to create. Click a row for the detail drawer, or use the row actions to edit, adjust stock, or delete. |
| **Reorder list** | Parts at or below their own reorder level, most urgent first, with supplier lead times. Adjust stock inline. |
| **Purchase orders** | **+ New order** opens a form with a dynamic line editor and a running total. Submit, approve, receive and cancel from the row or the drawer. |
| **Suppliers** | Full CRUD. Deletion is refused while any part or order references the supplier. |
| **Audit trail** | Every state change, filterable by entity. Requires the operator role. |

**Creating and editing.** Every form is a modal. Submit it, and if the server rejects
anything, each problem appears under the input it belongs to — the client holds no copy
of the validation rules.

**Stock.** Stock is never edited directly. Use **Adjust stock**, which takes a relative
change and a reason, both of which are recorded in the audit trail. The other way stock
moves is receiving a purchase order.

**Purchase orders.** Raise a draft, submit it for approval, approve it with an admin key,
then receive the goods. Receiving pre-fills each line with the ordered quantity and lets
you reduce it for a partial delivery; the stock increase happens in one transaction.
The buttons you see come from the API's own transition map, so the interface can never
offer a step the server would refuse.

**Roles.** The dashboard calls `GET /api/me` and shows only the actions your key allows.
Swap keys and the interface changes. The server enforces the same rules independently.

**Concurrency.** If someone else edits a record while your form is open, saving returns
a version conflict rather than silently overwriting their change.

## Authentication

Three development keys are issued by the seed script:

| Role | Key | Capabilities |
|---|---|---|
| viewer | `aoph_viewer_workshop_key` | Read catalogue, suppliers, orders |
| operator | `aoph_operator_workshop_key` | Create and update, raise and receive orders, read audit |
| admin | `aoph_admin_workshop_key` | Approve orders, delete records |

```bash
curl -H "Authorization: Bearer aoph_operator_workshop_key" localhost:3000/api/parts
```

Set `AUTH_DISABLED=true` for anonymous read-only browsing in a Codespace. Writing always
requires a key. It is deliberately not set in Azure. These are throwaway credentials for
a disposable environment — never reuse the pattern.

Keys issued before salted scrypt hashing used SHA-256 and will no longer authenticate.
For an existing workshop database, remove its old `api_keys` rows and rerun `npm run seed`
to reissue the development keys; reissue any separately managed keys as well. Rerunning
the seed without removing old rows does not replace keys with the same names.

## Domain

```
Supplier ──< Part ──< PurchaseOrderLine >── PurchaseOrder
                └──< StockRequest  (Lab 2)
AuditEvent records every state change
```

Receiving a purchase order is the only path that increases stock:

```
draft ──> submitted ──> approved ──> received
  └───────────┴────────────┴──────> cancelled
```

## What it demonstrates

| Concern | Where |
|---|---|
| Layered modules | `src/modules/*/{schema,repository,service,routes}.ts` |
| Transactions | `purchase-orders/repository.ts` — `create` and `receive` |
| Optimistic concurrency | `version` column, `If-Match` header, 412 on conflict |
| Role-based authorisation | `requires` on every route; `/api/me` drives the UI |
| Segregation of duties | The raiser of an order cannot approve it |
| Audit trail | Append-only `audit_events`, surfaced in every detail drawer |
| Referential integrity | Deletes return 409 while references exist |
| Injection safety | Bound parameters; sort columns via an allow-list |
| Output safety | `textContent` everywhere in the client; never `innerHTML` |
| Server-owned validation | One rule set, displayed by the client from `error.details` |
| Rate limiting | Fixed window per actor, `429` with `Retry-After` |
| Request tracing | `X-Request-Id` echoed and returned in every error body |
| API documentation | `src/openapi.ts`, served at `/openapi.json` |

## Architecture

```
src/
  server.ts              process lifecycle, signals, graceful shutdown
  app.ts                 module registration and router wiring
  config.ts              environment-driven configuration
  openapi.ts             hand-maintained API description
  core/
    errors.ts            AppError - the single error shape
    validation.ts        the Validator kit
    query.ts             list-query parsing, sort allow-list, WhereBuilder
  db/
    index.ts             connection and idempotent migration
    schema.sql           tables, constraints, indexes
    seed.ts              reference data and development API keys
  http/
    router.ts            routing, auth enforcement, body parsing, error mapping
    respond.ts           responses with security headers
    static.ts            serves the dashboard
  modules/
    parts/               reference module - catalogue and stock
    suppliers/           supplier master data
    purchase-orders/     procurement workflow and goods receipt
    audit/               append-only change history
    auth/                API keys, roles, rate limiting, /api/me
public/
  api-client.js          every call to the server; owns the key and If-Match
  forms.js               modal engine, error mapping, drawers, confirmations
  app.js                 view configs, table rendering, CRUD actions
  index.html, styles.css
tests/                   node:test service-level and API-level tests
```

## API

Full description at `/openapi.json`. Summary:

| Method | Path | Role |
|---|---|---|
| `GET` | `/api/me` | viewer |
| `GET` | `/api/parts` · `/summary` · `/reorder-list` · `/options` | viewer |
| `GET` `POST` `PATCH` `DELETE` | `/api/parts[/:id]` | viewer / operator / admin |
| `POST` | `/api/parts/:id/adjust-stock` | operator |
| `GET` `POST` `PATCH` `DELETE` | `/api/suppliers[/:id]` · `/options` | viewer / operator / admin |
| `GET` `POST` `PATCH` | `/api/purchase-orders[/:id]` · `/transitions` | viewer / operator |
| `POST` | `/api/purchase-orders/:id/{submit,approve,receive,cancel}` | operator / admin |
| `GET` | `/api/audit-events[/:entityType/:entityId]` | operator |
| `GET` | `/health` | public — added in Lab 1 |
| `*` | `/api/stock-requests` | added in Lab 2 |

Lists return `{ items, total, limit, offset }` and accept `limit`, `offset`, `sort` and
`direction`. Errors return `{ error: { code, message, details?, requestId } }`, where
`details` is keyed by field name — which is exactly what the dashboard forms render.

## Workshop

| Lab | Guide |
|---|---|
| 0 — Environment setup | [`docs/labs/lab0-environment.md`](docs/labs/lab0-environment.md) |
| 1 — From issue to pull request | [`docs/labs/lab1-issue-to-pr.md`](docs/labs/lab1-issue-to-pr.md) |
| 2 — Build the app in Agent mode | [`docs/labs/lab2-agent-mode.md`](docs/labs/lab2-agent-mode.md) |
| 3 — CI/CD with GitHub Actions | [`docs/labs/lab3-cicd.md`](docs/labs/lab3-cicd.md) |
| 4 — Security and code quality | [`docs/labs/lab4-security.md`](docs/labs/lab4-security.md) |
| 5 — Deploy to Azure and use the CLI | [`docs/labs/lab5-deploy.md`](docs/labs/lab5-deploy.md) |

Copilot configuration lives in `.github/`: repository instructions, path-specific
instructions for tests, modules and the frontend, three reusable prompt files, and the
issue template used to brief the coding agent.

## Licence

Internal workshop material. © SoftwareOne.
