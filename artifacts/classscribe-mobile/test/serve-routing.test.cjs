'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const serveScript = path.resolve(__dirname, '../server/serve.js');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Production serve exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The production server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Production serve did not become ready.');
}

test('production server handles root and prefixed manifest and asset routes', async (t) => {
  const staticRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classscribe-static-'));
  const port = await reservePort();
  await fs.mkdir(path.join(staticRoot, 'ios'), { recursive: true });
  await fs.mkdir(path.join(staticRoot, 'android'), { recursive: true });
  await fs.mkdir(path.join(staticRoot, 'release'), { recursive: true });
  await fs.writeFile(
    path.join(staticRoot, 'ios', 'manifest.json'),
    JSON.stringify({ platform: 'ios' }),
  );
  await fs.writeFile(
    path.join(staticRoot, 'android', 'manifest.json'),
    JSON.stringify({ platform: 'android' }),
  );
  await fs.writeFile(path.join(staticRoot, 'release', 'app.js'), 'bundle fixture');

  const child = spawn(process.execPath, [serveScript], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      BASE_PATH: '/classscribe-mobile/',
      EXPO_STATIC_ROOT: staticRoot,
      PORT: String(port),
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    await fs.rm(staticRoot, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child);

  for (const platform of ['ios', 'android']) {
    for (const route of [
      '/',
      '/manifest',
      '/classscribe-mobile/',
      '/classscribe-mobile/manifest',
    ]) {
      const response = await fetch(`${baseUrl}${route}`, {
        headers: { 'expo-platform': platform },
      });
      assert.equal(response.status, 200, `${platform} ${route}`);
      assert.match(response.headers.get('content-type') || '', /application\/json/);
      assert.deepEqual(await response.json(), { platform });
    }
  }

  for (const route of ['/status', '/classscribe-mobile/status']) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 200, route);
    assert.equal(await response.text(), 'packager-status:running');
  }

  for (const route of ['/release/app.js', '/classscribe-mobile/release/app.js']) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 200, route);
    assert.equal(await response.text(), 'bundle fixture');
  }
});