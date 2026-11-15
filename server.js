const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { createBareServer } = require('@tomphttp/bare-server-node');

const app = express();
const bare = createBareServer('/bare/');
const port = Number(process.env.PORT) || 3000;
const accessUsername = process.env.ACCESS_USERNAME;
const accessPassword = process.env.ACCESS_PASSWORD;

app.disable('x-powered-by');

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authorized(req) {
  if (!accessUsername || !accessPassword) return true;
  const value = req.headers.authorization || '';
  if (!value.startsWith('Basic ')) return false;

  try {
    const [username, password] = Buffer.from(value.slice(6), 'base64')
      .toString('utf8')
      .split(/:(.*)/s, 2);
    return safeEqual(username || '', accessUsername) && safeEqual(password || '', accessPassword);
  } catch {
    return false;
  }
}

function requireAuthorization(req, res, next) {
  if (authorized(req)) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="cool", charset="UTF-8"');
  res.statusCode = 401;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.end('Authorization required.');
}

app.use(requireAuthorization);
app.use('/uv/', express.static(path.join(__dirname, 'node_modules/@titaniumnetwork-dev/ultraviolet/dist')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

const server = http.createServer((req, res) => {
  if (!authorized(req)) return requireAuthorization(req, res, () => {});
  if (bare.shouldRoute(req)) return bare.routeRequest(req, res);
  return app(req, res);
});

server.on('upgrade', (req, socket, head) => {
  if (!authorized(req)) return socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
  if (bare.shouldRoute(req)) return bare.routeUpgrade(req, socket, head);
  return socket.end();
});

server.listen(port, '0.0.0.0', () => {
  console.log(`cool is listening on port ${port}`);
});

process.on('SIGTERM', () => {
  server.close(() => bare.close());
});
