# cool

A minimal, dark-themed web proxy for websites and networks you are authorized to access. It uses the open-source [Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet) web proxy with a [Bare server](https://github.com/tomphttp/bare-server-node) backend.

This project does **not** include monitoring evasion, traffic disguising, or school-filter bypass features. Follow the rules of the network and websites you use.

## Deploy from an iPhone with Render

No terminal or local computer is required.

1. Create a free account at [render.com](https://render.com) and sign in.
2. Open the [Render Blueprint page](https://dashboard.render.com/blueprints) and tap **New Blueprint Instance**.
3. Connect GitHub when asked and select `cryonixdevelopment-sudo/Website-Roblox-Stuff`.
4. Render detects `render.yaml`. Give the Blueprint any name and continue.
5. When Render asks for `ACCESS_PASSWORD`, enter a strong password that only authorized users know. The username is `cool`.
6. Tap **Deploy Blueprint** and wait for the service to show **Live**.
7. Open the `onrender.com` address shown by Render. Your browser asks for the username and password before loading the proxy.

Free Render services can sleep when unused, so the first load may take around a minute. Keep the GitHub repository private and do not share the deployed URL or password publicly.

## Updates

Render automatically redeploys after changes are committed to the `main` branch. Everything can be managed from the GitHub and Render mobile websites.

## Run elsewhere

Any Node.js 20+ host that supports WebSockets can run this project:

```text
npm ci
npm start
```

Set `ACCESS_USERNAME` and `ACCESS_PASSWORD` in the host's environment settings. HTTPS is required in production because the proxy relies on a service worker.

## License

MIT
