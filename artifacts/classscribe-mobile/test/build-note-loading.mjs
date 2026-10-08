import { build } from 'esbuild';
import { resolve } from 'node:path';

const fixture = resolve('test/fixtures/note-loading-native.jsx');
// Exercise the real editor, provider, cache merge, and save queue. Only platform,
// storage, network, and unrelated feature boundaries are replaced.
const actual = new Set([
  'react', 'react/jsx-runtime', './store-sync', './note-saving',
  '../../lib/store', '../../lib/note-saving',
]);
const sources = new Set([
  resolve('lib/store.js'), resolve('app/note/[id].js'),
]);
await build({
  entryPoints: ['test/note-loading.test.jsx'],
  outfile: '.note-loading-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  external: ['react', 'react/jsx-runtime', 'react-test-renderer'],
  plugins: [{
    name: 'note-loading-native-boundaries',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (!sources.has(args.importer) || actual.has(args.path)) return;
        if (args.path === '@react-native-async-storage/async-storage') {
          return { path: 'storage', namespace: 'note-storage' };
        }
        if (args.path.endsWith('.json')) return;
        return { path: fixture };
      });
      builder.onLoad({ filter: /.*/, namespace: 'note-storage' }, () => ({
        contents: `export { storage as default } from ${JSON.stringify(fixture)};`,
        loader: 'js',
        resolveDir: process.cwd(),
      }));
    },
  }],
});
