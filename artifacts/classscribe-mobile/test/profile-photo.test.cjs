const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

let client, ProfileAvatar, fixtureDir, h;
const originalFetch = global.fetch;
const originalReader = global.FileReader;
const asset = { uri: 'file:///selected.heic', width: 1200, height: 2400 };
// Real WebP encoded with the same Sharp encoder used by the private API.
const WEBP = Buffer.from('UklGRjYAAABXRUJQVlA4ICoAAABwAQCdASoCAAIAAUAmJaACdAFAAAD+54u5P0vf/voB//fQD/++gH+CAAA=', 'base64');
const tick = () => new Promise(resolve => setImmediate(resolve));
const photoResponse = () => ({
  ok: true, status: 200,
  blob: async () => new Blob([WEBP], { type: 'image/webp' }),
});

test.before(async () => {
  const { buildProfilePhotoFixture } = await import('./build-profile-photo.mjs');
  fixtureDir = mkdtempSync(join(tmpdir(), 'classscribe-photo-'));
  await buildProfilePhotoFixture(fixtureDir);
  client = require(join(fixtureDir, 'lib/profile-photo.cjs'));
  ({ ProfileAvatar } = require(join(fixtureDir, 'components/ProfileAvatar.cjs')));
});
test.beforeEach(() => {
  h = global.__photo = {
    uid: 'u_libraryone123', server: 'https://private.example', platform: 'ios',
    state: undefined, deps: '', cleanup: null, foreground: null, calls: [], fileSize: 1000,
    useState(initial) {
      if (this.state === undefined) this.state = initial;
      return [this.state, value => { this.state = typeof value === 'function' ? value(this.state) : value; }];
    },
    focus(callback) {
      const deps = JSON.stringify(callback.deps);
      if (deps !== this.deps) {
        this.cleanup?.();
        this.deps = deps;
        this.cleanup = callback();
      }
    },
    async manipulate(...args) { this.manipulation = args; return { uri: 'file:///converted.jpg' }; },
  };
  global.fetch = async (url, options) => { h.calls.push({ url, ...options }); return photoResponse(); };
  global.FileReader = class {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(bytes => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload();
      });
    }
  };
});
test.afterEach(() => {
  h.cleanup?.();
  global.fetch = originalFetch;
  global.FileReader = originalReader;
  delete global.__photo;
});
test.after(() => rmSync(fixtureDir, { recursive: true, force: true }));

test('iPhone uploads a bounded JPEG privately, including portrait HEIC selections', async () => {
  await client.uploadProfilePhoto(h.uid, asset, h.server);
  assert.deepEqual(h.manipulation[1], [{ resize: { height: 512 } }]);
  assert.deepEqual(h.manipulation[2], { format: 'jpeg', compress: 0.84 });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, `${h.server}/api/profile-photo`);
  assert.equal(h.calls[0].method, 'POST');
  assert.equal(h.calls[0].headers['X-CS-User'], h.uid);
  assert.equal(h.calls[0].headers['Content-Type'], 'image/jpeg');
  assert.equal(h.calls[0].body.uri, 'file:///converted.jpg');
});

test('invalid dimensions, empty images and oversized encoded uploads never reach the API', async () => {
  await assert.rejects(client.uploadProfilePhoto(h.uid, { ...asset, height: 0 }), /valid image/);
  for (const size of [0, 3 * 1024 * 1024 + 1]) {
    h.fileSize = size;
    await assert.rejects(client.uploadProfilePhoto(h.uid, asset), /smaller than 3 MB/);
  }
  assert.equal(h.calls.length, 0);
});

test('library or server changes during conversion cannot upload to either library', async () => {
  h.manipulate = async () => { h.uid = 'u_librarytwo123'; return { uri: 'file:///converted.jpg' }; };
  await assert.rejects(client.uploadProfilePhoto('u_libraryone123', asset), /active library changed/);
  h.uid = 'u_libraryone123';
  h.manipulate = async () => { h.server = 'https://other.example'; return { uri: 'file:///converted.jpg' }; };
  await assert.rejects(client.uploadProfilePhoto(h.uid, asset, 'https://private.example'), /server changed/);
  assert.equal(h.calls.length, 0);
});

test('remove uses the private DELETE contract and reports server validation failures', async () => {
  await client.removeProfilePhoto(h.uid, h.server);
  assert.equal(h.calls[0].method, 'DELETE');
  assert.equal(h.calls[0].headers['X-CS-User'], h.uid);
  assert.equal(h.calls[0].body, undefined);
  global.fetch = async () => new Response(JSON.stringify({ error: 'Invalid image type' }), { status: 415 });
  await assert.rejects(client.uploadProfilePhoto(h.uid, asset), /Invalid image type/);
});

test('native avatars use fetched private bytes, not public or authenticated image URLs', async () => {
  assert.equal(client.useProfilePhoto(h.uid, h.server).source, null);
  await tick();
  const loaded = client.useProfilePhoto(h.uid, h.server);
  assert.match(loaded.source.uri, /^data:image\/webp;base64,/);
  assert.equal(loaded.source.headers, undefined);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].headers['X-CS-User'], h.uid);
  assert.equal(h.calls[0].cache, 'no-store');
});

test('iOS avatar uses the WebP-capable Expo renderer with both caches disabled', async () => {
  const sharp = require(join(__dirname, '../../api-server/node_modules/sharp'));
  const decoded = await sharp(WEBP).raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, 2);
  assert.equal(decoded.info.height, 2);
  assert.ok(decoded.data.length > 0, 'API-format WebP must contain decodable pixels');
  client.useProfilePhoto(h.uid, h.server);
  await tick();
  const source = h.state.source;
  assert.equal(source.uri, `data:image/webp;base64,${WEBP.toString('base64')}`);
  h.state = undefined;
  const tree = ProfileAvatar({ source, initial: 'P' });
  const image = tree.props.children[1];
  assert.equal(image.type, 'ExpoImage', 'React Native Image does not support this WebP iOS path');
  assert.equal(image.props.source.uri, source.uri);
  assert.equal(image.props.cachePolicy, 'none');
  assert.equal(image.props.useAppleWebpCodec, false);
  image.props.onLoad();
  assert.equal(ProfileAvatar({ source, initial: 'P' }).props.children[1].props.style.opacity, 1);
});

test('installed iOS renderer registers a WebP decoder and maps none to no cache', () => {
  const native = join(__dirname, '../node_modules/expo-image/ios');
  assert.match(readFileSync(join(native, 'ImageModule.swift'), 'utf8'), /addCoder\(WebPCoder\.shared\)/);
  assert.match(readFileSync(join(native, 'ExpoImage.podspec'), 'utf8'), /dependency 'SDWebImageWebPCoder'/);
  assert.match(readFileSync(join(native, 'ImageCachePolicy.swift'), 'utf8'), /case \.none:\s*return \.none/);
  const options = readFileSync(join(native, 'Utils/ImageUtils.swift'), 'utf8');
  assert.match(options, /context\[\.queryCacheType\] = sdCacheType/);
  assert.match(options, /context\[\.storeCacheType\] = sdCacheType/);
});

test('avatar hides failed decodes and cannot retain the previous photo after removal', () => {
  const source = { uri: `data:image/webp;base64,${WEBP.toString('base64')}` };
  const image = ProfileAvatar({ source, initial: 'P' }).props.children[1];
  image.props.onLoad();
  assert.equal(ProfileAvatar({ source, initial: 'P' }).props.children[0].props.style.opacity, 0);
  image.props.onError();
  assert.equal(ProfileAvatar({ source, initial: 'P' }).props.children[0].props.style.opacity, 1);
  const removed = ProfileAvatar({ source: null, initial: 'P' });
  assert.equal(removed.props.children[1], null);
  assert.equal(removed.props.children[0].props.style.opacity, 1);
});

test('library/server changes clear the visible photo before another request finishes', async () => {
  client.useProfilePhoto(h.uid, h.server);
  await tick();
  assert.ok(client.useProfilePhoto(h.uid, h.server).source);
  global.fetch = () => new Promise(() => {});
  h.uid = 'u_librarytwo123';
  assert.equal(client.useProfilePhoto(h.uid, h.server).source, null);
  assert.equal(client.useProfilePhoto('u_libraryone123', h.server).source, null);
  h.server = 'https://other.example';
  assert.equal(client.useProfilePhoto(h.uid, 'https://private.example').source, null);
});

test('a delayed photo response cannot repopulate a different library', async () => {
  let resolveResponse;
  global.fetch = () => new Promise(resolve => { resolveResponse = resolve; });
  client.useProfilePhoto(h.uid, h.server);
  const resolveOld = resolveResponse;
  h.uid = 'u_librarytwo123';
  client.useProfilePhoto(h.uid, h.server);
  resolveOld(photoResponse());
  await tick();
  assert.equal(client.useProfilePhoto(h.uid, h.server).source, null);
});

test('foreground refresh sees a photo removed on another device and cleans up listeners', async () => {
  client.useProfilePhoto(h.uid, h.server);
  await tick();
  assert.ok(h.state.source);
  global.fetch = async () => new Response(null, { status: 404 });
  h.foreground('active');
  await tick();
  assert.equal(client.useProfilePhoto(h.uid, h.server).source, null);
  h.cleanup();
  assert.equal(h.foreground, null);
});

test('web avatar object URLs are revoked on library switching', async () => {
  h.platform = 'web';
  client.useProfilePhoto(h.uid, h.server);
  await tick();
  const uri = client.useProfilePhoto(h.uid, h.server).source.uri;
  assert.match(uri, /^blob:/);
  h.uid = 'u_librarytwo123';
  client.useProfilePhoto(h.uid, h.server);
  await assert.rejects(originalFetch(uri));
});

test('invalid photo responses and network failures show explicit errors', async () => {
  global.fetch = async () => new Response('not an image', { headers: { 'Content-Type': 'text/html' } });
  client.useProfilePhoto(h.uid, h.server);
  await tick();
  assert.match(h.state.error, /invalid profile photo/);
  global.fetch = async () => { throw new Error('Offline'); };
  h.foreground('active');
  await tick();
  assert.match(h.state.error, /Offline/);
  assert.equal(h.state.source, null);
});

test('a removal confirmation remains bound to the library that opened it', async () => {
  const source = readFileSync(join(__dirname, '../app/account.js'), 'utf8');
  const start = source.indexOf('  async function removePhoto(');
  const end = source.indexOf('  async function chooseHomeLayout(', start);
  const removed = [];
  let confirmation;
  const context = {
    st: { status: { uid: h.uid, server: h.server } },
    getUid: () => h.uid, getServer: () => h.server,
    Platform: { OS: 'ios' }, setPhotoBusy() {}, setPhotoRevision() {},
    removeProfilePhoto: async (...args) => removed.push(args),
    Alert: { alert: (title, message, buttons) => { confirmation = buttons; } },
  };
  runInNewContext(`${source.slice(start, end)}; confirmRemovePhoto();`, context);
  h.uid = 'u_librarytwo123';
  context.st.status.uid = h.uid;
  await confirmation[1].onPress();
  assert.equal(removed.length, 0);
  h.uid = 'u_libraryone123';
  await confirmation[1].onPress();
  assert.deepEqual(removed, [[h.uid, h.server]]);
});
