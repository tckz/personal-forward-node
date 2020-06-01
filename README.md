personal-forward-node
===

Expose your local web server to the internet.

Accept https request from the internet and forward it to local web server. Its response is returned to the requester.

# Runtime

## Requirements

* GAE Node.js
  * Using WebSocket, requires Flexible environment.
  * If it does not matter that it use Ajax long polling instead of WebSocket, 
    You can choose Standard Environment.

## Server side deployment

```bash
$ npm run dist
$ gcloud app deploy --project somepj app-somesvc.yaml
```

## Launching client side

```bash
$ npx ts-node-dev --respawn --endpoint https://somesvc-dot-somepj.appspot.com --target http://localhost:8090
```

# Development

## Requirements

* Node.js v12

```bash
npx ts-node-dev src/server.ts
```

```bash
npx ts-node-dev --respawn src/client.ts
```

# Authenticating with Identity-Aware Proxy

## Using user account

### Prerequisite

* Add user account email to member with a role `IAP-secured Web App User`.

### Runtime

* Get refresh_token which is used to get id_token that specified IAP as the audience.
* Launch client.ts with refresh_token. The client retrieve id_token using the refresh_token.

## Using service account

### Prerequisite

* Add service account email to member with a role `IAP-secured Web App User`.
* Activate service account once.
  ```bash
  $ gcloud auth activate-service-account somesvc@sompj.iam.gserviceaccount.com --key-file /path/to/service-account.json
  ```

### Runtime

```bash
$ gcloud auth print-identity-token --audiences={CLIENTID of IAP}.apps.googleusercontent.com somesvc@sompj.iam.gserviceaccount.com
{IDToken Displayed}
$ curl -v -H "Authorization: Bearer {IDToken}" https://service-somepj.appspot.com/
```

```bash
npx ts-node-dev --respawn src/client.ts --endpoint https://service-dot-somepj.appspot.com
```


# License

BSD 2-Clause License

SEE LICENSE
