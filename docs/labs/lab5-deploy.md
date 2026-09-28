# Lab 5 — Deploy to Azure and use the CLI

**10 minutes.** Outcome: the feature you started as an issue is now running.

The resource group, App Service plan and federated credentials are prepared before the
session — see `docs/deploy-azure.md`.

## 1. Confirm your target

```bash
az account show --query "{subscription:name, id:id}" -o table
az webapp list --resource-group rg-astra-parts-hub --query "[].name" -o table
```

## 2. Add the deployment job

```text
Extend #file:.github/workflows/ci.yml with a deploy job.

It runs only on pushes to main, only after build-and-test succeeds, and uses the
production environment. Authenticate with azure/login using OIDC and the
AZURE_CLIENT_ID, AZURE_TENANT_ID and AZURE_SUBSCRIPTION_ID secrets, then deploy
with azure/webapps-deploy.

Set permissions to id-token: write and contents: read, and nothing more.
```

Check the generated job against `docs/deploy-azure.md` before committing. Pay attention
to the `permissions` block — OIDC fails without `id-token: write`, and anything broader
is a finding waiting to happen.

## 3. Deploy, seed and verify

Merge to main and watch the deploy job. The database starts empty, so seed it once
through the App Service SSH console:

```bash
cd /home/site/wwwroot && npm run seed
```

Then:

```bash
APP=https://<app-name>.azurewebsites.net

curl -s $APP/health
curl -s -o /dev/null -w "%{http_code}\n" $APP/api/parts
curl -s -H "Authorization: Bearer aoph_viewer_workshop_key" "$APP/api/parts?limit=3"
```

The second must return **401**. `AUTH_DISABLED` is set in the Codespace for convenience
and deliberately not in Azure.

Now open the deployed dashboard in a browser. It loads, but the table says *Enter a
valid API key above to load this view* — because anonymous reads are off in production.
Paste the operator key and it comes to life. That difference between the two
environments, visible in the interface, is the most valuable thirty seconds of this lab.

`/health` is the endpoint the agent built in Lab 1. The loop is now closed.

## 4. Finish in the terminal with Copilot CLI

```bash
copilot
```

Confirm you trust the folder when prompted, then:

```text
> Summarise every change merged to main today, grouped by pull request, and draft
  release notes for version 1.1.0 in CHANGELOG.md.

> Then create the git tag v1.1.0 and show me the command before you run it.
```

Approve each tool invocation explicitly. Notice the permission prompt: the CLI asks
before it reads, modifies or executes anything, and you choose whether to approve for
the session or just once.

## Checkpoint

- [ ] Application reachable at the deployed endpoint
- [ ] `/health` returns 200, and `/api/parts` returns 401 without a key
- [ ] The deployed dashboard requires a key where the Codespace did not
- [ ] Release notes drafted and the tag created from the CLI

## Close

Look back at Lab 1. You wrote an issue; an agent implemented it; Agent mode built a
second module beside it, API and interface together; CI tested both; CodeQL scanned
them; Azure runs them. Every gate in that chain was a human decision.
