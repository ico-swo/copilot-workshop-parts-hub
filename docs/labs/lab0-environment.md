# Lab 0 — Environment setup

**10 minutes.** Outcome: everyone is working in an identical, ready environment.

## 1. Open the Codespace

1. Open the repository on GitHub.
2. **Code → Codespaces → Create codespace on main**.
3. Wait for `postCreateCommand` to finish. It seeds reference data and issues three
   development API keys.

## 2. Verify Copilot is grounded in this repository

1. Open the Chat view (`Ctrl+Alt+I` / `Cmd+Ctrl+I`).
2. Confirm you are signed in and the model picker is visible.
3. Ask a question only someone who has read the code could answer:

   ```text
   Trace what happens when a purchase order is received. Which files are involved,
   and where does the part stock actually change? #codebase
   ```

   A correct answer names `routes.ts → service.ts → repository.receive()` and points at
   the `BEGIN IMMEDIATE` transaction. If it invents files, the workspace is not indexed
   yet — wait a moment and ask again.

## 3. Run the service

```bash
npm test          # expect 83 passing, 1 skipped
npm run typecheck
npm run dev
```

Open the forwarded port 3000. The dashboard loads with five tabs, fifteen parts, five
suppliers and two purchase orders. The status pill reads
**Health endpoint not implemented** — that is Lab 1's work.

## 4. Understand the security model by watching the UI change

Three development API keys exist. They are printed by the seed script:

| Role | Key | Can do |
|---|---|---|
| viewer | `aoph_viewer_workshop_key` | Read the catalogue, suppliers and orders |
| operator | `aoph_operator_workshop_key` | Create and edit, raise and receive orders, read the audit trail |
| admin | `aoph_admin_workshop_key` | Approve purchase orders, delete records |

Paste each one into the **API key** field at the top right and watch the interface change:

- **No key** — the badge reads *anonymous · read only*. No New or Edit buttons anywhere,
  and the Audit trail tab says you lack permission.
- **Viewer key** — same as anonymous, but now the badge names the key.
- **Operator key** — **+ New part**, **+ New order** and row actions appear. The Audit
  trail tab loads. Approve is still missing from purchase orders.
- **Admin key** — **Approve** and **Delete** appear.

This is not the dashboard deciding what you may do. It calls `GET /api/me` and renders
what the server says. Confirm that the server enforces it independently:

```bash
# No key at all
curl -i localhost:3000/api/parts | head -1

# A viewer trying to write
curl -i -X POST localhost:3000/api/parts \
  -H "Authorization: Bearer aoph_viewer_workshop_key" \
  -H "Content-Type: application/json" -d '{}' | head -1
```

401 and 403. The hidden button is a convenience; the 403 is the control.

These are throwaway development credentials for a disposable environment. They exist so
nobody loses lab time to authentication. Never reuse this pattern anywhere real.

## 5. Try one write, and one deliberate mistake

With the operator key loaded:

1. Click **+ New part**. Fill in an SKU that does **not** match the pattern, such as
   `BRK-1`, leave the name blank, and submit.
2. Both problems appear inline, under their own inputs.

That is the server's `error.details` map rendered onto the form. The client contains no
copy of those rules — a point worth remembering in Lab 2, when you ask Copilot to build
a module and it is tempted to validate in both places.

Now fix the SKU to `AOP-BRK-1500`, fill the rest in, and save.

## 6. Read the standards you will rely on

Open `.github/copilot-instructions.md`, then `.github/instructions/frontend.instructions.md`.
They are committed, so Copilot applies them to every request in this repository without
anyone configuring anything locally.

Confirm it is working:

```text
If I add a new endpoint that changes stock, what does this project require me to do?
```

A grounded answer mentions a transaction, an audit event, a version guard, a `requires`
role, and updating the OpenAPI document — all from the instructions file plus the code,
not from general knowledge about REST APIs.

## Checkpoint

- [ ] Codespace running, Copilot Chat answering with real file names
- [ ] `npm test` passes and the dashboard loads on port 3000
- [ ] You swapped all three keys and watched the available actions change
- [ ] You created one part through the UI and saw inline validation errors
- [ ] You have read `.github/copilot-instructions.md`

## Facilitator note

If anyone's Chat view is empty, check the organisation Copilot policy first, not the
extension.
