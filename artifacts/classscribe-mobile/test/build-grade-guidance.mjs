import { build } from 'esbuild';
import { resolve } from 'node:path';

const fixture = resolve('test/fixtures/grade-guidance-ui.jsx');
const entry = resolve('test/grade-guidance.test.jsx');
await build({
  entryPoints: [entry],
  outfile: '.grade-guidance-test.cjs',
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
  loader: { '.js': 'jsx', '.png': 'dataurl' },
  external: ['react/jsx-runtime', 'react-dom/server', 'node:test', 'node:assert/strict'],
  plugins: [{
    name: 'grade-guidance-native-boundaries',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (args.path === 'react' && (args.importer === fixture || args.importer === entry)) return { path: 'react', external: true };
        if (!args.importer.endsWith('/app/grades.js') || args.path.endsWith('.png') || args.path === 'react/jsx-runtime') return;
        return { path: fixture };
      });
    },
  }],
});
