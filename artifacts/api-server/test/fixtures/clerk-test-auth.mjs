// Only used by the bundled study-guide test. Never loaded by the application.
export function getAuth(req) {
  const userId = req.headers["x-test-user"] ?? null;
  return {
    userId,
    sessionId: req.headers["x-test-session"] ?? (userId ? `sess_${userId}` : null),
    sessionClaims: { exp: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60 },
  };
}

export const clerkClient = {
  users: {
    async getUser(userId) {
      return { id: userId, fullName: null, firstName: null, lastName: null, username: null };
    },
  },
  sessions: {
    async getSession(sessionId) {
      const userId = sessionId.startsWith("sess_") ? sessionId.slice("sess_".length) : "";
      return {
        id: sessionId,
        userId,
        status: "active",
        expireAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
      };
    },
  },
};