import { build } from 'esbuild';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stubs = {
  'react-native': "export const Pressable = 'Pressable'; export const ScrollView = 'ScrollView'; export const Text = 'Text'; export const TextInput = 'TextInput'; export const View = 'View';",
  '../lib/theme': "export const C = { accent: 'accent', accentText: 'accentText', cell: 'cell', faint: 'faint', ink: 'ink', sec: 'sec' };",
  './ui': "export const s = { label: {}, input: {} };",
  '../lib/store': 'export function useResolvedTheme() {}',
};

export async function buildProfileFormatFixtures({ outdir }) {
  await build({
    absWorkingDir: root,
    entryPoints: ['components/ProfileFields.js'],
    outfile: join(outdir, '.profile-fields-test.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    plugins: [{
      name: 'profile-format-native-boundaries',
      setup(build) {
        build.onResolve({ filter: /.*/ }, args => {
          if (stubs[args.path]) return { path: args.path, namespace: 'profile-format-stubs' };
        });
        build.onLoad({ filter: /.*/, namespace: 'profile-format-stubs' }, args => ({
          contents: stubs[args.path],
          loader: 'js',
        }));
      },
    }],
  });

  await build({
    absWorkingDir: root,
    entryPoints: ['lib/account-profile.js'],
    outfile: join(outdir, '.account-profile-test.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildProfileFormatFixtures({ outdir: process.cwd() });
}