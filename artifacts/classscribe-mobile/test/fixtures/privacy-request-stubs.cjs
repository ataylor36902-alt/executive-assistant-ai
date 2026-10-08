function harness() {
  return globalThis.__privacyRequestHarness;
}

const storage = {
  async getItem(key) { return harness().storage.get(key) ?? null; },
  async setItem(key, value) { harness().storage.set(key, value); },
  async removeItem(key) { harness().storage.delete(key); },
};

function resetPrivacyRequestHarness({ uid = 'u_request_test_1234567890', server = 'https://privacy.invalid' } = {}) {
  const state = {
    uid,
    server,
    storage: new Map(),
    fetchCalls: [],
    fetchFailure: null,
    fetchHandler: null,
  };
  globalThis.__privacyRequestHarness = state;
  globalThis.fetch = async (url, options) => {
    state.fetchCalls.push({ url, options });
    if (state.fetchFailure) throw state.fetchFailure;
    if (state.fetchHandler) return state.fetchHandler(url, options);
    throw new Error(`Unexpected isolated privacy request: ${url}`);
  };
  return state;
}

storage.resetPrivacyRequestHarness = resetPrivacyRequestHarness;
storage.getServer = () => harness().server;
storage.getUid = () => harness().uid;
module.exports = storage;