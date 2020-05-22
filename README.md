personal-forward-node
===

# Development

```bash
npx ts-node-dev src/server.ts
```

```bash
npx ts-node-dev --respawn src/client.ts
```


# Deployment

```bash
$ npm run dist
$ gcloud app deploy --project somepj app-service.yaml
```

# Runtime

## Using service account

* Once
```bash
$ gcloud auth activate-service-account somesvc@sompj.iam.gserviceaccount.com --key-file /path/to/service-account.json
```

```nashorn js
$ gcloud auth print-identity-token --audiences={CLIENTID of IAP}.apps.googleusercontent.com somesvc@sompj.iam.gserviceaccount.com
{IDToken Displayed}
$ curl -v -H "Authorization: Bearer {IDToken}" https://service-somepj.appspot.com/
```

```bash
npx ts-node-dev --respawn src/client.ts --endpoint https://service-dot-somepj.appspot.com
```


