# Orvian

The current public frontend is a static personal start page inspired by compact desktop browser dashboards. It provides direct web search, app shortcuts, local bookmarks, preferences, a local-only profile, and an in-page iframe viewer. On a compatible Node.js host, Orvian uses Scramjet to load supported sites inside its built-in viewer. Static GitHub Pages does not provide the required transport backend.

## Free frontend hosting with GitHub Pages

The included `.github/workflows/pages.yml` publishes a static frontend only. **Embedded Scramjet browsing cannot work on GitHub Pages**; use a Node.js host that supports WebSockets for in-page websites.

1. Open this repository on GitHub.
2. Tap **Settings** → **Pages**.
3. Under **Build and deployment**, choose **GitHub Actions** as the source.
4. Open the **Actions** tab and select **Deploy Orvian frontend**.
5. Tap **Run workflow** if it has not run automatically.
6. After the deployment completes, GitHub shows the public Pages URL.

A dark-themed web proxy optimized for Windows PCs and Chromebooks. macOS and mobile devices may work, but they are not officially supported. Orvian uses the open-source [Scramjet](https://github.com/MercuryWorkshop/scramjet) embedded browser with BareMux/libcurl transport and a Wisp WebSocket backend.

This project does **not** include monitoring evasion, traffic disguising, or school-filter bypass features. Follow the rules of the network and websites you use.

For platform comparisons, health checks, environment-variable guidance, and phone-friendly deployment steps, see [DEPLOYMENT.md](DEPLOYMENT.md).

## Deploy from an iPhone with Railway

No terminal or local computer is required.

1. Create an account at [railway.com](https://railway.com) and sign in with GitHub.
2. From the Railway dashboard, tap **New Project**.
3. Choose **Deploy from GitHub repo** and select `cryonixdevelopment-sudo/orvian-web`.
4. Railway detects `railway.json`, installs the dependencies, and starts the server automatically.
5. Open the new service, then go to **Settings** → **Networking**.
6. Tap **Generate Domain**. Open the generated public `up.railway.app` address.

The deployed URL is public and does not require a login. Railway may require account verification or a paid plan depending on its current pricing and anti-abuse rules.

## Koyeb or another Docker host

The included `Dockerfile` provides a portable fallback:

1. Create a web service and choose GitHub as the source.
2. Select this repository and its `main` branch.
3. Choose the repository's `Dockerfile` as the build method.
4. Set the listening port to `8080` if the host asks.
5. Deploy and enable a public HTTPS domain.

The host must support WebSockets. Static hosts such as GitHub Pages are not suitable for Scramjet's Wisp backend.

Back4app Containers is the recommended browser-based fallback. Its published free container plan supports GitHub deployments and custom Docker containers without requiring a credit card. Deploy the included `Dockerfile` and follow [DEPLOYMENT.md](DEPLOYMENT.md).

## Updates

Railway automatically redeploys after changes are committed to the `main` branch. Everything can be managed from the GitHub and Railway websites.

## Run elsewhere

Any Node.js 20+ host that supports WebSockets can run this project:

```text
npm ci
npm start
```

HTTPS is required in production because Scramjet relies on a service worker and a secure Wisp WebSocket connection.

## License

MIT


## Free account database setup (phone-friendly)

Orvian accounts use PostgreSQL. Neon offers a free tier and does not require a local computer.

1. Open [neon.tech](https://neon.tech) on your phone and create a free account.
2. Create a project using the free plan.
3. Copy its pooled PostgreSQL connection string.
4. In Railway, open the Orvian service and choose **Variables**.
5. Add a variable named `DATABASE_URL` and paste the Neon connection string as its value.
6. Redeploy Orvian. The user and session tables are created automatically.

Do not paste the connection string into GitHub. Without `DATABASE_URL`, Orvian remains public but account creation reports that setup is incomplete. Accounts are optional; only Chat and Lounge require one.
