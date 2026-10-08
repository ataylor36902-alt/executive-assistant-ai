import { build } from 'esbuild';

await build({
  entryPoints: ['lib/revenuecat-diagnostics.js'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: '.revenuecat-diagnostics-test.cjs',
});