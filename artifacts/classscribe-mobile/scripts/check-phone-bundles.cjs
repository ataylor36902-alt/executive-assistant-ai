// Local, disposable Metro exports. No native build, upload, or preview changes.
const { mkdtempSync, rmSync, readdirSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const outputRoot = mkdtempSync(path.join(tmpdir(), 'classscribe-phone-bundles-'));

try {
  for (const platform of ['ios', 'android']) {
    console.log(`\nCompiling ${platform} production JavaScript with Expo/Metro…`);
    const outputDir = path.join(outputRoot, platform);
    const result = spawnSync('pnpm', [
      'exec', 'expo', 'export', '--platform', platform,
      '--output-dir', outputDir, '--no-bytecode', '--max-workers', '2',
    ], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: { ...process.env, CI: '1' },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${platform} bundle failed (exit ${result.status}, signal ${result.signal || 'none'}).`);
    }
    const bundleDir = path.join(outputDir, '_expo', 'static', 'js', platform);
    const bundles = readdirSync(bundleDir).filter(name => name.endsWith('.js'));
    if (!bundles.length || bundles.some(name => statSync(path.join(bundleDir, name)).size === 0)) {
      throw new Error(`${platform} export did not produce a nonempty JavaScript bundle.`);
    }
    console.log(`${platform}: nonempty production JavaScript bundle verified.`);
  }
  console.log('\nPhone bundle smoke check passed. This does not verify native payments or device startup.');
} finally {
  rmSync(outputRoot, { recursive: true, force: true });
}
