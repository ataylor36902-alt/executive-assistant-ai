import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function buildProfilePhotoFixture(outdir) {
  const stubs = {
    react: `
      export const useState = initial => global.__photo.useState(initial);
      export const useCallback = (callback, deps) => Object.assign(callback, { deps });
      export default {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      };
    `,
    'react/jsx-runtime': `
      export const jsx = (type, props) => ({ type, props });
      export const jsxs = jsx;
    `,
    'react-native': `
      export const Text = 'Text', View = 'View';
      export const Platform = { get OS() { return global.__photo.platform; } };
      export const AppState = {
        get currentState() { return 'active'; },
        addEventListener(event, listener) {
          global.__photo.foreground = listener;
          return { remove() { global.__photo.foreground = null; } };
        },
      };
    `,
    'expo-router': 'export const useFocusEffect = callback => global.__photo.focus(callback);',
    'expo-image': "export const Image = 'ExpoImage';",
    '../lib/theme': "export const C = { accentSoft: 'soft', accent: 'accent' };",
    'expo-file-system': 'export class File { constructor(uri) { this.uri = uri; this.size = global.__photo.fileSize; } }',
    'expo/fetch': 'export const fetch = (...args) => global.fetch(...args);',
    'expo-image-manipulator': `
      export const SaveFormat = { JPEG: 'jpeg' };
      export const manipulateAsync = (...args) => global.__photo.manipulate(...args);
    `,
    './api': `
      export const getUid = () => global.__photo.uid;
      export const getServer = () => global.__photo.server;
    `,
  };
  await build({
    absWorkingDir: root,
    entryPoints: ['lib/profile-photo.js', 'components/ProfileAvatar.js'],
    outdir,
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    loader: { '.js': 'jsx' },
    jsx: 'transform',
    plugins: [{
      name: 'profile-photo-native-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args =>
          stubs[args.path] ? { path: args.path, namespace: 'photo-stubs' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'photo-stubs' }, args =>
          ({ contents: stubs[args.path], loader: 'js' }));
      },
    }],
  });
}
