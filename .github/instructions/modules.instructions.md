---
applyTo: "src/modules/**/*.ts"
---

# Module conventions

- Keep the four-file split: `schema.ts`, `repository.ts`, `service.ts`, `routes.ts`.
- Route handlers contain no business logic and no SQL; every route declares a `requires` role.
- Services take `(db, audit)` and record an audit event for every state change.
- Repositories accept a `DatabaseSync` and expose intention-revealing methods
  (`findBySku`, `countOpenOrderLines`), never a generic `query(sql)` escape hatch.
- Multi-row writes use `BEGIN IMMEDIATE` / `COMMIT` with `ROLLBACK` in a catch block.
- Updates to versioned entities use `WHERE id = ? AND version = ?` and return `undefined`
  when no row matched, so the service can raise `AppError.versionConflict`.
- List methods build their WHERE clause with `WhereBuilder` and parse the query
  with `parseListQuery`, declaring an explicit `sortable` allow-list.
- Static route segments must be registered so they are not shadowed by a parameter
  segment (`/api/parts/summary` before `/api/parts/:id`).
- Parsers must tolerate the shapes an HTML form sends: an unselected `<select>` sends
  `""`, and a cleared optional input sends `""` rather than being omitted. Map both to
  `null` for nullable fields.
- Any new table goes into `src/db/schema.sql` with `CREATE TABLE IF NOT EXISTS`.
