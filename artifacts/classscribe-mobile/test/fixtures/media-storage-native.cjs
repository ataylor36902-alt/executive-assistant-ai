const { createHash } = require('node:crypto');
const files = new Map();
const document = 'file:///documents/';

class Directory {
  constructor(parent, ...parts) {
    this.uri = (typeof parent === 'string' ? parent : parent.uri).replace(/\/+$/, '')
      + (parts.length ? '/' + parts.join('/') : '');
    this.name = this.uri.split('/').at(-1);
  }
  get exists() { return [...files.keys()].some((uri) => uri.startsWith(this.uri + '/')); }
  create() {}
}
class File {
  constructor(parent, name) {
    this.uri = name ? parent.uri.replace(/\/+$/, '') + '/' + name : parent;
    this.name = this.uri.split('/').at(-1);
  }
  get exists() { return files.has(this.uri); }
  get size() { return files.get(this.uri)?.length || 0; }
  write(text) { files.set(this.uri, Buffer.from(text)); }
  async text() { return files.get(this.uri).toString(); }
  async copy(dest) { files.set(dest.uri, files.get(this.uri)); }
}
module.exports = {
  files, File, Directory, Paths: { document, cache: 'file:///cache/' }, Platform: { OS: 'ios' },
  CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digestStringAsync: async (_algorithm, text) => createHash('sha256').update(text).digest('hex'),
};