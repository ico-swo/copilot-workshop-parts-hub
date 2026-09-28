# Lab 1 — From issue to pull request

**20 minutes.** Outcome: a reviewed pull request, authored by an agent, owned by a human.

You will add `GET /health`. It is deliberately small: this lab is about the delegation
workflow and the review, not the endpoint.

## 1. Draft the issue with Copilot

```text
Draft a GitHub issue for adding a GET /health endpoint to this service.

Use the template in .github/ISSUE_TEMPLATE/copilot-task.yml.
Follow the route registration pattern in #file:src/app.ts and the response
helpers in #file:src/http/respond.ts.

The endpoint must return status, version and uptimeSeconds, must not require an
API key, and must not query the database.
```

## 2. Sharpen it yourself

Before opening the issue, check it states all four:

| Section | Must contain |
|---|---|
| Outcome | `GET /health` returns 200 with `status`, `version`, `uptimeSeconds` |
| Context | `src/app.ts`, `src/http/respond.ts`, `src/config.ts` for the version |
| Constraints | No new dependency. No database call. Public route — no `requires` role. |
| Acceptance | `npm test` passes **and** the skipped `/health` test in `tests/api.test.ts` is enabled and passing |

The last one matters most: the test already exists with a `skip`, so the agent has an
unambiguous definition of done that it cannot satisfy by writing its own easier test.

## 3. Assign it to Copilot

1. Open the issue in the repository.
2. In **Assignees**, select **Copilot**.
3. The agent reacts, opens a **draft pull request**, and starts pushing commits.

It works in its own ephemeral environment powered by GitHub Actions — not on your machine.

## 4. Review it as engineering work

While it runs, open the pull request and watch the session logs. When it is ready:

- Read the diff, not the summary. Does it match the issue?
- Did it declare the route public, or accidentally add a `requires` role?
- Did it remove the `skip` from the existing test, or write a parallel test and leave the
  skip in place? Only the first satisfies the acceptance criteria.
- Did it document the endpoint in `src/openapi.ts`? The instructions file requires it.
  If it did not, that is a finding — and a good illustration that instructions raise the
  odds, they do not guarantee compliance.
- Does CI pass?

Leave at least one review comment, even a minor one, so you see the revision loop:

```text
@copilot uptimeSeconds should be an integer, not a float. Round it, and assert that
in the test. Also add the endpoint to src/openapi.ts as required by the repository
instructions.
```

## 5. Merge, and watch the dashboard notice

Approve and merge through the normal flow, then reload the dashboard. The status pill in
the top right changes from **Health endpoint not implemented** to **Healthy · v1.0.0**.

The dashboard already had that code path waiting. Nobody touched the frontend in this
lab — it was written against an endpoint that did not exist yet, degraded gracefully
while it was missing, and picked it up the moment it shipped.

## Checkpoint

- [ ] A draft pull request exists, opened by the agent
- [ ] You left at least one review comment and the agent revised
- [ ] The `/health` test is enabled and passing, and the pull request is merged
- [ ] The dashboard status pill now reads Healthy

## Discussion — two minutes

Whose name is on the merge? That is the answer to "who is accountable for this code."
The agent authored it; a person approved it.
