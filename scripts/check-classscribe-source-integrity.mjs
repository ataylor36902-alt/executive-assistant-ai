import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, '..');
const manifestRelativePath = 'ops/credits-nightly/source-export/EXPORT-MANIFEST.json';
const protectedPrefix = 'artifacts/classscribe/';

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

export async function verifyClassScribeSourceIntegrity({
  root = defaultRoot,
  manifestPath = path.resolve(root, manifestRelativePath),
} = {}) {
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

    if (!Number.isSafeInteger(record.bytes) || record.bytes < 0 ||
        typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(record.sha256)) {
      errors.push(`Invalid byte count or SHA-256 in source export manifest: ${filePath}`);
      continue;
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
