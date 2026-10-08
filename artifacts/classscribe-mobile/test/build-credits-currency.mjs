import { build } from 'esbuild';

await build({
  entryPoints: ['lib/credits-currency.js'],
  outfile: '.credits-currency-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
});