import { build } from 'esbuild';

await build({
  entryPoints: ['lib/credits-status.js'],
  outfile: '.credits-status-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  plugins: [{
    name: 'credits-status-test-stubs',
    setup(build) {
      build.onResolve({ filter: /^(react|react-native|expo-router|\.\/api)$/ }, (args) => ({
        path: args.path,
        namespace: 'credits-status-stub',
      }));
      build.onLoad({ filter: /.*/, namespace: 'credits-status-stub' }, (args) => ({
        contents: `
          export const useCallback = (value) => value;
          export const useEffect = () => {};
          export const useRef = (current) => ({ current });
          export const useState = (value) => [value, () => {}];
          export const AppState = { addEventListener: () => ({ remove() {} }) };
          export const useFocusEffect = () => {};
          export const getCreditsStatus = async () => ({});
        `,
        loader: 'js',
      }));
    },
  }],
});