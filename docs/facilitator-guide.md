# Facilitator guide — Part 2

Confidential. Do not share with participants before the session.

## Before the day

| Item | Owner | Check |
|---|---|---|
| Copilot Business/Enterprise licence for every attendee | Customer IT | Each attendee can open Chat in a Codespace |
| Org policies: Copilot Chat, coding agent, code review, CLI | Customer IT | Visible in org settings |
| GitHub Actions enabled on the workshop repository | Facilitator | Actions tab shows no banner |
| GitHub Code Security enabled | Customer IT | Settings → Advanced Security offers CodeQL setup |
| Codespaces enabled with a spending limit | Customer IT | A codespace can be created |
| Azure resource group, plan, web app, OIDC federation | Facilitator | `docs/deploy-azure.md` steps 1–2 complete |
| Repository secrets `AZURE_*` | Facilitator | Present in Settings → Secrets |
| Recovery branches pushed | Facilitator | See below |

## Recovery branches

Push one branch per lab containing the completed state:

```
solution/lab1-health
solution/lab2-stock-requests
solution/lab3-ci
solution/lab4-security-fix
solution/lab5-deploy
```

Announce these at the start. Falling behind in one lab must not cost anyone the next.

Doing the labs yourself beforehand also tells you where the agent behaves unexpectedly
on *this* tenant, which is what you will actually be asked about in the room.

## The API key demonstration (Lab 0)

Lab 0 has participants paste each of the three keys and watch the interface change. This
is the cheapest possible demonstration of role-based authorisation, and it is worth
doing on the projector first.

The point to land: the dashboard is not deciding anything. It calls `GET /api/me` and
renders what the server reports in `me.can`. The hidden button is a convenience; the
403 from the server is the control. Lab 0 has them prove that with curl.

If someone asks why both exist — because hiding a button the user cannot use is good
design, and refusing the request server-side is the actual security boundary. Needing
both is not redundancy.

## The planted weakness (Lab 4)

`src/modules/parts/routes.ts` contains `GET /api/parts/label`, which interpolates the
`sku` and `operator` query parameters into an HTML response. This is reflected
cross-site scripting and is what CodeQL's default query suite flags.

It is framed as a legacy endpoint for Zebra label printers on the picking line, with a
comment explaining why it returns HTML — plausible enough that participants skim past it.
Do not reveal it before the scan completes.

Reproduce it with:

```bash
curl -s -H "Authorization: Bearer aoph_viewer_workshop_key" \
  "http://localhost:3000/api/parts/label?sku=AOP-BRK-1001&operator=%3Cscript%3Ealert(1)%3C%2Fscript%3E"
```

**The contrast that makes this land.** Have them create a part named
`<script>alert(1)</script>` in the dashboard. It renders as literal text, because
`app.js` uses `textContent` everywhere. Same input, same request path, different sink,
different outcome. The rest of the application is the proof that the safe alternative
was always available.

**The discussion you want.** Autofix will most likely propose escaping. That closes the
alert. But `.github/copilot-instructions.md` says this endpoint should not build HTML
from request input at all — the correct fix is to return JSON and let the client set
`textContent`.

Let the group argue it. The transferable lesson is that a scanner checks for a class of
weakness while your own standards check for a class of design, and an AI-suggested fix
can satisfy the first while still violating the second. Accept an escaping-only fix if a
participant can justify it against the standard — but make them justify it.

## Deliberate gaps by lab

| Lab | Gap | Specified in |
|---|---|---|
| 1 | No `/health` route; its test is skipped in `tests/api.test.ts` | Issue template |
| 2 | No stock request module, no table, no dashboard tab | `docs/spec-stock-requests.md` |
| 3 | No workflow in `.github/workflows/` | `docs/ci.yml.example` |
| 4 | Code scanning not configured; the weakness is live | Lab guide |
| 5 | No deploy job | `docs/deploy-azure.md` |

Lab 1 has a small, pleasant payoff worth pointing out: the dashboard already calls
`/health` and degrades gracefully while it is missing. The moment the agent's pull
request merges, the status pill changes without anyone touching the frontend.

## Where Lab 2 usually goes wrong

The stock request module forces every pattern at once. Watch for these — they are the
teaching moments:

1. **Approval outside a transaction.** The status changes and the stock decrements as two
   separate statements. Ask what happens if the process dies between them.
2. **Availability checked only at creation.** Stock can move between raising and
   approving. The spec requires a re-check; agents routinely skip it.
3. **State machine as `if` statements.** Works, but violates the documented pattern.
4. **A missing `requires` role.** The endpoint silently becomes public.
5. **Validation duplicated in the client.** This is the most common frontend violation —
   the agent adds a length check or a regex in `app.js` that already exists in
   `schema.ts`. Have them search the diff for it. Two copies of a rule will drift, and
   the client copy is the one nobody updates.
6. **`innerHTML` in the new tab.** Less common, but it is exactly the weakness Lab 4 is
   about to cover, so it is worth catching here first.

If the room is running late, cut the module to create plus approve, and make reject and
cancel a stretch goal. Do not cut the transaction discussion or the tests.

## Timing discipline

The schedule has no slack. Call each checkpoint at the stated time and move on — the
recovery branches exist precisely so you can. The break at 55 minutes is the only
catch-up window; use it for broken environments, not for over-running Lab 2.

## Questions you should expect

**"Does the agent's code count as reviewed if CI is green?"**
No. CI proves the tests pass. Review proves the change matches the intent. Both are
required, and branch protection is what enforces it.

**"What does this cost?"**
Agent mode and the coding agent consume Copilot premium requests; the coding agent also
consumes GitHub Actions minutes. Point at their plan's allowance rather than quoting
figures.

**"Can we point this at our real repository tomorrow?"**
Yes for the instructions file and the prompt patterns. For the coding agent, start with
one well-tested repository and small issues, and confirm branch protection first.

**"Why no framework, and no real auth?"**
So the workshop never fails on a dependency install, and so every line in the request
path is readable during the session. The API key scheme is a teaching device for
role-based authorisation, not a recommendation — say so explicitly, because someone will
ask. The patterns transfer directly to Express or Fastify with Entra ID; the four-file
module split, the domain rules and the "server owns validation" boundary are the
transferable parts.

**"Why no React?"**
Same reason. A build step is one more thing that can fail in a room of twenty
Codespaces, and the whole frontend is readable in one sitting. The rules in
`frontend.instructions.md` — never duplicate validation, never infer permissions, never
hard-code a state machine — apply identically in React.

**"Why SQLite?"**
It removes an entire class of setup failure, and `node:sqlite` is in the standard
library. The transaction and optimistic-concurrency patterns are the same ones you would
write against PostgreSQL.
