import { freeBillingIdentityForOwner, getLibraryBillingStatus, type Plan } from "../lib/classscribe-billing";
import { getLinkedLibraryCode } from "../lib/modern-library-link";

/**
 * Resolve modern API entitlements from the authenticated owner identity or its
 * linked library. Never accept a plan supplied by a request/client.
 */
export async function getModernEffectivePlan(accountId: string): Promise<Plan> {
  const billingIdentity = await getModernBillingIdentity(accountId);
  const billingStatus = await getLibraryBillingStatus(billingIdentity);
  return billingStatus.plan;
}

export async function getModernBillingIdentity(accountId: string): Promise<string> {
  const linkedLibraryCode = await getLinkedLibraryCode(accountId);
  return linkedLibraryCode ?? freeBillingIdentityForOwner(accountId);
}