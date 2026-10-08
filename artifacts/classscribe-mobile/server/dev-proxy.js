'use strict';

const http = require('node:http');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { stripRequestPrefixes } = require('./path-prefix');

const projectRoot = path.resolve(__dirname, '..');
const workspaceSlug = path.basename(projectRoot);
const externalPort = Number.parseInt(process.env.PORT || '', 10);
const basePath = process.env.BASE_PATH || '/';

function normalizeRequestUrl(requestUrl) {
  return stripRequestPrefixes(requestUrl, [
    basePath,
    '/classscribe-mobile/',
  ]);
}

function allocateInternalPort() {
  return new Promise((resolve, reject) => {
    const reservation = http.createServer();
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', () => {
      const address = reservation.address();
      reservation.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function makeProxyServer(internalPort) {
  const server = http.createServer((request, response) => {
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: internalPort,
        method: request.method,
        path: normalizeRequestUrl(request.url),
        headers: request.headers,
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode || 502,
          upstreamResponse.statusMessage,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );

    upstream.once('error', (error) => {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      }
      response.end(`Expo dev server proxy error: ${error.message}`);
    });

    request.pipe(upstream);
  });

  server.on('upgrade', (request, clientSocket, clientHead) => {
    const upstream = http.request({
      hostname: '127.0.0.1',
      port: internalPort,
      method: request.method,
      path: normalizeRequestUrl(request.url),
      headers: request.headers,
    });

    upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      clientSocket.write(
        `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n`,
      );
      for (const [name, value] of Object.entries(response.headers)) {
        for (const headerValue of Array.isArray(value) ? value : [value]) {
          clientSocket.write(`${name}: ${headerValue}\r\n`);
        }
      }
      clientSocket.write('\r\n');
      if (upstreamHead.length) clientSocket.write(upstreamHead);
      if (clientHead.length) upstreamSocket.write(clientHead);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
      clientSocket.once('close', () => upstreamSocket.destroy());
      upstreamSocket.once('close', () => clientSocket.destroy());
    });

    upstream.on('response', (response) => {
      clientSocket.write(
        `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n`,
      );
      for (const [name, value] of Object.entries(response.headers)) {
        for (const headerValue of Array.isArray(value) ? value : [value]) {
          clientSocket.write(`${name}: ${headerValue}\r\n`);
        }
      }
      clientSocket.write('\r\n');
      response.pipe(clientSocket);
    });

    upstream.once('error', () => clientSocket.destroy());
    upstream.end();
  });

  return server;
}

async function waitForExpo(internalPort, expoProcess) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (expoProcess.exitCode !== null) {
      throw new Error(`Expo exited before becoming ready (code ${expoProcess.exitCode}).`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${internalPort}/status`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // Expo is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('Timed out waiting for Expo to serve /status.');
}

async function start() {
  if (!Number.isInteger(externalPort) || externalPort < 1) {
    throw new Error('PORT must be set to the managed mobile service port.');
  }
  if (!process.env.REPLIT_EXPO_DEV_DOMAIN || !process.env.REPLIT_DEV_DOMAIN) {
    throw new Error('Replit mobile preview domains are not configured.');
  }

  if (process.env.REPLIT_EXPO_SESSION_SECRET) {
    const login = spawnSync(
      'pnpm',
      [
        'exec',
        'create-launch',
        'login',
        '--session',
        process.env.REPLIT_EXPO_SESSION_SECRET,
      ],
      { cwd: projectRoot, stdio: 'inherit' },
    );
    if (login.error) {
      console.warn(`Expo preview sign-in step was skipped: ${login.error.message}`);
    }
  }

  const internalPort = await allocateInternalPort();
  const childEnv = {
    ...process.env,
    EXPO_PACKAGER_PROXY_URL: `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`,
    EXPO_PUBLIC_DOMAIN: process.env.REPLIT_DEV_DOMAIN,
    EXPO_PUBLIC_SERVER_URL: `https://${process.env.REPLIT_DEV_DOMAIN}`,
    EXPO_PUBLIC_REPL_ID: process.env.REPL_ID,
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
    REACT_NATIVE_PACKAGER_HOSTNAME: process.env.REPLIT_DEV_DOMAIN,
    PORT: String(internalPort),
  };
  const expoProcess = spawn(
    'pnpm',
    ['exec', 'expo', 'start', '--go', '--localhost', '--port', String(internalPort), '--clear'],
    {
      cwd: projectRoot,
      env: childEnv,
      stdio: 'inherit',
    },
  );

  let stopping = false;
  let proxyServer;

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    if (proxyServer) proxyServer.close();
    if (expoProcess.exitCode === null && expoProcess.signalCode === null) {
      expoProcess.kill(signal);
    }
  };

  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  expoProcess.once('error', (error) => {
    console.error(`Could not start Expo: ${error.message}`);
    process.exitCode = 1;
    stop('SIGTERM');
  });

  expoProcess.once('exit', (code, signal) => {
    if (stopping) return;
    stopping = true;
    if (proxyServer) proxyServer.close();
    process.exitCode = code ?? (signal ? 1 : 0);
  });

  await waitForExpo(internalPort, expoProcess);
  proxyServer = makeProxyServer(internalPort);
  await new Promise((resolve, reject) => {
    proxyServer.once('error', reject);
    proxyServer.listen(externalPort, '0.0.0.0', resolve);
  });
  console.log(
    `Expo is ready on managed port ${externalPort}; root and /classscribe-mobile/ are normalized, while /artifacts/${workspaceSlug}/ is preserved for Metro bundles.`,
  );
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { normalizeRequestUrl };