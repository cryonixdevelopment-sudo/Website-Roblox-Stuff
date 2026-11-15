# Orvian

A dark-themed web proxy optimized for Windows PCs and Chromebooks. macOS and mobile devices may work, but they are not officially supported. Orvian uses the open-source [Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet) web proxy with a [Bare server](https://github.com/tomphttp/bare-server-node) backend.

This project does **not** include monitoring evasion, traffic disguising, or school-filter bypass features. Follow the rules of the network and websites you use.

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
4. Set the listening port to `3000` if the host asks.
5. Deploy and enable a public HTTPS domain.

The host must support WebSockets. Static hosts such as GitHub Pages and serverless-only platforms such as Vercel are not suitable for the Bare proxy backend.

## Updates

Railway automatically redeploys after changes are committed to the `main` branch. Everything can be managed from the GitHub and Railway websites.

## Run elsewhere

Any Node.js 20+ host that supports WebSockets can run this project:

```text
npm ci
npm start
```

HTTPS is required in production because the proxy relies on a service worker.

## License

MIT
