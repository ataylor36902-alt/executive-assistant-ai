import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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

function crc32(contents) {
  let crc = 0xffffffff;
  for (const byte of contents) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  let centralSize = 0;

  for (const [entryPath, value] of entries) {
    const name = Buffer.from(`ClassScribe/${entryPath}`, 'utf8');
    const contents = Buffer.from(value);
    const checksum = crc32(contents);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(contents.byteLength, 18);
    localHeader.writeUInt32LE(contents.byteLength, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, contents);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(contents.byteLength, 20);
    centralHeader.writeUInt32LE(contents.byteLength, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.byteLength + name.byteLength + contents.byteLength;
    centralSize += centralHeader.byteLength + name.byteLength;
  }

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralSize, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  endRecord.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, endRecord]);
}

async function makeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'classscribe-integrity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifestPath = path.join(root, 'ops/credits-nightly/source-export/EXPORT-MANIFEST.json');
  const sourceZipPath = path.join(root, 'source.zip');
  await mkdir(path.dirname(manifestPath), { recursive: true });
  return {
    root,
    manifestPath,
    sourceZipPath,
    writeManifest: records => writeFile(manifestPath, JSON.stringify({ includedFiles: records })),
    trustedArchiveSha256: undefined,
    async writeZip(entries) {
      const archive = makeStoredZip(entries);
      // Capture the original baseline once; subsequent writes cannot re-trust it.
      this.trustedArchiveSha256 ??= createHash('sha256').update(archive).digest('hex');
      await writeFile(sourceZipPath, archive);
    },
    writeFile: async (filePath, contents) => {
      const target = path.join(root, filePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents);
    },
  };
}

async function runFixtureCli(fixture) {
  const scriptPath = path.join(fixture.root, 'scripts/check-classscribe-source-integrity.mjs');
  const archivePath = path.join(
    fixture.root, 'attached_assets/0_ClassScribe-complete-source_1791487925572.zip',
  );
  await mkdir(path.dirname(scriptPath), { recursive: true });
  await mkdir(path.dirname(archivePath), { recursive: true });
  await copyFile(new URL('./check-classscribe-source-integrity.mjs', import.meta.url), scriptPath);
  await copyFile(fixture.sourceZipPath, archivePath);
  return spawnSync(process.execPath, [scriptPath], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLASSSCRIBE_SOURCE_ZIP_SHA256: fixture.trustedArchiveSha256,
    },
    timeout: 10_000,
  });
}

const damagedArchiveCases = [
  {
    name: 'empty archive',
    damage: () => Buffer.alloc(0),
    error: 'ZIP end-of-central-directory record was not found.',
  },
  {
    name: 'archive truncated within its local header',
    damage: archive => archive.subarray(0, 12),
    error: 'ZIP end-of-central-directory record was not found.',
  },
  {
    name: 'archive with a truncated end-of-central-directory record',
    damage: archive => archive.subarray(0, archive.length - 8),
    error: 'ZIP end-of-central-directory record was not found.',
  },
  {
    name: 'broken central directory',
    damage: archive => {
      const centralOffset = archive.readUInt32LE(archive.length - 22 + 16);
      archive.writeUInt32LE(0, centralOffset);
      return archive;
    },
    error: 'ZIP central directory contains an invalid entry.',
  },
  {
    name: 'protected entry with unsupported compression',
    damage: archive => {
      const centralOffset = archive.readUInt32LE(archive.length - 22 + 16);
      archive.writeUInt16LE(99, 8);
      archive.writeUInt16LE(99, centralOffset + 10);
      return archive;
    },
    error: 'Unsupported ZIP compression method 99 for artifacts/classscribe/src/App.tsx.',
  },
  {
    name: 'encrypted protected entry',
    damage: archive => {
      const centralOffset = archive.readUInt32LE(archive.length - 22 + 16);
      archive.writeUInt16LE(0x0801, 6);
      archive.writeUInt16LE(0x0801, centralOffset + 8);
      return archive;
    },
    error: 'Encrypted protected file in source ZIP: artifacts/classscribe/src/App.tsx',
  },
];

for (const { name, damage, error } of damagedArchiveCases) {
  test(`rejects ${name} with a clear failure and no CLI pass message`, async t => {
    const fixture = await makeFixture(t);
    const sourcePath = 'artifacts/classscribe/src/App.tsx';
    const source = 'export default function App() {}';
    await fixture.writeFile(sourcePath, source);
    await fixture.writeManifest([entry(sourcePath, source)]);
    const damagedArchive = damage(makeStoredZip([[sourcePath, source]]));
    await writeFile(fixture.sourceZipPath, damagedArchive);
    // These parser-focused tests pin their malformed test bytes explicitly so
    // they exercise ZIP parsing after the independent fingerprint check.
    fixture.trustedArchiveSha256 = createHash('sha256').update(damagedArchive).digest('hex');

    const report = await verifyClassScribeSourceIntegrity(fixture);
    assert.deepEqual(report.errors, [`Cannot read source ZIP source.zip: ${error}`]);

    const cli = await runFixtureCli(fixture);
    assert.ifError(cli.error);
    assert.equal(cli.signal, null);
    assert.equal(cli.status, 1, `stdout: ${cli.stdout}\nstderr: ${cli.stderr}`);
    assert.ok(cli.stderr.includes('ClassScribe source integrity check failed:'));
    assert.ok(cli.stderr.includes(`Cannot read source ZIP attached_assets/0_ClassScribe-complete-source_1791487925572.zip: ${error}`));
    assert.doesNotMatch(`${cli.stdout}${cli.stderr}`, /integrity check passed/i);
  });
}

test('accepts an intact fixture through both the verifier and CLI', async t => {
  const fixture = await makeFixture(t);
  const sourcePath = 'artifacts/classscribe/src/App.tsx';
  const source = 'export default function App() {}';
  await fixture.writeFile(sourcePath, source);
  await fixture.writeManifest([entry(sourcePath, source)]);
  await fixture.writeZip([[sourcePath, source]]);

  assert.deepEqual(await verifyClassScribeSourceIntegrity(fixture), { checked: 1, errors: [] });
  const cli = await runFixtureCli(fixture);
  assert.ifError(cli.error);
  assert.equal(cli.signal, null);
  assert.equal(cli.status, 0, `stdout: ${cli.stdout}\nstderr: ${cli.stderr}`);
  assert.equal(cli.stderr, '');
  assert.match(cli.stdout, /ClassScribe source integrity check passed: 1 files verified offline\./);
});

test('checks protected website files but ignores generated metadata and scheduler files', async t => {
  const fixture = await makeFixture(t);
  const sourcePath = 'artifacts/classscribe/src/App.tsx';
  const source = 'export default function App() {}';
  const extraPath = 'artifacts/classscribe/src/Unlisted.tsx';
  await fixture.writeFile(sourcePath, source);
  await fixture.writeFile(extraPath, 'unlisted website source');
  await fixture.writeFile('ops/credits-nightly/nightly-job.ts', 'scheduler code');
  await fixture.writeZip([
    [sourcePath, source],
    ['artifacts/classscribe/src/Unlisted.tsx', 'unlisted website source'],
    ['artifacts/classscribe/.replit-artifact/artifact.toml', 'generated metadata'],
    ['ops/credits-nightly/nightly-job.ts', 'different scheduler source'],
  ]);
  await fixture.writeManifest([
    entry(sourcePath, source),
    entry('artifacts/classscribe/.replit-artifact/artifact.toml', 'generated metadata'),
    entry('ops/credits-nightly/nightly-job.ts', 'different scheduler source'),
  ]);

  const report = await verifyClassScribeSourceIntegrity({
    root: fixture.root,
    manifestPath: fixture.manifestPath,
    sourceZipPath: fixture.sourceZipPath,
    trustedArchiveSha256: fixture.trustedArchiveSha256,
  });

  assert.equal(report.checked, 1);
  assert.deepEqual(report.errors, [
    `Extra protected file in source ZIP: ${extraPath}`,
    `Extra protected file in workspace: ${extraPath}`,
  ]);
});

test('reports missing files and files with incorrect byte counts or hashes', async t => {
  const fixture = await makeFixture(t);
  await fixture.writeFile('artifacts/classscribe/src/Changed.tsx', 'edited source');
  await fixture.writeZip([
    ['artifacts/classscribe/src/Missing.tsx', 'expected source'],
    ['artifacts/classscribe/src/Changed.tsx', 'original source'],
  ]);
  await fixture.writeManifest([
    entry('artifacts/classscribe/src/Missing.tsx', 'expected source'),
    entry('artifacts/classscribe/src/Changed.tsx', 'original source'),
  ]);

  const report = await verifyClassScribeSourceIntegrity({
    root: fixture.root,
    manifestPath: fixture.manifestPath,
    sourceZipPath: fixture.sourceZipPath,
    trustedArchiveSha256: fixture.trustedArchiveSha256,
  });

  assert.equal(report.checked, 2);
  assert.equal(report.errors.length, 2);
  assert.match(report.errors[0], /Missing protected file: artifacts\/classscribe\/src\/Missing\.tsx/);
  assert.match(report.errors[1], /Changed protected file artifacts\/classscribe\/src\/Changed\.tsx/);
  assert.match(report.errors[1], /bytes .*expected/);
  assert.match(report.errors[1], /SHA-256 .*expected/);
});

test('rejects a modified manifest even when the local website file matches it', async t => {
  const fixture = await makeFixture(t);
  const sourcePath = 'artifacts/classscribe/src/App.tsx';
  const original = 'export default function App() { return "original"; }';
  const edited = 'export default function App() { return "edited"; }';
  await fixture.writeFile(sourcePath, edited);
  await fixture.writeZip([[sourcePath, original]]);
  await fixture.writeManifest([entry(sourcePath, edited)]);

  const report = await verifyClassScribeSourceIntegrity({
    root: fixture.root,
    manifestPath: fixture.manifestPath,
    sourceZipPath: fixture.sourceZipPath,
    trustedArchiveSha256: fixture.trustedArchiveSha256,
  });

  assert.equal(report.checked, 1);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0], /Manifest does not match source ZIP for artifacts\/classscribe\/src\/App\.tsx/);
});

test('rejects source ZIP contents that differ from the manifest and workspace', async t => {
  const fixture = await makeFixture(t);
  const sourcePath = 'artifacts/classscribe/src/App.tsx';
  const expected = 'verified source';
  await fixture.writeFile(sourcePath, expected);
  await fixture.writeZip([[sourcePath, 'different archive source']]);
  await fixture.writeManifest([entry(sourcePath, expected)]);

  const report = await verifyClassScribeSourceIntegrity({
    root: fixture.root,
    manifestPath: fixture.manifestPath,
    sourceZipPath: fixture.sourceZipPath,
    trustedArchiveSha256: fixture.trustedArchiveSha256,
  });

  assert.equal(report.checked, 1);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0], /Manifest does not match source ZIP for artifacts\/classscribe\/src\/App\.tsx/);
});

test('reports protected files missing from or extra in the source ZIP', async t => {
  const fixture = await makeFixture(t);
  const listedPath = 'artifacts/classscribe/src/App.tsx';
  const missingPath = 'artifacts/classscribe/src/Missing.tsx';
  const extraPath = 'artifacts/classscribe/src/Extra.tsx';
  const listedContents = 'listed';
  const missingContents = 'missing from zip';
  await fixture.writeFile(listedPath, listedContents);
  await fixture.writeFile(missingPath, missingContents);
  await fixture.writeZip([
    [listedPath, listedContents],
    [extraPath, 'not listed in manifest'],
  ]);
  await fixture.writeManifest([
    entry(listedPath, listedContents),
    entry(missingPath, missingContents),
  ]);

  const report = await verifyClassScribeSourceIntegrity({
    root: fixture.root,
    manifestPath: fixture.manifestPath,
    sourceZipPath: fixture.sourceZipPath,
    trustedArchiveSha256: fixture.trustedArchiveSha256,
  });

  assert.ok(report.errors.some(error => error.includes(`Missing protected file in source ZIP: ${missingPath}`)));
  assert.ok(report.errors.some(error => error.includes(`Extra protected file in source ZIP: ${extraPath}`)));
});

test('rejects replacement of the archive, manifest, and website together', async t => {
  const fixture = await makeFixture(t);
  const sourcePath = 'artifacts/classscribe/src/App.tsx';
  await fixture.writeZip([[sourcePath, 'original source']]);
  await fixture.writeZip([[sourcePath, 'replacement source']]);
  await fixture.writeManifest([entry(sourcePath, 'replacement source')]);
  await fixture.writeFile(sourcePath, 'replacement source');

  const report = await verifyClassScribeSourceIntegrity(fixture);
  assert.equal(report.checked, 0);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0], /Source ZIP fingerprint mismatch/);
});

test('rejects absent, empty, malformed, or whitespace-padded trust values', async t => {
  const fixture = await makeFixture(t);
  const sourcePath = 'artifacts/classscribe/src/App.tsx';
  await fixture.writeZip([[sourcePath, 'source']]);
  await fixture.writeManifest([entry(sourcePath, 'source')]);
  await fixture.writeFile(sourcePath, 'source');

  for (const trustedArchiveSha256 of [null, '', 'abc', 'g'.repeat(64),
    ` ${fixture.trustedArchiveSha256}`, `${fixture.trustedArchiveSha256}\n`]) {
    const report = await verifyClassScribeSourceIntegrity({ ...fixture, trustedArchiveSha256 });
    assert.equal(report.checked, 0);
    assert.match(report.errors[0], /Missing or invalid trusted source ZIP fingerprint/);
  }
});

test('accepts an independently approved digest, including uppercase hex', async t => {
  const fixture = await makeFixture(t);
  const sourcePath = 'artifacts/classscribe/src/App.tsx';
  await fixture.writeZip([[sourcePath, 'source']]);
  await fixture.writeManifest([entry(sourcePath, 'source')]);
  await fixture.writeFile(sourcePath, 'source');

  const report = await verifyClassScribeSourceIntegrity({
    ...fixture, trustedArchiveSha256: fixture.trustedArchiveSha256.toUpperCase(),
  });
  assert.deepEqual(report.errors, []);
  assert.equal(report.checked, 1);
});

test('CLI fails closed without external trust or with a mismatched digest', () => {
  for (const fingerprint of [undefined, '0'.repeat(64)]) {
    const env = { ...process.env };
    delete env.CLASSSCRIBE_SOURCE_ZIP_SHA256;
    if (fingerprint !== undefined) env.CLASSSCRIBE_SOURCE_ZIP_SHA256 = fingerprint;
    const result = spawnSync(process.execPath, ['scripts/check-classscribe-source-integrity.mjs'], {
      env, encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, fingerprint === undefined
      ? /Missing or invalid trusted source ZIP fingerprint/ : /Source ZIP fingerprint mismatch/);
  }
});

test('the checked-in ClassScribe source matches its externally approved archive and manifest', async () => {
  const report = await verifyClassScribeSourceIntegrity();

  assert.deepEqual(report.errors, []);
  assert.ok(report.checked >= 100, `expected a substantial protected source set, got ${report.checked}`);
});
