const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
assert.deepEqual(parsed.errors, []);

// Use the same configured compiler and syntax diagnostics as `tsc`, but an
// in-memory broken source: no live screen or managed preview is ever modified.
function syntaxDiagnostics(fileName, source) {
  const host = ts.createCompilerHost(parsed.options);
  const originalReadFile = host.readFile.bind(host);
  host.readFile = name => path.resolve(name) === fileName ? source : originalReadFile(name);
  const program = ts.createProgram(parsed.fileNames, parsed.options, host);
  return program.getSyntacticDiagnostics(program.getSourceFile(fileName));
}

test('phone tsconfig includes JavaScript/JSX screens alongside TypeScript', () => {
  assert.equal(parsed.options.allowJs, true);
  for (const extension of ['js', 'jsx', 'ts', 'tsx']) {
    assert(config.config.include.some(glob => glob.endsWith(`*.${extension}`)));
  }
  assert(parsed.fileNames.includes(path.join(root, 'app/credits.js')));
});

test('the compiler rejects an intentional credit-history JSX closure fault without changing the screen', () => {
  const fileName = path.join(root, 'app/credits.js');
  const source = readFileSync(fileName, 'utf8');
  assert.deepEqual(syntaxDiagnostics(fileName, source), []);
  const broken = `${source}\nconst brokenCreditHistory = <View>{[].map(row => (<Text />)}</View>;\n`;
  const diagnostics = syntaxDiagnostics(fileName, broken);
  assert(diagnostics.length > 0, 'intentional JSX closure fault must fail');
  assert(diagnostics.every(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error));
  assert.equal(readFileSync(fileName, 'utf8'), source, 'original credits screen stays unchanged');
  console.log('Intentional credits.js JSX fault rejected:', ts.flattenDiagnosticMessageText(diagnostics[0].messageText, '\n'));
});
