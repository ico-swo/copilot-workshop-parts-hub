# Lab 3 — CI/CD with GitHub Actions

**20 minutes.** Outcome: a green pipeline, and the skill to fix a red one.

## 1. Generate the workflow

```text
Create .github/workflows/ci.yml for this repository.

It runs on pull requests to main and on pushes to main. Steps: checkout, set up
Node, install dependencies, run `npm run typecheck`, run `npm test`.

Read the engines field in #file:package.json for the Node version. Set permissions
to the minimum required, give the job a timeout, and pin actions to a major version tag.
```

Read the result before committing. Three things Copilot commonly gets wrong here:

- the Node version must be **24** — this project uses `node:sqlite` and native
  TypeScript execution, and neither exists on Node 20,
- `permissions:` must be present and minimal,
- `timeout-minutes` must be set, so a hung job does not burn Actions minutes.

Compare with `docs/ci.yml.example` afterwards — not before.

## 2. Commit and watch it run

```bash
git checkout -b lab3/ci
git add .github/workflows/ci.yml
git commit -m "ci: add build and test workflow"
git push -u origin lab3/ci
```

Open a pull request and watch the checks in the **Actions** tab.

## 3. Break it deliberately

Pick one:

| Break | What it teaches |
|---|---|
| Change `node-version` to `'20'` | `node:sqlite` and type stripping are unavailable — the failure is a runtime error far from the YAML you edited |
| Delete the install step | The failure surfaces nowhere near its cause |
| Change a reorder level in the seed data | A genuine assertion failure in `computes inventory totals in a single query`, with a useful diff |
| Rename an id in `public/index.html` | The UI silently half-breaks and no test catches it — worth discussing |

Push the break and let the pipeline go red.

## 4. Debug with the evidence, not a description

Copy the **actual failing job log**, then:

```text
This workflow run failed with the log below. Explain the root cause in two sentences,
then give me the minimal change that fixes it. Do not restructure the workflow.

<paste the log>
```

Pasting the log is the whole lesson. A description of an error is a summary; the log is
evidence. Same principle as `#problems` in Lab 2.

## 5. Fix, push, confirm green

## Checkpoint

- [ ] `.github/workflows/ci.yml` committed and a successful run visible
- [ ] You broke the pipeline, diagnosed it from the log, and fixed it

## Discussion

Two things worth raising if there is time:

1. What would have happened if the agent in Lab 1 had opened its pull request *after*
   this workflow existed? Required status checks are how you stop an unreviewed agent
   change reaching main.
2. The fourth break in the table above — renaming an element id — passes CI and breaks
   the dashboard. What would you add to catch that class of problem?
