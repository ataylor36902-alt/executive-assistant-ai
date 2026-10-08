export class ReplitConnectors {
  async listConnections() {
    return globalThis.__scribeConnection ? [{ connector_name: "elevenlabs", status: null }] : [];
  }

  async proxy(name, path, options) {
    if (!globalThis.__scribeProxy) throw new Error("Unexpected connector request");
    return globalThis.__scribeProxy(name, path, options);
  }
}