import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, '..');
const manifestRelativePath = 'ops/credits-nightly/source-export/EXPORT-MANIFEST.json';
const sourceZipRelativePath = 'attached_assets/0_ClassScribe-complete-source_1791487925572.zip';
const protectedPrefix = 'artifacts/classscribe/';
const archiveRootPrefix = 'ClassScribe/';
const zipEndSignature = 0x06054b50;
const zipCentralSignature = 0x02014b50;
const zipLocalSignature = 0x04034b50;

function isProtectedSourcePath(filePath) {
  return filePath.startsWith(protectedPrefix) &&
    !filePath.startsWith(`${protectedPrefix}.replit-artifact/`) &&
    !filePath.endsWith('.tsbuildinfo');
}

function isSafeProtectedPath(filePath, root) {
  if (path.posix.isAbsolute(filePath) || filePath.includes('\\')) return false;
  const parts = filePath.split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..')) return false;

  const protectedRoot = `${path.resolve(root, 'artifacts/classscribe')}${path.sep}`;
  const absolutePath = path.resolve(root, ...parts);
  return absolutePath.startsWith(protectedRoot);
}

function readProtectedZipEntries(archive, root) {
  const minimumEndOffset = Math.max(0, archive.length - 22 - 0xffff);
  let endOffset = -1;
  for (let offset = archive.length - 22; offset >= minimumEndOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === zipEndSignature) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('ZIP end-of-central-directory record was not found.');

  const diskNumber = archive.readUInt16LE(endOffset + 4);
  const centralDisk = archive.readUInt16LE(endOffset + 6);
  const diskEntryCount = archive.readUInt16LE(endOffset + 8);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  const commentLength = archive.readUInt16LE(endOffset + 20);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntryCount !== entryCount ||
      entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('Multi-disk and ZIP64 archives are not supported.');
  }
  if (endOffset + 22 + commentLength > archive.length ||
      centralOffset + centralSize > endOffset) {
    throw new Error('ZIP central directory is outside the archive bounds.');
  }

  const protectedEntries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralOffset + centralSize ||
        archive.readUInt32LE(offset) !== zipCentralSignature) {
      throw new Error('ZIP central directory contains an invalid entry.');
    }

    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const fileCommentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const entryEnd = offset + 46 + fileNameLength + extraLength + fileCommentLength;
    if (entryEnd > centralOffset + centralSize ||
        compressedSize === 0xffffffff || uncompressedSize === 0xffffffff ||
        localHeaderOffset === 0xffffffff) {
      throw new Error('ZIP entry is truncated or uses unsupported ZIP64 fields.');
    }

    const nameBytes = archive.subarray(offset + 46, offset + 46 + fileNameLength);
    let archivePath = nameBytes.toString('utf8');
    if (archivePath.startsWith(archiveRootPrefix)) {
      archivePath = archivePath.slice(archiveRootPrefix.length);
    }
    offset = entryEnd;

    if (!isProtectedSourcePath(archivePath) || archivePath.endsWith('/')) continue;
    if (!isSafeProtectedPath(archivePath, root)) {
      throw new Error(`Invalid protected path in source ZIP: ${archivePath}`);
    }
    if ((flags & 0x0001) !== 0) {
      throw new Error(`Encrypted protected file in source ZIP: ${archivePath}`);
    }

    if (localHeaderOffset + 30 > archive.length) {
      throw new Error(`Invalid local ZIP header for protected file: ${archivePath}`);
    }
    const localNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    if (archive.readUInt32LE(localHeaderOffset) !== zipLocalSignature) {
      throw new Error(`Invalid local ZIP header for protected file: ${archivePath}`);
    }
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > archive.length) {
      throw new Error(`Truncated protected file in source ZIP: ${archivePath}`);
    }

    const compressed = archive.subarray(dataOffset, dataEnd);
    let contents;
    if (method === 0) {
      contents = compressed;
    } else if (method === 8) {
      contents = inflateRawSync(compressed);
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for ${archivePath}.`);
    }
    if (contents.byteLength !== uncompressedSize) {
      throw new Error(`Incorrect uncompressed size for protected file in source ZIP: ${archivePath}`);
    }

    const matches = protectedEntries.get(archivePath) ?? [];
    matches.push(contents);
    protectedEntries.set(archivePath, matches);
  }

  if (offset !== centralOffset + centralSize) {
    throw new Error('ZIP central directory size does not match its entries.');
  }
  return protectedEntries;
}

async function listProtectedWorkspaceFiles(root) {
  const protectedFiles = new Set();
  const sourceDirectory = path.resolve(root, 'artifacts/classscribe');

  async function visit(directory, relativeDirectory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return;
      throw error;
    }

    for (const entry of entries) {
      const filePath = path.posix.join(relativeDirectory, entry.name);
      if (!isProtectedSourcePath(filePath)) continue;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        await visit(path.join(directory, entry.name), filePath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        protectedFiles.add(filePath);
      }
    }
  }

  await visit(sourceDirectory, protectedPrefix.slice(0, -1));
  return protectedFiles;
}

export async function verifyClassScribeSourceIntegrity({
  root = defaultRoot,
  manifestPath = path.resolve(root, manifestRelativePath),
  sourceZipPath = path.resolve(root, sourceZipRelativePath),
  trustedArchiveSha256 = process.env.CLASSSCRIBE_SOURCE_ZIP_SHA256,
} = {}) {
  // Trust comes from owner-controlled configuration, never from the manifest,
  // a repository file, or a digest calculated from the archive being checked.
  if (typeof trustedArchiveSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(trustedArchiveSha256)) {
    return {
      checked: 0,
      errors: [`Missing or invalid trusted source ZIP fingerprint: CLASSSCRIBE_SOURCE_ZIP_SHA256 must be an externally approved SHA-256 digest (${trustedArchiveSha256 === undefined ? 'not supplied to this process' : 'invalid format'}).`],
    };
  }

  let archive;
  try {
    archive = await readFile(sourceZipPath);
  } catch (error) {
    return {
      checked: 0,
      errors: [`Cannot read source ZIP ${path.relative(root, sourceZipPath)}: ${error.message}`],
    };
  }
  const archiveSha256 = createHash('sha256').update(archive).digest('hex');
  if (archiveSha256 !== trustedArchiveSha256.toLowerCase()) {
    return {
      checked: 0,
      errors: [`Source ZIP fingerprint mismatch: SHA-256 ${archiveSha256} (externally approved ${trustedArchiveSha256.toLowerCase()}). Baseline updates require owner review; do not regenerate the trusted fingerprint from this workspace.`],
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    return {
      checked: 0,
      errors: [`Cannot read source export manifest ${path.relative(root, manifestPath)}: ${error.message}`],
    };
  }

  if (!manifest || !Array.isArray(manifest.includedFiles)) {
    return {
      checked: 0,
      errors: ['Source export manifest is invalid: expected an includedFiles array.'],
    };
  }

  const records = manifest.includedFiles.filter(
    record => typeof record?.path === 'string' && isProtectedSourcePath(record.path),
  );
  if (records.length === 0) {
    return {
      checked: 0,
      errors: [`Source export manifest contains no protected files under ${protectedPrefix}.`],
    };
  }

  const errors = [];
  const seenPaths = new Set();
  const manifestRecords = new Map();

  for (const record of records) {
    const filePath = record.path;
    if (!isSafeProtectedPath(filePath, root)) {
      errors.push(`Invalid protected path in source export manifest: ${filePath}`);
      continue;
    }
    if (seenPaths.has(filePath)) {
      errors.push(`Duplicate protected path in source export manifest: ${filePath}`);
      continue;
    }
    seenPaths.add(filePath);
    manifestRecords.set(filePath, record);
  }

  let sourceZip;
  try {
    sourceZip = readProtectedZipEntries(archive, root);
  } catch (error) {
    return {
      checked: seenPaths.size,
      errors: [`Cannot read source ZIP ${path.relative(root, sourceZipPath)}: ${error.message}`],
    };
  }

  for (const [filePath, entries] of sourceZip) {
    if (entries.length > 1) {
      errors.push(`Duplicate protected path in source ZIP: ${filePath}`);
    }
    if (!manifestRecords.has(filePath)) {
      errors.push(`Extra protected file in source ZIP: ${filePath}`);
    }
  }

  for (const [filePath, record] of manifestRecords) {
    if (!Number.isSafeInteger(record.bytes) || record.bytes < 0 ||
        typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(record.sha256)) {
      errors.push(`Invalid byte count or SHA-256 in source export manifest: ${filePath}`);
      continue;
    }

    const zipMatches = sourceZip.get(filePath);
    if (!zipMatches) {
      errors.push(`Missing protected file in source ZIP: ${filePath}`);
    } else if (zipMatches.length === 1) {
      const zipContents = zipMatches[0];
      const zipBytes = zipContents.byteLength;
      const zipSha256 = createHash('sha256').update(zipContents).digest('hex');
      const differences = [];
      if (zipBytes !== record.bytes) {
        differences.push(`bytes ${zipBytes} (expected ${record.bytes})`);
      }
      if (zipSha256 !== record.sha256.toLowerCase()) {
        differences.push(`SHA-256 ${zipSha256} (expected ${record.sha256.toLowerCase()})`);
      }
      if (differences.length > 0) {
        errors.push(`Manifest does not match source ZIP for ${filePath}: ${differences.join('; ')}`);
      }
    }

    let contents;
    try {
      contents = await readFile(path.resolve(root, ...filePath.split('/')));
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        errors.push(`Missing protected file: ${filePath}`);
      } else {
        errors.push(`Cannot read protected file ${filePath}: ${error.message}`);
      }
      continue;
    }

    const actualBytes = contents.byteLength;
    const actualSha256 = createHash('sha256').update(contents).digest('hex');
    const differences = [];
    if (actualBytes !== record.bytes) {
      differences.push(`bytes ${actualBytes} (expected ${record.bytes})`);
    }
    if (actualSha256 !== record.sha256.toLowerCase()) {
      differences.push(`SHA-256 ${actualSha256} (expected ${record.sha256.toLowerCase()})`);
    }
    if (differences.length > 0) {
      errors.push(`Changed protected file ${filePath}: ${differences.join('; ')}`);
    }
  }

  let workspaceFiles;
  try {
    workspaceFiles = await listProtectedWorkspaceFiles(root);
  } catch (error) {
    errors.push(`Cannot list protected workspace files: ${error.message}`);
    workspaceFiles = new Set();
  }
  for (const filePath of workspaceFiles) {
    if (!manifestRecords.has(filePath)) {
      errors.push(`Extra protected file in workspace: ${filePath}`);
    }
  }

  return { checked: seenPaths.size, errors };
}

const invokedPath = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  const report = await verifyClassScribeSourceIntegrity();
  if (report.errors.length > 0) {
    console.error('ClassScribe source integrity check failed:');
    for (const error of report.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`ClassScribe source integrity check passed: ${report.checked} files verified offline.`);
  }
}
