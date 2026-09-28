# Lab 5 — Deploying to Azure App Service

Steps 1 and 2 are prepared by the facilitator before the session. Participants run
step 3 onwards.

## 1. Provision (facilitator, before the workshop)

```bash
az group create --name rg-astra-parts-hub --location southeastasia

az appservice plan create \
  --name asp-astra-parts-hub \
  --resource-group rg-astra-parts-hub \
  --sku B1 --is-linux

az webapp create \
  --resource-group rg-astra-parts-hub \
  --plan asp-astra-parts-hub \
  --name <unique-app-name> \
  --runtime "NODE:24-lts"

az webapp config appsettings set \
  --resource-group rg-astra-parts-hub \
  --name <unique-app-name> \
  --settings NODE_ENV=production APP_VERSION=1.1.0 DATABASE_FILE=/home/data/parts-hub.db
```

`/home` is the persistent mount on App Service, so the SQLite file survives a restart.

Note that `AUTH_DISABLED` is deliberately **not** set. Anonymous read access is a
convenience for the Codespace only; the deployed instance requires an API key, and the
dashboard visibly reflects that difference.

## 2. Grant the workflow access

Use OpenID Connect rather than a long-lived publish profile:

```bash
az ad sp create-for-rbac \
  --name "gh-astra-parts-hub" \
  --role contributor \
  --scopes /subscriptions/<subscription-id>/resourceGroups/rg-astra-parts-hub \
  --json-auth
```

Add a federated credential for your repository, then store `AZURE_CLIENT_ID`,
`AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID` as repository secrets.

## 3. Deployment job (added to the CI workflow during the lab)

```yaml
  deploy:
    needs: build-and-test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - uses: azure/webapps-deploy@v3
        with:
          app-name: <unique-app-name>
          package: .
```

## 4. Seed the deployed instance

The database starts empty. Run the seed once through the App Service SSH console:

```bash
cd /home/site/wwwroot && npm run seed
```

## 5. Verify

```bash
APP=https://<unique-app-name>.azurewebsites.net

curl -s $APP/health
curl -s $APP/openapi.json | head -c 200
curl -s -o /dev/null -w "%{http_code}\n" $APP/api/parts
curl -s -H "Authorization: Bearer aoph_viewer_workshop_key" "$APP/api/parts?limit=3"
```

The first two are public. The third must return 401, which is the quickest way to
confirm authentication is actually enforced in Azure. Opening the dashboard in a browser
shows the same thing: it loads, but no data appears until a key is entered.
