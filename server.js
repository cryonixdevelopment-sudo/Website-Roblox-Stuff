const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { createBareServer } = require('@tomphttp/bare-server-node');

const app = express();
const bare = createBareServer('/bare/');
const port = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use('/uv/', express.static(path.join(__dirname, 'node_modules/@titaniumnetwork-dev/ultraviolet/dist')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

const server = http.createServer((req, res) => {
  if (bare.shouldRoute(req)) return bare.routeRequest(req, res);
  return app(req, res);
});

server.on('upgrade', (req, socket, head) => {
  if (bare.shouldRoute(req)) return bare.routeUpgrade(req, socket, head);
  return socket.end();
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Orvian is listening on port ${port}`);
});

process.on('SIGTERM', () => {
  server.close(() => bare.close());
});
