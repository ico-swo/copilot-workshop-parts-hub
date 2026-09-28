---
applyTo: "public/**/*.js"
---

# Dashboard conventions

- **Never assign to `innerHTML`.** Build DOM with the `element()` helper from
  `forms.js` and set `textContent`. Every value rendered here came from the API.
- **Never duplicate server validation.** Submit, catch `ApiError`, and let
  `forms.js` place `error.details` next to the matching input. A rule written in
  both places will drift.
- **Never infer permissions.** Read `me.can` from `/api/me` and use it to show or
  hide write actions. Never decide from the role name in the client.
- **Never hard-code the purchase-order state machine.** Read
  `/api/purchase-orders/transitions` and offer only the transitions it allows.
- All writes to a versioned entity pass the entity's `version`, so the server can
  reject a stale write with 412. Surface that to the user as "reload and retry",
  never silently overwrite.
- Keep `api-client.js` the only module that calls `fetch`.
- After a successful write, call `refresh()` rather than mutating local state, so
  the table and the metrics always reflect what the server actually stored.
