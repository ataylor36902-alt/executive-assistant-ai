const AsyncStorage = {
  getItem: async (key) => globalThis.__requiredAuthAsyncStorage?.get(key) ?? null,
  setItem: async (key, value) => { globalThis.__requiredAuthAsyncStorage?.set(key, value); },
  removeItem: async (key) => { globalThis.__requiredAuthAsyncStorage?.delete(key); },
};
export default AsyncStorage;