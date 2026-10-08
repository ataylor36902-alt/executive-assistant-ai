let providerAppUserId;

export function freeBillingIdentityForOwner(userId) {
  return `u_${Buffer.from(`classscribe-free:${userId}`).toString("hex").slice(0, 32)}`;
}
export async function getLibraryBillingStatus() {
  return { plan: "free", status: "inactive", billingSource: null };
}
export async function getRevenueCatAppUserId() {
  return providerAppUserId;
}

export function setPrivacyProviderAppUserId(value) {
  providerAppUserId = value;
}