# Orvian deployment guide

Orvian needs a long-running Node.js service, HTTPS, and WebSocket support. GitHub Pages and serverless-only hosting are incompatible with the Bare proxy transport.

## Current Railway deployment

The repository keeps `railway.json`; no Railway project or domain is deleted by these instructions. On November 15, 2026, independent requests to the configured Railway URL returned Railway's own `404 Application not found` response for both `/` and `/health`. Check the Railway service and domain mapping before relying on that URL.

## Recommended fallback: Northflank Sandbox

Northflank's published Sandbox plan currently states that it includes two services, two jobs, and one database, with no card required. Orvian's existing `Dockerfile` is the deployment configuration.

### Deploy from a phone

1. Open [northflank.com](https://northflank.com) in Safari or Chrome and create an account.
2. Create a new project.
3. Tap **Create service** and choose a combined build-and-deploy service.
4. Connect GitHub and select `cryonixdevelopment-sudo/orvian-web` with branch `main`.
5. Choose **Dockerfile** as the build method. The Dockerfile path is `/Dockerfile` and the build context is the repository root.
6. Select the free Sandbox compute option.
7. Add a public HTTP port:
   - Internal port: `3000`
   - Protocol: HTTP
   - Public access: enabled
8. Configure the HTTP health check:
   - Path: `/health`
   - Port: `3000`
   - Expected status: `200`
9. Copy only the **names and values** of environment variables you intentionally configured in Railway. Enter secret values directly in Northflank's secret/environment-variable screen; never commit them to GitHub or paste them into chat.
10. Deploy, wait for the health check to pass, and open the generated HTTPS domain.

Dashboard wording can change. If Northflank asks for a start command despite using the Dockerfile, use `npm start`.

## Alternative: Koyeb

Koyeb also supports GitHub/Docker deployments and public HTTPS services, but its pricing page says usage beyond included monthly credit becomes pay-as-you-go. Confirm the current free allowance and billing requirements before deploying.

Use the same settings as above: repository root Dockerfile, port `3000`, and HTTP health path `/health`.

## Environment variables

The application currently reads only `PORT`, which hosting platforms normally inject automatically. The Docker image defaults to port 3000 when `PORT` is absent. If you add configuration later:

- store secrets only in the hosting dashboard;
- use identical variable names when moving platforms;
- do not put secrets in `.env`, deployment YAML, screenshots, issues, or commits.

## Verification

After deployment, open these URLs:

- `https://YOUR-DOMAIN/` — should show the Orvian home screen.
- `https://YOUR-DOMAIN/health` — should return JSON containing `"status":"ok"`.
- `https://YOUR-DOMAIN/uv/uv.bundle.js` — should return JavaScript with status 200.

Loading successfully from a personal network establishes hosting health. It does not establish that a managed school network permits the service. Ask the network administrator to review any GoGuardian block category or custom rule; do not move domains to circumvent an access policy.
