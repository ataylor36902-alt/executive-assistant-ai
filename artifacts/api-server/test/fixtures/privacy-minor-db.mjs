export const classscribeLegacyDocumentsTable = { path: "path", data: "data" };
export const classscribePrivacyProfilesTable = { userId: "userId", ageBand: "ageBand" };
export const db = {
  select() { throw new Error("Database access is not expected in privacy-minor unit tests"); },
};