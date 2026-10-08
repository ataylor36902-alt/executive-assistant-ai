import { build } from 'esbuild';

await Promise.all([
  build({ entryPoints: ['lib/course-sources.js'], outfile: '.course-sources-test.cjs', bundle: true, platform: 'node', format: 'cjs' }),
  build({ entryPoints: ['lib/study-scope.js'], outfile: '.study-scope-test.cjs', bundle: true, platform: 'node', format: 'cjs' }),
  build({ entryPoints: ['lib/logic.js'], outfile: '.course-logic-test.cjs', bundle: true, platform: 'node', format: 'cjs' }),
  build({
    entryPoints: ['lib/api.js'], outfile: '.course-api-test.cjs', bundle: true, platform: 'node', format: 'cjs',
    alias: {
      '@react-native-async-storage/async-storage': './test/fixtures/source-api-stubs.cjs',
      'expo-constants': './test/fixtures/source-api-stubs.cjs',
      'react-native': './test/fixtures/source-api-stubs.cjs',
      'expo-file-system': './test/fixtures/source-api-stubs.cjs',
      'expo-crypto': './test/fixtures/source-api-stubs.cjs',
      '@workspace/api-client-react': './test/fixtures/source-api-stubs.cjs',
    },
  }),
]);