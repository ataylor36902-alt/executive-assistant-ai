export function getAuth(req) {
  const userId = req.headers["x-test-user"] ?? null;
  const rawAge = req.headers["x-test-fva"];
  const fva = rawAge === undefined ? undefined : Number(rawAge);
  return {
    userId,
    sessionId: userId ? `privacy-test-${userId}` : null,
    sessionClaims: { ...(fva === undefined ? {} : { fva }) },
  };
}

const deleted = [];
let retentionUsers = [];
export const clerkClient = {
  users: {
    async deleteUser(userId) { deleted.push(userId); },
    async getUserList() { return { data: retentionUsers }; },
  },
};
export function resetPrivacyTestClerk() { deleted.length = 0; retentionUsers = []; }
export function setPrivacyRetentionTestUsers(users) { retentionUsers = users; }
export function deletedPrivacyTestUsers() { return [...deleted]; }