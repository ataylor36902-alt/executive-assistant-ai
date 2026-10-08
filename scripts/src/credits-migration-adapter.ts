export type TransferRequest = {
  adjustments: Record<string, number>;
  reference: string;
};

export type ProductGrant = {
  product_ids: string[];
  amount: number;
  trial_amount: number;
  expire_at_cycle_end: boolean;
};

export type PackGrantProduct = {
  id: string;
  type?: string;
  store_identifier?: string;
};

export type CreditPack = { id: string; credits: number };

export type MigrationEntryPhase =
  | "prepared"
  | "transfer-pending"
  | "transfer-uncertain"
  | "transferred"
  | "verified";

export function canonicalMigrationKey(libraryHash: string): string {
  if (!/^[a-f0-9]{64}$/.test(libraryHash)) {
    throw new Error("Invalid canonical library hash.");
  }
  return `migrate-crd-${libraryHash}`;
}

export function buildAtomicTransfer(
  libraryHash: string,
  amount: number,
): TransferRequest {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Transfer amount must be a positive safe integer.");
  }
  const reference = canonicalMigrationKey(libraryHash);
  if (reference.length > 255) throw new Error("Migration key exceeds provider limit.");
  return {
    adjustments: { CRD: -amount, CREDITS: amount },
    reference,
  };
}

export function canSubmitTransfer(phase: MigrationEntryPhase): boolean {
  return phase === "prepared";
}

export function transferPhaseAfterRequest(
  outcome: "success" | "definitive-rejection" | "ambiguous",
): MigrationEntryPhase {
  if (outcome === "success") return "transferred";
  if (outcome === "ambiguous") return "transfer-uncertain";
  return "prepared";
}

export function assertTransferMayBeRetried(
  phase: MigrationEntryPhase,
  verifiedProviderReference: boolean,
): void {
  if (phase === "transfer-pending" || phase === "transfer-uncertain") {
    if (!verifiedProviderReference) {
      throw new Error(
        "A pending/ambiguous migration cannot be repeated without verified provider transaction history for its reference.",
      );
    }
    return;
  }
  if (!canSubmitTransfer(phase)) {
    throw new Error(`Transfer is not retryable from phase ${phase}.`);
  }
}

export function migrationMatches(
  oldBalance: number,
  creditsBalance: number,
  originalCrdBalance: number,
): boolean {
  return (
    Number.isSafeInteger(oldBalance) &&
    Number.isSafeInteger(creditsBalance) &&
    Number.isSafeInteger(originalCrdBalance) &&
    oldBalance === 0 &&
    creditsBalance === originalCrdBalance
  );
}

export function buildPackOnlyGrantPlan(
  products: PackGrantProduct[],
  packs: CreditPack[],
): { grants: ProductGrant[]; productIds: Set<string> } {
  const groups = new Map<number, Set<string>>();
  for (const pack of packs) {
    if (!Number.isSafeInteger(pack.credits) || pack.credits <= 0) {
      throw new Error(`Invalid grant amount for pack ${pack.id}.`);
    }
    const matching = products.filter(
      (product) =>
        product.type === "consumable" &&
        product.store_identifier === pack.id &&
        typeof product.id === "string" &&
        product.id.length > 0,
    );
    if (!matching.length) {
      throw new Error(`Credit pack ${pack.id} is missing from the catalog; refusing catalog edits.`);
    }
    const productIds = groups.get(pack.credits) ?? new Set<string>();
    for (const product of matching) productIds.add(product.id);
    groups.set(pack.credits, productIds);
  }
  const grants = [...groups.entries()]
    .map(([amount, productIds]) => ({
      product_ids: [...productIds].sort(),
      amount,
      trial_amount: 0,
      expire_at_cycle_end: false,
    }))
    .sort((left, right) => left.amount - right.amount);
  return {
    grants,
    productIds: new Set(grants.flatMap((grant) => grant.product_ids)),
  };
}

export function assertMigrationCutoverReady(checks: {
  allBalancesVerified: boolean;
  catalogReadbackVerified: boolean;
  subscriptionGrantsAbsent: boolean;
}): void {
  if (
    !checks.allBalancesVerified ||
    !checks.catalogReadbackVerified ||
    !checks.subscriptionGrantsAbsent
  ) {
    throw new Error("CREDITS cutover cannot enable server subscription grants before migration verification.");
  }
}

export function canonicalizeMigrationEntries<T extends { libraryHash: string }>(
  entries: T[],
  resolveAlias: (libraryHash: string) => string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const entry of entries) {
    const canonicalHash = resolveAlias(entry.libraryHash);
    if (result.has(canonicalHash)) {
      throw new Error("Migration baselines resolve to duplicate canonical libraries.");
    }
    result.set(canonicalHash, entry);
  }
  return result;
}