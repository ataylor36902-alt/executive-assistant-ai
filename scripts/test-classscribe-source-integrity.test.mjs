import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyClassScribeSourceIntegrity } from './check-classscribe-source-integrity.mjs';

function entry(filePath, contents) {
  return {
    path: filePath,
    bytes: Buffer.byteLength(contents),
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}

async function makeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'classscribe-integrity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifestPath = path.join(root, 'ops/credits-nightly/source-export/EXPORT-MANIFEST.json');
  await mkdir(path.dirname(manifestPath), { recursive: true });
  return {
    root,
    manifestPath,
    writeManifest: records => writeFile(manifestPath, JSON.stringify({ includedFiles: records })),
    writeFile: async (filePath, contents) => {
      const target = path.join(root, filePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents);
    },
  };
}

test('checks only manifest-listed website source files, not metadata or scheduler files', async t => {
  const fixture = await makeFixture(t);
  const sourcePath = 'artifacts/classscribe/src/App.tsx';
  const source = 'export default function App() {}';
  await fixture.writeFile(sourcePath, source);
  await fixture.writeFile('ops/credits-nightly/nightly-job.ts', 'scheduler code');
  await fixture.writeManifest([
    entry(sourcePath, source),
    entry('artifacts/classscribe/.replit-artifact/artifact.toml', 'generated metadata'),
    entry('ops/credits-nightly/nightly-job.ts', 'different scheduler source'),
  ]);

  const report = await verifyClassScribeSourceIntegrity({
    root: fixture.root,
    manifestPath: fixture.manifestPath,
  });

  assert.deepEqual(report, { checked: 1, errors: [] });
});

test('reports missing files and files with incorrect byte counts or hashes', async t => {
  const fixture = await makeFixture(t);
  await fixture.writeFile('artifacts/classscribe/src/Changed.tsx', 'edited source');
  await fixture.writeManifest([
    entry('artifacts/classscribe/src/Missing.tsx', 'expected source'),
    entry('artifacts/classscribe/src/Changed.tsx', 'original source'),
  ]);

  const report = await verifyClassScribeSourceIntegrity({
    root: fixture.root,
    manifestPath: fixture.manifestPath,
  });

  assert.equal(report.checked, 2);
  assert.equal(report.errors.length, 2);
  assert.match(report.errors[0], /Missing protected file: artifacts\/classscribe\/src\/Missing\.tsx/);
  assert.match(report.errors[1], /Changed protected file artifacts\/classscribe\/src\/Changed\.tsx/);
  assert.match(report.errors[1], /bytes .*expected/);
  assert.match(report.errors[1], /SHA-256 .*expected/);
});

test('the checked-in ClassScribe source matches its source export manifest', async () => {
  const report = await verifyClassScribeSourceIntegrity();

  assert.deepEqual(report.errors, []);
  assert.ok(report.checked >= 100, `expected a substantial protected source set, got ${report.checked}`);
});
