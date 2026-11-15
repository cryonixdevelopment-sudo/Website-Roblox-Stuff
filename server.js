const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { createBareServer } = require('@tomphttp/bare-server-node');

const app = express();
const bare = createBareServer('/bare/');
const port = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.get('/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()) });
});
app.use('/uv/', express.static(path.join(__dirname, 'node_modules/@titaniumnetwork-dev/ultraviolet/dist')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (_req, res, next) => {
  res.sendFile(path.join(__dirname, 'public/index.html'), (error) => {
    if (error) next(error);
  });
});

app.use((error, _req, res, _next) => {
  console.error('Application request failed:', error.message);
  if (res.headersSent) return res.end();
  return res.status(500).json({ status: 'error', message: 'Internal server error' });
});

const server = http.createServer(async (req, res) => {
  try {
    if (bare.shouldRoute(req)) {
      await bare.routeRequest(req, res);
      return;
    }
    app(req, res);
  } catch (error) {
    console.error('Proxy request failed:', error.message);
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'error', message: 'Upstream request failed' }));
  }
});

server.on('upgrade', (req, socket, head) => {
  if (!bare.shouldRoute(req)) return socket.end();
  Promise.resolve(bare.routeUpgrade(req, socket, head)).catch((error) => {
    console.error('Proxy WebSocket upgrade failed:', error.message);
    socket.destroy();
  });
});

server.on('error', (error) => {
  console.error('HTTP server error:', error.message);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Orvian is listening on port ${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(() => bare.close());
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
