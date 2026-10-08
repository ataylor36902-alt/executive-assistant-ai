import { build } from 'esbuild';
import { resolve } from 'node:path';

const fixture = resolve('test/fixtures/privacy-settings-ui.jsx');
const reactFixture = resolve('test/fixtures/privacy-settings-react.js');
const entry = resolve('test/privacy-settings-flow.test.jsx');
await build({
  entryPoints: [entry],
  outfile: '.privacy-settings-flow-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  external: ['react', 'react/jsx-runtime', 'react-dom/server', 'node:test', 'node:assert/strict'],
  plugins: [{
    name: 'isolated-privacy-settings-native-stubs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (!args.importer || args.importer === fixture || args.importer === reactFixture || args.importer === entry) return;
        if (args.path === 'react') return { path: reactFixture };
        if (['react/jsx-runtime', 'react-dom/server', 'node:test', 'node:assert/strict'].includes(args.path)) return;
        return { path: fixture };
      });
    },
  }],
});

const privacyRequestStub = resolve('test/fixtures/privacy-request-stubs.cjs');
await build({
  entryPoints: [resolve('lib/privacy.js')],
  outfile: '.privacy-client-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  plugins: [{
    name: 'isolated-privacy-request-native-stubs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (args.path === '@react-native-async-storage/async-storage' || args.path === './api') {
          return { path: privacyRequestStub };
        }
      });
    },
  }],
});