let responses = [];
const requests = [];

export function setPrivacyConnectorResponses(nextResponses) {
  responses = [...nextResponses];
  requests.length = 0;
}

export function readPrivacyConnectorRequests() {
  return [...requests];
}

export class ReplitConnectors {
  async proxy(provider, path, options = {}) {
    if (provider !== "revenuecat") throw new Error(`Unexpected provider call: ${provider}`);
    requests.push({ method: options.method ?? "GET", path });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected RevenueCat request: ${options.method ?? "GET"} ${path}`);
    return {
      status: next.status,
      ok: next.status >= 200 && next.status < 300,
      async json() { return next.body ?? {}; },
    };
  }
}