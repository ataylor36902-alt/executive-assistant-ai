import { build } from 'esbuild';
import { resolve } from 'node:path';

const fixture = resolve('test/fixtures/schedule-import-ui.jsx');
const screenFiles = new Set([
  '/app/(tabs)/home/index.js',
  '/app/courses.js',
]);

await build({
  entryPoints: ['test/schedule-import.test.jsx'],
  outfile: '.schedule-import-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.png': 'dataurl' },
  external: ['react', 'react-dom/server'],
  plugins: [{
    name: 'schedule-screen-test-dependencies',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (!args.importer || args.path === 'react' || args.path === 'react/jsx-runtime') return;
        if (screenFiles.has(args.importer.slice(args.importer.lastIndexOf('/app')))) {
          return { path: fixture };
        }
      });
    },
  }],
});