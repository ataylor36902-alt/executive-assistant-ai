const values = new Map();
const storage = {
  async getItem(key) { return values.get(key) ?? null; },
  async setItem(key, value) { values.set(key, String(value)); },
  async removeItem(key) { values.delete(key); },
  async multiRemove(keys) { keys.forEach((key) => values.delete(key)); },
};

module.exports = storage;
module.exports.default = storage;
module.exports.Constants = { expoConfig: { extra: {} } };
module.exports.Platform = { OS: 'web' };
module.exports.File = class File {};
module.exports.getRandomBytes = (size) => new Uint8Array(size);