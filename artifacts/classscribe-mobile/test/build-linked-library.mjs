import { build } from 'esbuild';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const fixture = resolve('test/fixtures/linked-library-ui.jsx');
const entry = resolve(process.argv.includes('--recording-recovery')
  ? 'test/recording-sign-in.test.jsx'
  : 'test/linked-library-flow.test.jsx');
const stubbed = new Set([
  'react', 'react-native', 'react-native-safe-area-context', '@react-native-async-storage/async-storage',
  '@clerk/expo', 'expo-router', '../lib/store', '../lib/api', './api',
  '../lib/theme', '../lib/clerk-config', '../lib/util', '../lib/notify', '../components/ui',
  '../components/ProfileFields', '../components/OptionalSignIn', '../components/BackButton',
  '../components/KeyboardAwareScrollViewCompat',
]);
// Exercise the real store transaction without mounting unrelated recording,
// background sync, and native media services.
const storeSource = await readFile(resolve('lib/store.js'), 'utf8');
function storeCallback(name, next) {
  const start = storeSource.indexOf(`  const ${name} = useCallback(`);
  const end = storeSource.indexOf(`  const ${next} = useCallback(`, start);
  if (start < 0 || end < 0) throw new Error(`Could not locate store callback ${name}`);
  return storeSource.slice(start, end);
}
const switchSource = `export function createStoreSwitch(deps) {
  const { AsyncStorage, checkLibrary, getUid, apiSetUid, refresh, loadProfile,
    status, writes, profileRef, mineRef, showEx, validAppearance,
    libraryCacheKey, libraryDeletesKey, libraryPendingProfileKey,
    collectPendingRecords, COLS, failedWrites, failedDeletes, empty, profilePending,
    setProfile, setShowExState, setAppearanceChoiceState, setMine, setStatus } = deps;
  const useCallback = fn => fn;
  ${storeCallback('switchLibrary', 'replaceSyncCode')}
  return switchLibrary;
}
export function createProfileLoader(deps) {
  const { AsyncStorage, getUid, db, legacyProfileMigratedKey, libraryProfileKey,
    libraryPendingProfileKey, profilePending, profileRef, setProfile,
    setShowExState, setAppearanceChoiceState, validAppearance } = deps;
  const useCallback = fn => fn;
  ${storeCallback('loadProfile', 'persistProfilePatch')}
  return loadProfile;
}`;
await build({
  entryPoints: [entry],
  outfile: '.linked-library-flow-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.png': 'dataurl' },
  external: ['react/jsx-runtime', 'react-dom/server', 'node:test', 'node:assert/strict'],
  plugins: [{
    name: 'native-linked-library-boundary',
    setup(build) {
      build.onResolve({ filter: /^native-store-switch$/ }, () => ({
        path: 'native-store-switch', namespace: 'native-store-switch',
      }));
      build.onLoad({ filter: /.*/, namespace: 'native-store-switch' }, () => ({
        contents: switchSource, loader: 'js',
      }));
      build.onResolve({ filter: /.*/ }, args => {
        if (!args.importer || args.importer === fixture || args.importer === entry) return;
        if (args.path === '@react-native-async-storage/async-storage') {
          return { path: 'test-storage', namespace: 'linked-test-storage' };
        }
        if (stubbed.has(args.path)) return { path: fixture };
      });
      build.onLoad({ filter: /.*/, namespace: 'linked-test-storage' }, () => ({
        contents: `export { storage as default } from ${JSON.stringify(fixture)};`,
        loader: 'js',
        resolveDir: process.cwd(),
      }));
    },
  }],
});