// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { FileStore } = require('metro-cache');
const http = require('node:http');
const path = require('node:path');
const root = require('./scripts/root-env');

const config = getDefaultConfig(__dirname);

// Metro's default cache is shared by every project on the machine, and web bundles inline the app
// config, so running the prototype alongside could serve its config here. Keep a cache per app.
config.cacheStores = [new FileStore({ root: path.join(__dirname, 'node_modules/.cache/metro') })];

/**
 * In development the app calls the API through Metro (`<metro host>/api/...`), so a phone only
 * needs to reach the dev server it already loads the bundle from, on the same network or through
 * `--tunnel`. The target is this checkout's local API (PORT in the root .env); a deployed API is
 * configured with EXPO_PUBLIC_API_URL instead.
 */
/**
 * Through `--tunnel`, a request that already names its protocol reaches Metro with a list such as
 * `X-Forwarded-Proto: https, https`. Expo CLI builds the Expo Go manifest's bundle URL from that
 * header verbatim (`https, https://…`), so the app can't load and the CLI warns "Unable to resolve
 * manifest assets". Keep only the first (client-facing) protocol before any middleware runs.
 */
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, ...rest) {
  if (event === 'request') {
    const proto = req.headers['x-forwarded-proto'];
    if (typeof proto === 'string' && proto.includes(','))
      req.headers['x-forwarded-proto'] = proto.split(',')[0].trim();
  }
  return emit.call(this, event, req, ...rest);
};

const target =
  process.env.ASKESIS_API_PROXY_TARGET ||
  (process.env.EXPO_PUBLIC_API_URL ? null : `http://127.0.0.1:${root.PORT || 3000}`);
if (target) {
  const upstream = new URL(target);
  const previous = config.server.enhanceMiddleware;
  config.server.enhanceMiddleware = (middleware, server) => {
    const next = previous ? previous(middleware, server) : middleware;
    return (req, res, fallthrough) => {
      if (!req.url || !req.url.startsWith('/api/')) return next(req, res, fallthrough);
      const proxied = http.request(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: upstream.host },
        },
        (response) => {
          // Live updates are a long-lived event stream: forward each chunk as it arrives.
          res.writeHead(response.statusCode ?? 502, response.headers);
          res.flushHeaders?.();
          response.pipe(res);
        },
      );
      proxied.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { code: 'API_UNAVAILABLE', message: 'The Askesis API is not reachable.' },
          }),
        );
      });
      // A closed client (a dropped live stream, a cancelled request) ends the upstream request.
      res.on('close', () => proxied.destroy());
      req.pipe(proxied);
    };
  };
}

module.exports = config;
