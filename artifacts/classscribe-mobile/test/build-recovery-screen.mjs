import { build } from 'esbuild';
import { resolve } from 'node:path';

const fixture = resolve('test/fixtures/recovery-ui.jsx');
const entry = resolve('test/recovery-screen.test.jsx');
const mocked = new Set([
  'react', 'react-native', 'expo-file-system', 'expo-audio', '../lib/store', '../lib/api',
  '../lib/theme', '../lib/util', '../lib/lecture-media', '../components/ui', '../test/recovery-device-fixture',
  '../components/RecordingConsentSheet', '../lib/privacy',
]);
await build({
  entryPoints: [entry],
  outfile: '.recovery-screen-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  define: { __DEV__: 'true' },
  external: ['react/jsx-runtime', 'react-dom/server', 'node:test', 'node:assert/strict'],
  plugins: [{
    name: 'recovery-native-boundary',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (!args.importer || args.importer === fixture || args.importer === entry) return;
        if (args.path === 'expo-crypto') return { path: resolve('test/fixtures/media-storage-native.cjs'), external: true };
        if (args.path === '../lib/recovery-audio') return; // Test the real scanner filter.
        if (mocked.has(args.path)) return { path: fixture };
      });
    },
  }],
});
await build({
  entryPoints: [resolve('lib/recording-ownership.js')],
  outfile: '.recording-ownership-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  plugins: [{
    name: 'ownership-native-boundary',
    setup(build) {
      build.onResolve({ filter: /^(expo-file-system|expo-crypto)$/ },
        () => ({ path: resolve('test/fixtures/media-storage-native.cjs'), external: true }));
    },
  }],
});
await build({
  entryPoints: [resolve('lib/lecture-media.js')],
  outfile: '.lecture-media-scope-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  plugins: [{
    name: 'media-storage-native-boundary',
    setup(build) {
      build.onResolve({ filter: /^(expo-file-system|expo-crypto|react-native)$/ },
        () => ({ path: resolve('test/fixtures/media-storage-native.cjs'), external: true }));
    },
  }],
});