import { build } from 'esbuild';
import { resolve } from 'node:path';

const fixture = resolve('test/fixtures/class-groups-ui.jsx');
const entry = resolve('test/class-groups-flow.test.jsx');
await build({
  entryPoints: [entry],
  outfile: '.class-groups-flow-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  external: ['react/jsx-runtime', 'react-dom/server', 'node:test', 'node:assert/strict'],
  plugins: [{
    name: 'class-groups-ui',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (args.path === 'react' && (args.importer === fixture || args.importer === entry)) return { path: 'react', external: true };
        if (!args.importer || args.importer === fixture || args.importer === entry) return;
        if (['react/jsx-runtime', 'react-dom/server', 'node:test', 'node:assert/strict'].includes(args.path)) return;
        return { path: fixture };
      });
    },
  }],
});