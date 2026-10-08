import { build } from 'esbuild';

await build({
  entryPoints: ['lib/age-band.js'],
  outfile: '.age-band-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
});