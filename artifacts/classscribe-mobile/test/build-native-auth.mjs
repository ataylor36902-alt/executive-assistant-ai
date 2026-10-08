import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const expoEntry = require.resolve('@clerk/expo');
const clerkRequire = createRequire(expoEntry);
const ui = resolve('test/fixtures/required-auth-ui.jsx');
const native = resolve('test/fixtures/native-auth-provider.jsx');
const stubs = new Set([
  'react-native', 'react-native-safe-area-context', 'expo-router',
  'expo-auth-session', 'expo-web-browser', '@expo/vector-icons',
  './KeyboardAwareScrollViewCompat', '../components/KeyboardAwareScrollViewCompat',
  './ui', '../components/ui', '../lib/theme', '../lib/clerk-config',
  '../lib/store', '../lib/api', '../lib/util', '../components/ProfileFields',
  '../lib/privacy', '../lib/library-link', '../lib/notify', '@clerk/expo/apple',
]);

await build({
  entryPoints: ['test/native-auth-smoke.test.jsx'],
  outfile: '.native-auth-smoke-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.png': 'dataurl' },
  external: ['react', 'react/jsx-runtime', 'react-test-renderer', 'node:*'],
  plugins: [{
    name: 'native-auth-smoke',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        // Keep the installed Expo provider and Clerk React lifecycle/hooks real.
        // Replace only the device client boundary and native host UI.
        if (args.path === 'native-clerk-provider') {
          return { path: resolve(expoEntry, '../provider/ClerkProvider.js') };
        }
        if (args.path === '@clerk/react' || args.path === '@clerk/react/internal') {
          return { path: clerkRequire.resolve(args.path) };
        }
        if (args.importer.endsWith('/provider/ClerkProvider.js') &&
            ['./singleton', './nativeClientSync', '../polyfills', './maybeCompleteAuthSession'].includes(args.path)) {
          return { path: native };
        }
        if (args.path === '@clerk/expo') return { path: native };
        if (!args.importer || args.importer === ui || args.importer === native) return;
        if (stubs.has(args.path)) return { path: ui };
        if (args.path === 'expo-constants') return { path: resolve('test/fixtures/required-auth-expo-constants.js') };
        if (args.path === '@react-native-async-storage/async-storage') return { path: resolve('test/fixtures/required-auth-async-storage.js') };
      });
    },
  }],
});
