# Orvian deployment guide

Orvian needs a long-running Node.js service, HTTPS, and WebSocket support. GitHub Pages and serverless-only hosting are incompatible with the Bare proxy transport.

## Current Railway deployment

The repository keeps `railway.json`; no Railway project or domain is deleted by these instructions. On November 15, 2026, independent requests to the configured Railway URL returned Railway's own `404 Application not found` response for both `/` and `/health`. Check the Railway service and domain mapping before relying on that URL.

## Recommended fallback: Back4app Containers

Northflank currently has signup disabled, so it is not a usable option for a new account. Back4app's published Containers pricing currently lists a $0 plan with 0.25 shared CPU, 256 MB RAM, 100 GB transfer, GitHub deployment, custom Docker containers, and no credit card required. Orvian's existing `Dockerfile` is the required deployment configuration.

### Deploy from a phone

1. Open [back4app.com](https://www.back4app.com) in Safari or Chrome and tap **Sign Up**.
2. Create the account, then choose **Build new app**.
3. Select **Containers as a Service**.
4. Tap **Import GitHub Repo** and authorize the Back4app GitHub app.
5. Select `cryonixdevelopment-sudo/orvian-web` and branch `main`.
6. Choose the repository root. Back4app will detect `/Dockerfile`.
7. Keep **Auto Deployment** enabled if you want new `main` commits deployed automatically.
8. Select the **Free** container plan. Do not continue if the dashboard shows a nonzero price.
9. If a port setting appears, use `8080`. The Docker image sets `PORT=8080` and exposes that port.
10. Copy only the **names and values** of environment variables you intentionally configured in Railway. Enter secret values directly in Back4app's environment-variable screen; never commit them to GitHub or paste them into chat.
11. Create the app and wait for the deployment status to become ready.
12. Open the generated public HTTPS URL, then verify `/health`.

Back4app documents Node container deployment on port 8080. Its public documentation does not make a clear WebSocket guarantee, so verify a proxied page after deployment before treating it as fully compatible.

## Alternative: Koyeb

Koyeb also supports GitHub/Docker deployments and public HTTPS services, but its pricing page says usage beyond included monthly credit becomes pay-as-you-go. Confirm the current free allowance and billing requirements before deploying.

Use the repository root Dockerfile, port `8080`, and HTTP health path `/health`.

## Environment variables

The application currently reads only `PORT`, which hosting platforms normally inject automatically. The Docker image defaults to port 8080 for Back4app; a platform-provided `PORT` overrides it. Running directly with `npm start` still defaults to port 3000. If you add configuration later:

- store secrets only in the hosting dashboard;
- use identical variable names when moving platforms;
- do not put secrets in `.env`, deployment YAML, screenshots, issues, or commits.

## Verification

After deployment, open these URLs:

- `https://YOUR-DOMAIN/` — should show the Orvian home screen.
- `https://YOUR-DOMAIN/health` — should return JSON containing `"status":"ok"`.
- `https://YOUR-DOMAIN/uv/uv.bundle.js` — should return JavaScript with status 200.

Loading successfully from a personal network establishes hosting health. It does not establish that a managed school network permits the service. Ask the network administrator to review any GoGuardian block category or custom rule; do not move domains to circumvent an access policy.
