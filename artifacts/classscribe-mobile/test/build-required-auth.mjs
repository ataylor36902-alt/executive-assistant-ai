import { build } from 'esbuild';
import { resolve } from 'node:path';

const fixture = resolve('test/fixtures/required-auth-ui.jsx');
const constantsFixture = resolve('test/fixtures/required-auth-expo-constants.js');
const asyncStorageFixture = resolve('test/fixtures/required-auth-async-storage.js');
const testEntry = resolve('test/required-auth-flow.test.jsx');
const stubbedModules = new Set([
  'react',
  'react-native',
  'react-native-safe-area-context',
  'expo-secure-store',
  '@clerk/expo',
  '@clerk/expo/apple',
  'expo-auth-session',
  'expo-web-browser',
  '@expo/vector-icons',
  'expo-router',
  './KeyboardAwareScrollViewCompat',
  '../components/KeyboardAwareScrollViewCompat',
  './ui',
  '../components/ui',
  '../lib/theme',
  '../lib/clerk-config',
  '../lib/store',
  '../lib/api',
  '../lib/util',
  '../components/ProfileFields',
  '../lib/privacy',
  '../lib/library-link',
  '../lib/notify',
]);

await build({
  entryPoints: [testEntry],
  outfile: '.required-auth-flow-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.png': 'dataurl' },
  external: ['react', 'react/jsx-runtime', 'react-dom/server', 'node:test', 'node:assert/strict'],
  plugins: [{
    name: 'required-auth-ui',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!args.importer || args.importer === fixture || args.importer === testEntry) return;
        if (args.path === 'expo-constants') return { path: constantsFixture };
        if (args.path === '@react-native-async-storage/async-storage') return { path: asyncStorageFixture };
        if (args.path === '../utils' && args.importer.includes('/@clerk/expo/dist/token-cache/')) return { path: fixture };
        if (args.path === 'react/jsx-runtime' || args.path === 'react-dom/server' || args.path === 'node:test' || args.path === 'node:assert/strict') return;
        if (args.path === '../lib/required-auth') return;
        if (stubbedModules.has(args.path)) return { path: fixture };
      });
    },
  }],
});