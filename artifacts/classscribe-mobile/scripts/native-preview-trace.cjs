const http = require('node:http');

const createServer = http.createServer;
http.createServer = function (...args) {
  const server = createServer.apply(this, args);
  server.on('request', (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return;
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    const accept = String(req.headers.accept || '-');
    if (
      pathname !== '/' &&
      !pathname.endsWith('/manifest') &&
      !accept.includes('application/expo+json')
    ) return;

    const startedAt = Date.now();
    res.once('finish', () => {
      console.log(
        `[native-preview-trace] port=${server.address()?.port || '-'} ` +
        `${req.method} ${req.headers.host || '-'}${pathname}` +
        ` queryKeys=${[...url.searchParams.keys()].filter((key) => !/token|secret|key|auth|session/i.test(key)).join(',') || '-'}` +
        ` platform=${req.headers['expo-platform'] || '-'}` +
        ` accept=${accept.slice(0, 100)}` +
        ` ua=${String(req.headers['user-agent'] || '-').slice(0, 120)}` +
        ` status=${res.statusCode}` +
        ` type=${res.getHeader('content-type') || '-'}` +
        ` ms=${Date.now() - startedAt}`
      );
    });
  });
  return server;
};