export const ExecutionEnvironment = { StoreClient: 'storeClient' };
const Constants = {
  get executionEnvironment() {
    return globalThis.__requiredAuthState?.isExpoGo ? ExecutionEnvironment.StoreClient : 'standalone';
  },
};
export default Constants;