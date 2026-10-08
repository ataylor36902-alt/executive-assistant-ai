const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('Classmates never reads posts or shared lectures without a group-code filter', () => {
  const source = read('app/(tabs)/class/index.js');
  const reads = [...source.matchAll(/db\.list\(\s*['"](posts|shared)['"]([^)]*)\)/g)];
  assert.equal(reads.length, 2, 'expected one posts query and one shared-lectures query');
  for (const readCall of reads) assert.match(readCall[2], /,\s*\[\['code',\s*'==',\s*groupCode\]\]/);
  assert.doesNotMatch(source, /db\.get\(\s*['"`]shared\//);
});

test('class group invite codes are random-format capabilities and sharing uses their value', () => {
  const classmates = read('app/(tabs)/class/index.js');
  const lecture = read('app/lecture/[id].js');
  assert.match(classmates, /Crypto\.randomUUID\(\)\.replace\(\/-\/g,\s*''\)\.toLowerCase\(\)/);
  assert.match(classmates, /\^g_\[0-9a-f\]\{32\}\$/);
  assert.match(classmates, /st\.put\('courses',\s*\{\s*\.\.\.selectedCourse,\s*groupCode:\s*nextCode\s*\}\)/);
  assert.match(classmates, /db\.get\('members\/' \+ id,\s*groupCode\)/);
  const postWrites = [...classmates.matchAll(/db\.add\('posts',\s*\{([^}]*)\}\)/g)];
  assert.equal(postWrites.length, 2);
  for (const writeCall of postWrites) assert.match(writeCall[1], /^\s*code:\s*groupCode/);
  assert.match(lecture, /shared\/\$\{l\.id\}-\$\{getUid\(\)\.slice\(-6\)\}-\$\{c\.groupCode\.slice\(-8\)\}.*code:\s*c\.groupCode/);
});