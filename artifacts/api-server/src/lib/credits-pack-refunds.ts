/** Revoke a proportional share of a pack, rounding up rather than retaining
 * spendable fractions after a refund. Disputed packs are fully unavailable. */
export function refundedPackCredits(credits: number, priceCents: number, refundedCents: number, disputed: boolean) {
  if (!Number.isSafeInteger(credits) || credits <= 0 ||
      !Number.isSafeInteger(priceCents) || priceCents <= 0 ||
      !Number.isSafeInteger(refundedCents) || refundedCents < 0 || refundedCents > priceCents) {
    throw new Error("Invalid verified credit-pack refund amounts.");
  }
  return disputed ? credits : Math.min(credits, Math.ceil(credits * refundedCents / priceCents));
}
