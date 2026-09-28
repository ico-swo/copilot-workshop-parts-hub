# Lab 2 — Build the app in Agent mode

**25 minutes.** Outcome: a working stock request module, end to end — API, tests and a
dashboard tab — that you understand and can defend.

This is the largest lab. Work in pairs: one drives the prompt, the other reads every diff.

## 1. Switch to Agent mode

In the Chat view, change the mode selector from **Ask** to **Agent**. You are now in a
loop: it plans, edits across files, runs commands, reads the output and corrects itself.

## 2. Attach the specification, do not describe it

```text
Implement the stock request module described in
#file:docs/spec-stock-requests.md.

Follow the module pattern exactly. Use #file:src/modules/purchase-orders/service.ts
as the reference for the state machine and the transactional stock movement, and
#file:src/modules/parts/repository.ts for the query and version-guard patterns.

Register the routes in #file:src/app.ts and document them in #file:src/openapi.ts.
Add the table to src/db/schema.sql, keeping the migration idempotent.
Do not add any dependency and do not modify the parts or purchase-orders modules.

When the code is in place, run `npm test` and `npm run typecheck` and fix whatever
fails. Then summarise every file you changed and why.
```

Note the structure: outcome, authoritative patterns attached by file, explicit
constraints, and a stated definition of done. That is Part 1 applied to a real task.

## 3. Supervise the loop

Watch for the four things this module is designed to expose:

| Watch for | Why it matters |
|---|---|
| Is the approval wrapped in `BEGIN IMMEDIATE` / `COMMIT`? | Without it, a failure can decrement stock without recording the approval |
| Is availability re-checked at approval time? | Stock may have moved since the request was raised |
| Is the transition map data, or a chain of `if`s? | The instructions require the `ALLOWED_TRANSITIONS` pattern |
| Does every route declare a `requires` role? | A missing one silently makes the endpoint public |

When it proposes a terminal command, read it before approving. If it drifts into the
parts module, stop it and restate the constraint.

## 4. Earn the tests

```text
Add tests/stock-requests.test.ts following
#file:.github/instructions/tests.instructions.md.

Cover: successful creation asserting the SR-YYYY-NNNN reference format; an inactive
part returning 400; quantity above available stock returning 409 with code
insufficient_stock; successful approval asserting the part's new balance; approval
that fails because stock moved after creation, asserting the balance did not change;
double approval returning 409 already_resolved; and cancellation by someone other
than the requester returning 403.

Run the suite and show me the output.
```

That fifth case — stock moving between creation and approval — is the one an agent
usually forgets. If it skipped it, ask for it by name.

## 5. Build the dashboard tab

This half is where the frontend instructions get tested:

```text
Now add the Stock requests tab to the dashboard, following
#file:.github/instructions/frontend.instructions.md.

Add the entity to #file:public/api-client.js, then a view config and the create and
transition actions to #file:public/app.js, and a tab to #file:public/index.html.
The placeholder comment marks where.

Read the allowed transitions from the API rather than hard-coding them, gate the
action buttons on me.can.write, and do not validate anything in the client — let the
form engine display error.details.
```

Then check its work, specifically:

- Search the diff for `innerHTML`. There must be none.
- Search for a duplicated validation rule — a length check or a regex in `app.js` that
  also exists in `schema.ts`. That is the most common violation, and the reason the
  instruction exists.
- Did it hard-code the four statuses, or fetch the transition map?

## 6. Prove you own it

Close the Chat view. Each pair explains to another pair, without re-reading:

- where the stock decrement happens and why it is inside a transaction,
- what happens if two operators approve the same request simultaneously,
- which role can cancel a request, and why that check is in the service rather than
  the route,
- what the dashboard would do if someone removed the `requires` role from the approve
  endpoint. (Nothing visible — which is exactly why the server check is the real control.)

If you cannot explain it, the lab is not finished — regardless of a green test run.

## Checkpoint

- [ ] `src/modules/stock-requests/` exists with the four standard files
- [ ] Routes registered in `src/app.ts`, documented in `src/openapi.ts`, table in `schema.sql`
- [ ] The Stock requests tab works: create, approve, reject, cancel
- [ ] `npm test` and `npm run typecheck` pass
- [ ] You can explain every changed file without re-reading it

## If you are running short of time

Drop reject and cancel, and deliver create plus approve only. Do not drop the
transaction or the tests — they are the point of the lab.
