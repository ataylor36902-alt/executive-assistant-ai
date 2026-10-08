import { build } from 'esbuild';
import { resolve } from 'node:path';

const fixture = resolve('test/fixtures/navigation-ui.jsx');
const actual = new Set(['BackButton', 'TabStack']);
await build({
  entryPoints: ['test/navigation.test.jsx'],
  outfile: '.navigation-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  external: ['react', 'react-dom/server'],
  plugins: [{
    name: 'navigation-dependencies',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (!args.importer || args.importer === fixture || args.importer.endsWith('/test/navigation.test.jsx')) return;
        if (args.path === 'react' && args.importer.endsWith('/app/record.js')) return { path: fixture };
        if (args.path === 'react' || args.path === 'react/jsx-runtime') return;
        if (args.path.includes('/BackButton') && actual.has('BackButton')) return;
        if (args.path.includes('/TabStack') && actual.has('TabStack')) return;
        if (args.path.includes('/HeaderTitle')) return;
        return { path: fixture };
      });
    },
  }],
});